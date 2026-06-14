# GRC Guard AI

GRC Guard AI is a governance, risk, and compliance platform for multi-department
compliance operations. It combines Clerk identity, departmental control ownership,
evidence management, live integrations with real data sources, RAG document
ingestion, and AI agents built on the [agno](https://github.com/agno-agi/agno)
framework.

> **The platform ships with no demo data.** Every organization starts empty. You
> populate it by connecting real data sources, ingesting documents, and creating
> controls/risks/policies through the UI.

## What It Does

- Tracks controls, risks, assets, vendors, policies, evidence, and audit logs.
- Provisions each organization empty, with only configuration scaffolding (the
  connector catalog and AI provider catalog).
- Connects to **real data sources** for live compliance evidence (see Connectors).
- Ingests PDF, TXT, Markdown, CSV, and JSON documents into a RAG corpus.
- Runs compliance analysis and scanning across controls, risks, evidence, assets,
  integrations, and RAG citations.
- Runs GRC **AI agents on agno** (Compliance, TPRM, Customer Trust, Risk
  Propagation), served both in-app and via a standalone **AgentOS + agno UI**.

## AI Architecture (agno)

All AI routes through `backend/ai_gateway.py`, which builds an
[agno](https://github.com/agno-agi/agno) model from the active provider and runs
it with an agno `Agent`. The default provider is **Anthropic Claude**; when no
key is present the gateway degrades to a deterministic local evidence engine so
the app still runs offline.

Supported providers (set a key, or configure in Settings): Claude (default),
Gemini, OpenAI, Azure OpenAI, Groq, OpenRouter, Mistral, DeepSeek, Perplexity,
xAI, Ollama, and any OpenAI-compatible endpoint (local / Vast.ai / custom).

The GRC agents live in `backend/ai_agents.py` (real agno `Agent` objects with
RAG + GRC-graph tools). They are exposed two ways:

1. **In-app** via `POST /api/ai/agent-query`.
2. **AgentOS server** (`backend/agent_os.py`) — the agno HTTP runtime that the
   **agno UI** (`agent-ui/`) connects to for a full chat experience.

## Connectors / Data Sources

Real, credentialed clients live in `backend/integration_clients.py`. The catalog
is provisioned per-organization (all start `Disconnected`):

| Connector | Category | Live check |
|-----------|----------|------------|
| Amazon Web Services | Cloud | S3 bucket encryption |
| Google Cloud Platform | Cloud | GCS encryption / public-access prevention |
| Microsoft Azure | Cloud | Storage Account HTTPS-only + encryption |
| Okta | Identity | User MFA factor enrollment |
| Auth0 | Identity | Users, MFA Guardian, login logs, roles |
| Microsoft Entra ID (M365) | Identity | Per-user MFA via Microsoft Graph |
| Google Workspace | Identity | 2-Step Verification enrollment (Admin SDK) |
| GitHub | Developer | Branch protection / PR review rules |
| Snyk | Developer | Open critical/high vulnerabilities |
| CrowdStrike Falcon | EDR | Endpoint sensor coverage |
| Jamf Pro | EDR | Managed Mac FileVault encryption |
| Workday | HRIS | Active worker roster (RaaS) |

Connect a system from the Integrations page by supplying read-only credentials
(JSON), then run **Sync** to pull live evidence. Credentials are encrypted at
rest with the BYOK vault.

## Repository Structure

```text
backend/    FastAPI API, SQLAlchemy models, RAG, agno AI gateway, agents, connectors
backend/agent_os.py   Standalone AgentOS server (agno UI backend)
frontend/   Next.js App Router UI with Clerk auth and operational dashboards
agent-ui/   agno UI (chat interface for the AgentOS agents)
docs/       PRD, TRD, UI/UX, AI backend, AI use, RAG, and analysis docs
```

## Backend Setup

```bash
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python seed.py        # provisions an EMPTY org + connector/AI catalogs
python -m uvicorn main:app --host 0.0.0.0 --port 8001
```

`backend/.env` (common variables):

```env
DATABASE_URL=sqlite:///./grc_database.db
BYOK_SECRET_KEY=replace-with-local-vault-key
CLERK_SECRET_KEY=replace-with-clerk-secret-key
CLERK_MOCK_AUTH=false
SUPER_ADMIN_ACCESS_KEY=replace-with-admin-access-key
ALLOWED_ORIGINS=http://localhost:3000

# AI (default provider is Claude)
ANTHROPIC_API_KEY=sk-ant-...
# Optional alternatives: OPENAI_API_KEY, GEMINI_API_KEY, GROQ_API_KEY, ...

# Connector credentials can also be supplied per-connector in the UI.
# AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_AUDIT_BUCKET
# GCP_SERVICE_ACCOUNT_JSON / GCP_PROJECT_ID / GCP_AUDIT_BUCKET
# AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET / AZURE_SUBSCRIPTION_ID / AZURE_RESOURCE_GROUP / AZURE_STORAGE_ACCOUNT
# OKTA_ORG_URL / OKTA_API_TOKEN
# AUTH0_DOMAIN / AUTH0_CLIENT_ID / AUTH0_CLIENT_SECRET
# GOOGLE_WORKSPACE_SA_JSON / GOOGLE_WORKSPACE_ADMIN
# GITHUB_TOKEN (or OAuth: GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET)
# SNYK_TOKEN / SNYK_ORG_ID
# CROWDSTRIKE_CLIENT_ID / CROWDSTRIKE_CLIENT_SECRET / CROWDSTRIKE_BASE_URL
# JAMF_BASE_URL / JAMF_CLIENT_ID / JAMF_CLIENT_SECRET
# WORKDAY_REPORT_URL / WORKDAY_USERNAME / WORKDAY_PASSWORD
```

## AgentOS + agno UI

The agno UI is a separate chat app that talks to the AgentOS runtime.

```bash
# 1. Start AgentOS (serves the GRC agents on :7777)
cd backend
python agent_os.py            # or: uvicorn agent_os:app --port 7777

# 2. Start the agno UI
cd agent-ui
npm install
npm run dev                   # http://localhost:3001 (or as printed)
```

In the agno UI, point the endpoint at `http://localhost:7777` (the default).
AgentOS needs an `ANTHROPIC_API_KEY` (or another configured provider) to respond.

## Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

`frontend/.env.local`:

```env
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=replace-with-clerk-publishable-key
CLERK_SECRET_KEY=replace-with-clerk-secret-key
# Same-origin proxy target -> must match the port the backend runs on
BACKEND_API_BASE_URL=http://127.0.0.1:8001
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/
NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=/
```

Do not commit `.env` or `.env.local` files. They are intentionally ignored.

## Key API Areas

- `GET  /api/integrations` — connector catalog + status
- `POST /api/integrations/connect` — store encrypted credentials
- `POST /api/integrations/{id}/sync` — run a live audit
- `POST /api/ingest` / `GET /api/rag/corpus` / `POST /api/rag/search`
- `POST /api/analysis/run` / `POST /api/scan`
- `POST /api/ai/agent-query` — run a GRC agno agent in-app
- `POST /api/super-admin/reset-data` — clear all operational data back to empty

## Verification

```bash
cd backend && python -m pytest -q
cd frontend && npm run build && npm run lint
```

## Notes

- The RAG pipeline is lexical with GRC phrase boosting; vector storage is a
  documented planned upgrade.
- Local Evidence mode lets the app run without external LLM calls.
- Migrating from an older build? Stale demo databases are backed up to
  `backend/_demo_db_backup/` and the app regenerates an empty database.
