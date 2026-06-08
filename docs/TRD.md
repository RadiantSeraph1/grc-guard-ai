# Technical Requirements Document

## Architecture
- Frontend: Next.js App Router, Clerk auth, dark operational dashboard UI.
- Backend: FastAPI, SQLAlchemy, SQLite for app data, sidecar SQLite for RAG chunks and audit logs.
- Auth: Clerk JWT for app users, hidden super-admin access-key session for emergency/platform control.
- AI: provider router through `ai_gateway.py`, with local evidence fallback.
- Storage: local fallback with optional S3-compatible helper.

## Core Backend Domains
- Identity: `User`, `Department`, Clerk sync, role and department access.
- Governance: `Framework`, `Control`, `Policy`, `PolicyAcknowledgment`.
- Risk: `Risk`, `Vendor`, asset exposure, residual scoring.
- Evidence: `Evidence`, upload validation, freshness, control linkage.
- AI/RAG: document chunks, search, corpus stats, analysis, agents.
- Integration: cloud, identity, developer, HRIS, MDM/EDR systems plus simulation.

## API Additions
- `GET /api/rag/corpus`
- `POST /api/rag/search`
- `POST /api/analysis/run`
- `POST /api/super-admin/clerk/sync-users`

## Data Rules
- Company is single-tenant by organization key.
- Departments are internal boundaries and can be empty.
- SuperAdmin is allowed on Admin routes.
- Department-scoped reads must call `require_department_access`.
- Uploaded reference/evidence files are validated by extension and byte limit.
- AI provider and integration secrets are encrypted before storage.

## Non-Functional Requirements
- Local-first operation with no required external LLM.
- Deterministic fallback for demos and offline testing.
- Source-grounded analysis with citations from RAG.
- No frontend exposure of server secrets through `NEXT_PUBLIC_`.
- Safe upload filenames and bounded file sizes.

