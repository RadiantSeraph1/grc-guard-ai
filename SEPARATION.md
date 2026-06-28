# Frontend / Backend Separation

This project is a **two-tier system**. The tiers share no code and no database —
their only contract is HTTP.

```
┌─────────────────────────┐         HTTP / JSON          ┌──────────────────────────┐
│  Frontend (Next.js)     │  ──────────────────────────▶ │  Backend (Python/FastAPI)│
│  frontend/  · :3000     │   BACKEND_API_BASE_URL       │  backend/  · :8001       │
│  - UI + Clerk sign-in   │ ◀──────────────────────────  │  - all business logic    │
│  - thin API proxy route │                              │  - DB, auth, AI, audits  │
└─────────────────────────┘                              └──────────────────────────┘
        (optional)  agent-ui/ :3001  ──▶  AgentOS (agno)  backend/agent_os.py :7777
```

## Why the tiers are already cleanly separated
- **No shared database.** The frontend never touches SQLite/Postgres. All data
  access is in `backend/`.
- **One coupling point.** The frontend reaches the backend only through
  `BACKEND_API_BASE_URL` (used by `frontend/src/app/api/backend/[...path]/route.js`).
  Change that one env var to point the UI at any backend deployment.
- **Auth is verified server-side.** The frontend forwards the Clerk JWT; the
  backend verifies it (`backend/auth.py`). The proxy adds no trust.

## Run the two services

### Locally (two terminals)
```bash
# Terminal 1 — backend
cd backend && python -m uvicorn main:app --port 8001 --reload

# Terminal 2 — frontend
cd frontend && npm run dev -- -p 3000
```

### With Docker Compose (one command)
```bash
cp backend/.env.example backend/.env       # fill in
cp frontend/.env.example frontend/.env.local  # fill in
docker compose up --build
```

## Splitting into two independent git repositories

The folders are self-contained (each has its own `README`, `.env.example`,
`Dockerfile`, `.dockerignore`, and dependency manifest), so extraction is
mechanical. To preserve history per tier:

```bash
# Backend repo
git subtree split --prefix=backend -b backend-only
mkdir ../grc-backend && cd ../grc-backend && git init
git pull ../GRC-AUDOTOR backend-only

# Frontend repo
cd ../GRC-AUDOTOR
git subtree split --prefix=frontend -b frontend-only
mkdir ../grc-frontend && cd ../grc-frontend && git init
git pull ../GRC-AUDOTOR frontend-only
```

After splitting, keep `docker-compose.yml` (and this file) in whichever repo
orchestrates both, or in a small top-level `grc-deploy` repo that references the
two service images.

## `agent-ui/`
`agent-ui/` is a **secondary, optional** dev UI (the upstream agno chat client)
that talks to the AgentOS runtime on `:7777`. It is not one of the two core
deployable services and can be ignored or removed without affecting the GRC app.
