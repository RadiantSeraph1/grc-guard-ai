# GRC Auditor — Remediation Checklist

Tracking the issues found in the code audit (2026-06-27). Severity: 🔴 critical · 🟠 high · 🟡 medium · 🔵 cleanup.
Status: ⬜ todo · 🔧 in progress · ✅ done · ⏸ blocked on decision.

---

## A. Security

| # | Sev | Issue | File / location | Status |
|---|-----|-------|-----------------|--------|
| A1 | 🔴 | Default role is `Admin` — any authed user with no `role` metadata becomes Admin (fail-open privilege). Change to `Viewer`. | [auth.py:208](backend/auth.py:208) | ✅ fixed → `Viewer` |
| A2 | 🔴 | Super-admin granted by JWT `username`. Now: Clerk `sub` IDs + **verified** email only; username path removed; `.env` var dropped. | [auth.py:27-35](backend/auth.py:27), [auth.py:206-212](backend/auth.py:206) | ✅ |
| A3 | 🔴 | Live secrets in plaintext `.env` (Auth0/GitHub/Groq/Clerk/BYOK). Gitignored & never committed, but **rotate** before sharing the repo. | backend/.env | ⬜ **(manual — do this)** |
| A4 | 🟡 | Verify CORS, upload validation, and `hmac.compare_digest` stay correct after refactor. | [main.py:48](backend/main.py:48), [main.py:91](backend/main.py:91) | ⬜ |

## B. Fake / theatre (credibility risks in a defense)

| # | Sev | Issue | File / location | Status |
|---|-----|-------|-----------------|--------|
| B1 | 🔴 | Rebuilt: benchmark now scores the rule baseline on a **held-out** labelled set ([benchmark/holdout_cases.jsonl](backend/benchmark/holdout_cases.jsonl)) with real confusion matrix / precision / recall / F1, plus in-distribution contrast. Fabricated target/workload constants removed. Honest result: **56% held-out vs 100% tuned**, recall 0.22. | [main.py](backend/main.py), [evaluation/page.js](frontend/src/app/evaluation/page.js) | ✅ |
| B2 | 🟠 | Rebuilt: keyword→weight dict replaced with real **TF-IDF relevance to the RAG-retrieved regulation + intrinsic-salience** attribution (no compliance keyword list). | [xai.py](backend/xai.py) | ✅ |
| B3 | 🟠 | Scanner LLM now **authoritative** when a real provider is configured: it confirms/refines/overturns the keyword hint and owns decision+category+explanation. Rule set is the offline fallback. Added `normalize_scan_decision()`. | [main.py:1109](backend/main.py:1109) | ✅ |
| B4 | 🟠 | "TPM 2.0 Remote Attestation" was fully simulated → **REMOVED** entirely (security.py funcs, `/api/attest/*` endpoints, both tests, the frontend "Platform Integrity" tab). Honest "not implemented" notes kept in the report. | security.py, main.py, settings/page.js | ✅ |
| B5 | 🟡 | Reconciled. Providers reduced to **Groq (interim) + `inhouse` (our trained model)** ONLY. `local_evidence` and the deterministic fake-output engine **removed entirely** — when no model is usable, AI features return an explicit "no model available" notice (scanner still gives a real keyword-rule verdict). Docs/README/.env reconciled. | gateway, seed, main, ai_agents, UIs, docs, tests, live DB | ✅ |

## C. Bugs / correctness

| # | Sev | Issue | File / location | Status |
|---|-----|-------|-----------------|--------|
| C1 | 🟠 | "Two active providers" was actually 1-per-org + leftover `test_org_123` pollution in the prod DB. Root cause: `org_id=None` rows. Coerced default org; purged test org. | [ai_gateway.py:118](backend/ai_gateway.py:118), DB | ✅ |
| C2 | 🟠 | Database identity crisis: ORM `.env`=`grc_database.db` which **also** was the RAG corpus file. RAG now uses `grc_rag_corpus.db`; ORM repointed to canonical `grc_enterprise.db`. | [rag.py:18](backend/rag.py:18), [.env](backend/.env) | ✅ |
| C3 | 🟡 | ~~Demo dataset loader~~ — **dropped by request**. Instead, ALL demo traces purged (`_demo_db_backup/` deleted, `demo_script` feature + UI removed, "demo" comments reworded, .gitignore line removed). App is demo-free. | repo-wide | ✅ (purged) |
| C4 | 🔵 | Fixed: SQLite engine now uses **WAL + `busy_timeout=30s` + `synchronous=NORMAL`** (concurrent readers/writer, blocked writers wait not error); raw audit/RAG connections too; Postgres pool (`pool_pre_ping`) for the production path. | [database.py](backend/database.py), main.py, rag.py | ✅ |

## D. Architecture / separation

| # | Sev | Issue | Status |
|---|-----|-------|--------|
| D1 | 🟠 | Decided: **two deployable services** (Python backend + Next.js frontend). Each made self-contained: per-service `README`, `.env.example`, `Dockerfile`, `.dockerignore` + root `docker-compose.yml` + [SEPARATION.md](SEPARATION.md) split guide. | ✅ |
| D2 | 🟡 | Documented run instructions + env contract per tier ([backend/README.md](backend/README.md), [SEPARATION.md](SEPARATION.md)). | ✅ |
| D3 | 🔵 | Stray logs/DBs were already gitignored & untracked (confirmed via `git ls-files`). Nothing to remove from history. | ✅ |
