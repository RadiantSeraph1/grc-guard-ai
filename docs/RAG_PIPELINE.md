# RAG Pipeline

## Supported Inputs
- PDF, TXT, Markdown, CSV, JSON

## Ingestion Flow
1. Upload endpoint validates file extension, size, and safe filename.
2. Backend stores the artifact through the storage helper (local disk or S3).
3. A temporary local copy is parsed and split into overlapping chunks.
4. Chunks are batch-embedded when an embedding backend is configured (optional).
5. Chunks are saved to `grc_rag_corpus.db.document_chunks` with org, filename,
   page/section, content, token estimate, and (optionally) a float32 vector.

## Retrieval Flow (hybrid)
1. If the corpus carries vectors and an embedding backend is available, the
   query is embedded and chunks are ranked by cosine similarity (0.85) blended
   with lexical term overlap (0.15).
2. Otherwise retrieval degrades to lexical scoring: term frequency plus boosts
   for banking/GRC phrases.
3. Top chunks are returned as citations to scan, agent, and analysis endpoints.

## Embedding backends
Resolved in `ai_gateway.get_embedding_config`, independent of the chat model:
- Local fine-tuned sentence-transformers model via `EMBEDDING_MODEL_PATH`
  (the Phase-1 trained control-mapping encoder — preferred once trained).
- Hosted fallback: `OPENAI_API_KEY` or `GEMINI_API_KEY` (vectors only, never chat).
- None configured → lexical-only search; nothing breaks.

## Current Limitations
- DOCX is not parsed by backend ingestion.
- Chunk storage is a SQLite sidecar (WAL mode), not a dedicated vector DB.
- No re-ranking stage after the blended score.

## Planned Upgrade
- Re-ranking for citations (cross-encoder, Phase-1 optional extra).
- Track source type, owner, control IDs, and ingestion jobs in first-class models.
- Document deletion / re-index controls.
