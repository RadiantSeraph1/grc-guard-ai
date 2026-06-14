import os
import re
import sqlite3
import json
import csv
from pathlib import Path
from pypdf import PdfReader
from dotenv import load_dotenv

# Load env variables
load_dotenv()

DB_PATH = "grc_database.db"
DEFAULT_COMPANY_ID = os.environ.get("DEFAULT_COMPANY_ID", "bank_enterprise")

def init_db():
    """Initialize the SQLite database for company-scoped RAG chunks."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    # Table for document chunks
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS document_chunks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            org_id TEXT,
            filename TEXT,
            page_number INTEGER,
            content TEXT,
            token_count INTEGER
        )
    """)
    conn.commit()
    conn.close()

def parse_pdf(file_path):
    """Parse PDF and return list of page content."""
    reader = PdfReader(file_path)
    pages = []
    for i, page in enumerate(reader.pages):
        text = page.extract_text()
        if text:
            pages.append((i + 1, text))
    return pages

def parse_text_file(file_path):
    """Parse text-like files into pseudo-pages for RAG ingestion."""
    suffix = Path(file_path).suffix.lower()
    with open(file_path, "rb") as file:
        raw = file.read()
    text = raw.decode("utf-8", errors="ignore")

    if suffix == ".json":
        try:
            parsed = json.loads(text)
            text = json.dumps(parsed, indent=2, sort_keys=True)
        except Exception:
            pass
    elif suffix == ".csv":
        try:
            decoded = text.splitlines()
            rows = list(csv.reader(decoded))
            text = "\n".join([" | ".join(row) for row in rows])
        except Exception:
            pass

    pages = []
    paragraphs = [part.strip() for part in re.split(r"\n\s*\n", text) if part.strip()]
    if not paragraphs and text.strip():
        paragraphs = [text.strip()]
    for index, paragraph in enumerate(paragraphs, start=1):
        pages.append((index, paragraph))
    return pages

def parse_document(file_path):
    """Parse a supported reference or evidence document into page-like text sections."""
    suffix = Path(file_path).suffix.lower()
    if suffix == ".pdf":
        return parse_pdf(file_path)
    if suffix in {".txt", ".md", ".csv", ".json"}:
        return parse_text_file(file_path)
    raise ValueError(f"Unsupported RAG ingestion type: {suffix}")

def chunk_text(text, chunk_size=500, overlap=100):
    """Simple sliding window chunker."""
    words = text.split()
    chunks = []
    for i in range(0, len(words), chunk_size - overlap):
        chunk = " ".join(words[i:i + chunk_size])
        if chunk:
            chunks.append(chunk)
    return chunks

def ingest_document(file_path, filename, org_id=DEFAULT_COMPANY_ID, source_type="reference", replace_existing=False):
    """Parse and ingest supported documents into the target company knowledge base."""
    init_db()
    pages = parse_document(file_path)
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Check if already ingested for this company.
    cursor.execute("SELECT COUNT(*) FROM document_chunks WHERE filename = ? AND org_id = ?", (filename, org_id))
    existing_count = cursor.fetchone()[0]
    if existing_count > 0 and not replace_existing:
        conn.close()
        return f"File '{filename}' already ingested."
    if existing_count > 0 and replace_existing:
        cursor.execute("DELETE FROM document_chunks WHERE filename = ? AND org_id = ?", (filename, org_id))
        
    inserted_count = 0
    for page_num, content in pages:
        # We chunk each page if it's too long
        chunks = chunk_text(content, chunk_size=300, overlap=50)
        for chunk in chunks:
            token_est = len(chunk.split())  # Estimate tokens as words
            enriched_chunk = f"[Source Type: {source_type}]\n{chunk}"
            cursor.execute(
                "INSERT INTO document_chunks (org_id, filename, page_number, content, token_count) VALUES (?, ?, ?, ?, ?)",
                (org_id, filename, page_num, enriched_chunk, token_est)
            )
            inserted_count += 1
            
    conn.commit()
    conn.close()
    return f"Successfully ingested {inserted_count} chunks from '{filename}' for company {org_id}."

def ingest_pdf(file_path, filename, org_id=DEFAULT_COMPANY_ID):
    """Backward-compatible PDF ingestion wrapper."""
    return ingest_document(file_path, filename, org_id=org_id, source_type="reference")

def corpus_stats(org_id=DEFAULT_COMPANY_ID):
    """Return corpus counts and source-level chunk distribution."""
    init_db()
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        "SELECT filename, COUNT(*), SUM(token_count), MAX(page_number) FROM document_chunks WHERE org_id = ? GROUP BY filename ORDER BY filename",
        (org_id,)
    )
    sources = [
        {
            "filename": row[0],
            "chunks": row[1],
            "token_estimate": row[2] or 0,
            "sections": row[3] or 0
        }
        for row in cursor.fetchall()
    ]
    cursor.execute("SELECT COUNT(*), COALESCE(SUM(token_count), 0) FROM document_chunks WHERE org_id = ?", (org_id,))
    total_chunks, total_tokens = cursor.fetchone()
    conn.close()
    return {
        "org_id": org_id,
        "sources": sources,
        "total_sources": len(sources),
        "total_chunks": total_chunks,
        "token_estimate": total_tokens
    }

def search_documents(query, org_id=DEFAULT_COMPANY_ID, limit=5):
    """
    Search document chunks scoped by company key.
    Uses simple keyword/regex matching (as a robust local search engine)
    with scoring based on query term frequencies.
    """
    init_db()
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT id, filename, page_number, content FROM document_chunks WHERE org_id = ?", (org_id,))
    all_chunks = cursor.fetchall()
    conn.close()
    
    if not all_chunks:
        return []
        
    # Standardize query words and lightly boost important GRC phrases.
    query_words = [w.lower() for w in re.findall(r'\w+', query) if len(w) > 2]
    phrase_boosts = [
        "cet1", "capital adequacy", "liquidity coverage", "mfa", "multi-factor",
        "pii", "personal data", "encryption", "swift", "vendor", "incident",
        "business continuity", "branch", "payments", "risk appetite"
    ]
    if not query_words:
        # fallback to returning the first few chunks
        return [{"id": c[0], "filename": c[1], "page_number": c[2], "content": c[3], "score": 1.0} for c in all_chunks[:limit]]
        
    scored_chunks = []
    for chunk_id, filename, page_num, content in all_chunks:
        content_lower = content.lower()
        score = 0
        for word in query_words:
            # Add score based on frequency of query words
            score += content_lower.count(word)
        for phrase in phrase_boosts:
            if phrase in query.lower() and phrase in content_lower:
                score += 4
            
        if score > 0:
            scored_chunks.append({
                "id": chunk_id,
                "filename": filename,
                "page_number": page_num,
                "content": content,
                "score": score
            })
            
    # Sort by score descending
    scored_chunks.sort(key=lambda x: x["score"], reverse=True)
    return scored_chunks[:limit]

# Initialize the RAG corpus schema on import. The corpus starts EMPTY - no
# sample/demo regulations are seeded. Documents are added via /api/ingest.
init_db()
