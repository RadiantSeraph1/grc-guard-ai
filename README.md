# GRC Guard AI

GRC Guard AI is a governance, risk, and compliance platform for multi-department
compliance operations. It combines Clerk identity, departmental control ownership,
importable compliance frameworks with automatic control mapping, evidence
management, live integrations with real data sources, hybrid (semantic + lexical)
RAG document ingestion, and AI agents built on the
[agno](https://github.com/agno-agi/agno) framework.

> **The platform ships with no demo data.** Every organization starts empty. You
> populate it by connecting real data sources, ingesting documents, and creating
> controls/risks/policies through the UI.

## What It Does

- Tracks controls, risks, assets, vendors, policies, evidence, and audit logs.
- Provisions each organization empty, with only configuration scaffolding (the
  connector catalog and AI provider catalog).
- Imports **compliance frameworks** (SOC 2, ISO 27001, NIST CSF, PCI DSS, GDPR,
  Basel III) and **auto-maps their controls to connector checks**, so a live sync
  satisfies the right control across every framework that shares it.
- Connects to **real data sources** for live compliance evidence (see Connectors).
- Ingests PDF, TXT, Markdown, CSV, and JSON documents into a **hybrid RAG corpus**
  (semantic vector search + lexical fallback).
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

## Compliance Frameworks & Control Mapping

Frameworks are an **importable library** (`backend/framework_library.py`), not
demo data — the organization stays empty until you import what you need.

| Framework | Code | Notes |
|-----------|------|-------|
| SOC 2 Type II | SOC2 | AICPA Trust Services Criteria |
| ISO/IEC 27001:2022 | ISO27001 | ISMS Annex A controls |
| NIST CSF 2.0 | NIST-CSF | Identify/Protect/Detect/Respond/Recover/Govern |
| PCI DSS v4.0 | PCI-DSS | Cardholder data protection |
| GDPR | GDPR | EU personal-data processing |
| Basel III | BASEL-III | Banking capital, liquidity, stress testing |

How it works:

1. **Import** a framework (`POST /api/frameworks/import`). Its required controls
   are materialised into the org. Controls shared across frameworks (e.g. MFA is
   in SOC 2, ISO 27001, NIST CSF, PCI DSS) are created **once** and tagged with
   each framework — importing another framework only adds the tag.
2. **Connectors auto-test controls.** Each control names the connector(s) that
   prove it. When a sync finishes, `apply_connector_result` flips every mapped
   control Passing/Failing and recomputes framework **readiness** — e.g. an AWS
   S3-encryption pass satisfies "Encryption of Data at Rest" everywhere it's
   required. The remaining controls are evidenced manually (policies, documents).
3. **Remove** a framework (`DELETE /api/frameworks/{id}`) strips its tag and
   deletes only controls that belonged solely to it; shared controls survive.

Connector → control coverage: AWS/GCP/Azure → encryption at rest;
Okta/Auth0/Entra/Google Workspace → MFA; GitHub → secure change management;
Snyk → vulnerability management; CrowdStrike → EDR coverage; Jamf → endpoint
disk encryption; Workday → personnel access governance.

## RAG (Hybrid Semantic + Lexical)

Documents ingested via `POST /api/ingest` are chunked and, when an embedding
provider is configured, vectorized (stored per chunk as float32 in
`document_chunks.embedding`). `POST /api/rag/search` then blends cosine
similarity (0.85) with GRC lexical phrase boosting (0.15). With no embedding key,
it degrades transparently to lexical-only — the corpus stays searchable offline.

Embeddings are resolved **independently of the chat provider** (so you can run
Claude for chat and OpenAI/Gemini for vectors): set `OPENAI_API_KEY`
(`text-embedding-3-small`, preferred) or `GEMINI_API_KEY` (`text-embedding-004`).
`GET /api/rag/corpus` reports `search_mode` (`semantic`/`lexical`) and
`embedded_chunks`. After adding a key, re-ingest documents to vectorize them.

## Custom Model Training & Datasets

The `backend/training/` module assembles training data for three custom auditor
models — **control mapping**, **compliance decision**, and **justification
generation**. Each public source is normalized into one canonical JSONL schema.
Full details and the "how it works" walkthrough are in
[`backend/training/README.md`](backend/training/README.md); the strategy is in
[`docs/MODEL_TRAINING_PLAN.md`](docs/MODEL_TRAINING_PLAN.md).

The **NIST SP 800-53** control catalog ships in the repo
(`backend/training/data/processed/nist_800_53_controls.jsonl`). Install the other
datasets locally with:

```bash
# 1. Re-generate the NIST 800-53 catalog (no extra deps; already committed)
python backend/training/scripts/build_oscal_controls.py

# 2. Install the training/ML extras (kept separate from the API's requirements)
python -m venv .venv-train
.venv-train\Scripts\activate            # Windows  (use: source .venv-train/bin/activate on macOS/Linux)
pip install -r backend/training/requirements-train.txt

# 3. Labeled clause datasets from Hugging Face (LEDGAR, UNFAIR-ToS, CUAD)
python backend/training/scripts/build_hf_clause_datasets.py --datasets ledgar unfair_tos cuad

# 4. Compliance PASS/FAIL labels via weak supervision — point --iac-dir at a
#    corpus of Terraform/CloudFormation/Kubernetes files (e.g. cloned public repos)
pip install checkov
python backend/training/scripts/gen_compliance_labels.py --iac-dir /path/to/iac
```

Generated outputs land in `backend/training/data/processed/`. The large ones
(LEDGAR/CUAD/Checkov) are gitignored and meant to be regenerated with the scripts
above; only the small NIST catalog is committed.

## Repository Structure

```text
backend/    FastAPI API, SQLAlchemy models, RAG, agno AI gateway, agents, connectors
backend/agent_os.py          Standalone AgentOS server (agno UI backend)
backend/framework_library.py Importable framework catalog + connector->control mapping
backend/rag.py               Hybrid semantic + lexical document retrieval
backend/training/            Dataset acquisition + prep for custom auditor models
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

# RAG embeddings (enables semantic/vector search; resolved independently of the
# chat provider). Set either key; OpenAI is preferred when both are present.
# Without one, RAG transparently falls back to lexical search.
# OPENAI_API_KEY=sk-...           # text-embedding-3-small
# GEMINI_API_KEY=...              # text-embedding-004
# EMBEDDING_MODEL=                # optional override of the default model

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
- `GET  /api/frameworks` — imported frameworks + live readiness
- `GET  /api/frameworks/library` — importable framework catalog (SOC 2, ISO 27001, NIST CSF, PCI DSS, GDPR, Basel III)
- `POST /api/frameworks/import` — materialise a framework's controls (auto-mapped to connectors)
- `DELETE /api/frameworks/{id}` — remove a framework (keeps controls shared with others)
- `POST /api/ingest` / `GET /api/rag/corpus` / `POST /api/rag/search` (hybrid semantic + lexical)
- `POST /api/analysis/run` / `POST /api/scan`
- `POST /api/ai/agent-query` — run a GRC agno agent in-app
- `POST /api/super-admin/reset-data` — clear all operational data back to empty

## Verification

```bash
cd backend && python -m pytest -q
cd frontend && npm run build && npm run lint
```

## Notes

- The RAG pipeline is hybrid: semantic vector search (OpenAI/Gemini embeddings,
  stored per chunk) blended with GRC lexical phrase boosting, and it falls back
  to lexical-only when no embedding key is configured.
- Local Evidence mode lets the app run without external LLM calls.
- Migrating from an older build? Stale demo databases are backed up to
  `backend/_demo_db_backup/` and the app regenerates an empty database.
