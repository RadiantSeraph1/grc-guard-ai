# App Flow And AI Backend

## User Flow
1. User signs in with Clerk.
2. Backend verifies Clerk JWT and provisions or repairs a local user record.
3. User accesses department-scoped dashboards based on role and department.
4. Admin/editor uploads policies or evidence.
5. Backend validates, stores, and ingests supported documents into RAG.
6. Analyst runs scan or analysis.
7. Backend retrieves relevant RAG chunks, calculates local posture, optionally calls active AI provider, and returns citations plus recommendations.

## Super Admin Flow
1. Super Admin opens `/super-admin/login`.
2. Access-key session is stored in browser session storage.
3. `/super-admin` loads overview and control-plane data.
4. Super Admin syncs Clerk users, manages departments, providers, integrations, and simulation.

## AI Backend Flow
1. Request arrives at scan, agent, or analysis endpoint.
2. Backend collects structured system state from SQLAlchemy models.
3. RAG search retrieves source chunks from `grc_database.db`.
4. Local rules generate deterministic compliance posture.
5. If an external provider is active and configured, `ai_gateway.py` enriches reasoning.
6. Response returns summary, metrics, citations, attributions, and recommended actions.

## Provider Routing
- `local_evidence`: deterministic fallback.
- Gemini: native Google GenAI adapter.
- Claude: Anthropic Messages API.
- OpenAI-compatible: OpenAI, Groq, OpenRouter, Mistral, DeepSeek, Perplexity, xAI, Azure OpenAI, Ollama, local, Vast.ai, custom.

