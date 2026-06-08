# GRC Guard AI

GRC Guard AI is a banking-focused governance, risk, and compliance platform for multi-department compliance operations. It combines Clerk identity, departmental control ownership, evidence management, live/simulated integrations, RAG document ingestion, and AI-assisted compliance analysis.

## What It Does

- Tracks controls, risks, assets, vendors, policies, evidence, and audit logs.
- Supports a single company with many operating departments.
- Provides a hidden Super Admin dashboard at `/super-admin`.
- Syncs real Clerk users into the platform user registry.
- Ingests PDF, TXT, Markdown, CSV, and JSON documents into a local RAG corpus.
- Runs compliance analysis across controls, risks, evidence freshness, assets, integrations, and RAG citations.
- Routes AI through configurable providers including local evidence fallback, Gemini, OpenAI, Claude, Groq, OpenRouter, Mistral, DeepSeek, Perplexity, xAI, Azure OpenAI, Ollama, local, Vast.ai, and custom OpenAI-compatible endpoints.

## Repository Structure

```text
backend/   FastAPI API, SQLAlchemy models, RAG, AI gateway, integrations, tests
frontend/  Next.js App Router UI with Clerk auth and operational dashboards
docs/      PRD, TRD, UI/UX, AI backend, AI use, RAG, and analysis docs
```

## Backend Setup

```bash
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python seed.py
python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

Create `backend/.env` from your local values. Required or commonly used variables:

```env
DATABASE_URL=sqlite:///./grc_platform.db
BYOK_SECRET_KEY=replace-with-local-vault-key
CLERK_SECRET_KEY=replace-with-clerk-secret-key
CLERK_MOCK_AUTH=false
SUPER_ADMIN_ACCESS_KEY=replace-with-admin-access-key
SUPER_ADMIN_USER_IDS=
SUPER_ADMIN_EMAILS=
SUPER_ADMIN_USERNAMES=
ALLOWED_ORIGINS=http://localhost:3000
```

## Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

Create `frontend/.env.local`:

```env
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=replace-with-clerk-publishable-key
CLERK_SECRET_KEY=replace-with-clerk-secret-key
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/
NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=/
```

Do not commit `.env` or `.env.local` files. They are intentionally ignored.

## Key API Areas

- `POST /api/super-admin/clerk/sync-users`
- `GET /api/super-admin/overview`
- `GET /api/super-admin/control-plane`
- `POST /api/ingest`
- `GET /api/rag/corpus`
- `POST /api/rag/search`
- `POST /api/analysis/run`
- `POST /api/scan`

## Verification

Backend:

```bash
cd backend
python -m pytest -q
```

Frontend:

```bash
cd frontend
npm run build
npm run lint
```

## Documentation

- `docs/PRD.md`
- `docs/TRD.md`
- `docs/UI_UX.md`
- `docs/APPFLOW_AI_BACKEND.md`
- `docs/AI_USE.md`
- `docs/RAG_PIPELINE.md`
- `docs/BACKEND_ANALYSIS.md`

## Current Notes

- The RAG pipeline is currently lexical with banking/GRC phrase boosting; vector storage is documented as a planned upgrade.
- Local Evidence mode allows the app to run without external LLM calls.
- Simulation Lab lets you test integrations before connecting real vendor systems.
