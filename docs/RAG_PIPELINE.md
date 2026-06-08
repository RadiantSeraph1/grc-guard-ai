# RAG Pipeline

## Supported Inputs
- PDF
- TXT
- Markdown
- CSV
- JSON

## Ingestion Flow
1. Upload endpoint validates file extension, size, and safe filename.
2. Backend stores the artifact through the storage helper.
3. A temporary local copy is parsed.
4. Text is split into overlapping chunks.
5. Chunks are saved to `grc_database.db.document_chunks` with org, filename, page/section, content, and token estimate.

## Retrieval Flow
1. Query is normalized into terms.
2. Banking/GRC phrases receive boosts for better matching.
3. Chunks are scored by term frequency plus phrase relevance.
4. Top chunks are returned as citations to scan, agent, and analysis endpoints.

## Current Limitations
- Retrieval is lexical, not vector embedding based.
- DOCX is not currently parsed by backend ingestion.
- Chunk storage is SQLite sidecar, not Postgres/vector DB.

## Planned Upgrade
- Add embedding generation per chunk.
- Store vectors in Postgres/Supabase pgvector or another vector database.
- Add re-ranking for citations.
- Track source type, owner, control IDs, and ingestion jobs in first-class SQLAlchemy models.
- Add document deletion/re-index controls.

