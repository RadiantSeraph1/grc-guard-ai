import os
import re
import json
import csv
import struct
from pathlib import Path
from pypdf import PdfReader
from dotenv import load_dotenv
from sqlalchemy import func

# Load env variables
load_dotenv()

import models
from database import SessionLocal

DEFAULT_COMPANY_ID = os.environ.get("DEFAULT_COMPANY_ID", "bank_enterprise")

# ---------------------------------------------------------------------------
# Embedding (de)serialization + similarity
# ---------------------------------------------------------------------------

def _pack_embedding(vector):
    """Serialize a list[float] embedding to compact float32 bytes."""
    if not vector:
        return None
    return struct.pack(f"{len(vector)}f", *vector)


def _unpack_embedding(blob):
    """Deserialize float32 bytes back to a list[float]."""
    if not blob:
        return None
    count = len(blob) // 4
    if count == 0:
        return None
    return list(struct.unpack(f"{count}f", blob))


def _embed_chunks(texts):
    """Embed chunk texts via the AI gateway; returns list or None on failure."""
    try:
        import ai_gateway
        return ai_gateway.embed_texts(texts)
    except Exception as e:
        print(f"RAG embedding skipped: {e}")
        return None


def _cosine(a, b):
    """Cosine similarity between two equal-length vectors (pure Python)."""
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = 0.0
    na = 0.0
    nb = 0.0
    for x, y in zip(a, b):
        dot += x * y
        na += x * x
        nb += y * y
    if na <= 0.0 or nb <= 0.0:
        return 0.0
    return dot / ((na ** 0.5) * (nb ** 0.5))

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

def anonymize_pii(text: str) -> tuple:
    """GDPR-compliant anonymization of text before embedding.

    Returns (redacted_text, redaction_count) so callers can record how many
    redactions were applied per chunk - an auditor-facing count, not just a
    silent transformation (Ch.3 Layer 1 "GDPR-compliant anonymization").
    """
    count = 0
    # Redact Emails
    text, n = re.subn(r'[\w\.-]+@[\w\.-]+\.\w+', '[REDACTED_EMAIL]', text)
    count += n
    # Redact SSNs / Credit Cards (basic)
    text, n = re.subn(r'\b\d{3}-\d{2}-\d{4}\b', '[REDACTED_SSN]', text)
    count += n
    text, n = re.subn(r'\b(?:\d{4}[ -]?){3}\d{4}\b', '[REDACTED_CC]', text)
    count += n
    # Redact Phone Numbers
    text, n = re.subn(r'\b\d{3}[-.]?\d{3}[-.]?\d{4}\b', '[REDACTED_PHONE]', text)
    count += n
    return text, count

def ingest_document(file_path, filename, org_id=DEFAULT_COMPANY_ID, source_type="reference", replace_existing=False, effective_date=None, expiration_date=None, regulatory_version=None):
    """Parse and ingest supported documents into the target company knowledge base."""
    pages = parse_document(file_path)
    
    db = SessionLocal()
    try:
        # Check if already ingested for this company.
        existing_count = db.query(models.VectorChunk).filter_by(filename=filename, org_id=org_id).count()
        if existing_count > 0 and not replace_existing:
            return f"File '{filename}' already ingested."
        if existing_count > 0 and replace_existing:
            db.query(models.VectorChunk).filter_by(filename=filename, org_id=org_id).delete()
            db.commit()
            
        # Build all enriched chunks first so embeddings can be computed in one batch.
        rows = []  # (page_num, enriched_chunk, redaction_count)
        total_redactions = 0
        for page_num, content in pages:
            # We chunk each page if it's too long
            chunks = chunk_text(content, chunk_size=300, overlap=50)
            for chunk in chunks:
                clean_chunk, redactions = anonymize_pii(chunk)
                total_redactions += redactions
                enriched_chunk = f"[Source Type: {source_type}]\n{clean_chunk}"
                rows.append((page_num, enriched_chunk, redactions))

        # Vectorize the chunk texts. Falls back to None (lexical-only) when no
        # embedding provider is configured or the call fails.
        embeddings = _embed_chunks([r[1] for r in rows]) if rows else None

        inserted_count = 0
        for idx, (page_num, enriched_chunk, redactions) in enumerate(rows):
            blob = None
            if embeddings and idx < len(embeddings):
                blob = _pack_embedding(embeddings[idx])

            chunk_record = models.VectorChunk(
                org_id=org_id,
                filename=filename,
                page_number=page_num,
                content=enriched_chunk,
                embedding=blob,
                effective_date=effective_date,
                expiration_date=expiration_date,
                regulatory_version=regulatory_version,
                pii_redaction_count=redactions
            )
            db.add(chunk_record)
            inserted_count += 1

        db.commit()
        mode = "semantic+lexical" if embeddings else "lexical"
        redaction_note = f", {total_redactions} PII redaction(s) applied" if total_redactions else ""
        return f"Successfully ingested {inserted_count} chunks ({mode}) from '{filename}' for company {org_id}{redaction_note}."
    finally:
        db.close()

def ingest_pdf(file_path, filename, org_id=DEFAULT_COMPANY_ID):
    """Backward-compatible PDF ingestion wrapper."""
    return ingest_document(file_path, filename, org_id=org_id, source_type="reference")

def corpus_stats(org_id=DEFAULT_COMPANY_ID):
    """Return corpus counts and source-level chunk distribution."""
    db = SessionLocal()
    try:
        sources_query = db.query(
            models.VectorChunk.filename,
            func.count(models.VectorChunk.id).label('chunks'),
            func.max(models.VectorChunk.page_number).label('sections')
        ).filter_by(org_id=org_id).group_by(models.VectorChunk.filename).all()
        
        sources = [
            {
                "filename": row.filename,
                "chunks": row.chunks,
                "token_estimate": 0, # Tokens no longer stored in DB, ignore
                "sections": row.sections or 0
            }
            for row in sources_query
        ]
        
        total_chunks = db.query(models.VectorChunk).filter_by(org_id=org_id).count()
        embedded_chunks = db.query(models.VectorChunk).filter(models.VectorChunk.org_id == org_id, models.VectorChunk.embedding.isnot(None)).count()
    finally:
        db.close()

    embeddings_active = False
    try:
        import ai_gateway
        embeddings_active = ai_gateway.embeddings_available()
    except Exception:
        embeddings_active = False

    return {
        "org_id": org_id,
        "sources": sources,
        "total_sources": len(sources),
        "total_chunks": total_chunks,
        "embedded_chunks": embedded_chunks,
        "token_estimate": 0,
        "search_mode": "semantic" if (embeddings_active and embedded_chunks > 0) else "lexical",
        "embeddings_available": embeddings_active,
    }

def search_documents(query, org_id=DEFAULT_COMPANY_ID, limit=5):
    """Hybrid search over company-scoped document chunks.

    When an embedding provider is configured and chunks carry vectors, results
    are ranked by semantic cosine similarity blended with a lexical term-overlap
    signal. Otherwise it degrades to the lexical scorer so the corpus remains
    searchable offline. The returned shape is unchanged for all callers.
    """
    db = SessionLocal()
    try:
        from datetime import date
        today_str = date.today().isoformat()
        all_chunks = (
            db.query(models.VectorChunk)
            .filter_by(org_id=org_id)
            .filter(
                (models.VectorChunk.expiration_date == None) |
                (models.VectorChunk.expiration_date >= today_str)
            )
            .all()
        )
    finally:
        db.close()

    if not all_chunks:
        return []

    # Standardize query words and lightly boost important GRC phrases.
    query_words = [w.lower() for w in re.findall(r'\w+', query) if len(w) > 2]
    phrase_boosts = [
        "cet1", "capital adequacy", "liquidity coverage", "mfa", "multi-factor",
        "pii", "personal data", "encryption", "swift", "vendor", "incident",
        "business continuity", "branch", "payments", "risk appetite"
    ]
    query_lower = query.lower()

    # Attempt a semantic query embedding. None -> lexical-only path.
    query_vec = None
    has_vectors = any(row.embedding for row in all_chunks)
    if has_vectors:
        try:
            import ai_gateway
            query_vec = ai_gateway.embed_query(query)
        except Exception as e:
            print(f"Query embedding skipped: {e}")
            query_vec = None

    def lexical_score(content_lower):
        score = 0
        for word in query_words:
            score += content_lower.count(word)
        for phrase in phrase_boosts:
            if phrase in query_lower and phrase in content_lower:
                score += 4
        return score

    # --- Semantic (hybrid) path ---
    if query_vec:
        scored = []
        max_lex = 1
        prelim = []
        for chunk in all_chunks:
            vec = _unpack_embedding(chunk.embedding)
            sim = _cosine(query_vec, vec) if vec else 0.0
            lex = lexical_score(chunk.content.lower())
            max_lex = max(max_lex, lex)
            prelim.append((chunk.id, chunk.filename, chunk.page_number, chunk.content, sim, lex))
        for chunk_id, filename, page_num, content, sim, lex in prelim:
            # Blend: semantic dominates, lexical overlap is a light tie-breaker.
            blended = round(0.85 * sim + 0.15 * (lex / max_lex), 6)
            scored.append({
                "id": chunk_id,
                "filename": filename,
                "page_number": page_num,
                "content": content,
                "score": blended,
                "semantic": round(sim, 4),
            })
        scored.sort(key=lambda x: x["score"], reverse=True)
        return scored[:limit]

    # --- Lexical-only path ---
    if not query_words:
        # fallback to returning the first few chunks
        return [{"id": c.id, "filename": c.filename, "page_number": c.page_number, "content": c.content, "score": 1.0} for c in all_chunks[:limit]]

    scored_chunks = []
    for chunk in all_chunks:
        score = lexical_score(chunk.content.lower())
        if score > 0:
            scored_chunks.append({
                "id": chunk.id,
                "filename": chunk.filename,
                "page_number": chunk.page_number,
                "content": chunk.content,
                "score": score
            })

    # Sort by score descending
    scored_chunks.sort(key=lambda x: x["score"], reverse=True)
    return scored_chunks[:limit]
