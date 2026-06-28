# GRC Auditor — Backend (Python / FastAPI)

The backend is a standalone Python service. It owns **all** business logic, data,
auth verification, AI orchestration, and the live compliance connectors. The
frontend is a thin client that only talks to this service over HTTP — there is no
shared code or database between the two tiers.

## Stack
- **FastAPI** (`main:app`) — the REST API on `:8001`
- **agno** (`agent_os:app`) — optional AgentOS runtime on `:7777` for the agent UI
- **SQLAlchemy** over SQLite (default) or Postgres (`DATABASE_URL`)
- **Clerk** JWT verification (RS256 via JWKS)
- Live connectors (AWS, GitHub, Okta, Auth0, Entra, GCP, Workspace, CrowdStrike,
  Snyk, Jamf, Workday) in `integration_clients.py`

## Run locally
```bash
cd backend
python -m venv venv
# Windows: .\venv\Scripts\Activate.ps1   |   *nix: source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # then fill in real values
python -m uvicorn main:app --host 0.0.0.0 --port 8001 --reload
```
Health check: <http://localhost:8001/api/health>

Optional agent runtime (for `agent-ui/`):
```bash
python -m uvicorn agent_os:app --host 0.0.0.0 --port 7777
```

## Run with Docker
```bash
docker build -t grc-backend .
docker run --env-file .env -p 8001:8001 grc-backend
```

## Tests
```bash
pytest
```

## Environment
See [.env.example](.env.example) for the full contract. The app runs without any
LLM (deterministic keyword scanner + RAG + dashboards); AI enrichment needs the
in-house model or Groq, and live connector audits need the relevant vendor keys.
When no model is usable, AI features return an explicit "no model available"
notice rather than fabricated output.

## Data files (gitignored, never commit)
- `grc_enterprise.db` — ORM database
- `grc_rag_corpus.db` — RAG vector/lexical corpus
- `grc_audit_logs.db` — append-only scan audit log
