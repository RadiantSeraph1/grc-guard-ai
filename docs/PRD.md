# Product Requirements Document

## Product
GRC Guard AI is a multi-department governance, risk, and compliance platform for a single organization (bank-oriented), with departmental ownership and company-wide super-admin oversight.

## Problem
Compliance teams need one operating console for controls, risks, evidence, policies, vendors, integrations, and AI-assisted analysis — grounded in live evidence from real systems, not manually maintained spreadsheets.

## Goals
- Show real users and departments from Clerk and local super-admin provisioning.
- Connect evidence to controls, risks, departments, assets, and source systems via live vendor APIs (no canned data).
- Ingest regulatory, policy, and evidence documents into a searchable RAG corpus (hybrid vector + lexical).
- Generate explainable compliance analysis: a deterministic rule baseline plus an authoritative AI verdict when a model is configured.
- Target a single in-house trained GRC model; use Groq as the interim provider until it is ready. No other AI vendors.

## Primary Users
- Super Admin: controls identity, departments, AI providers, integrations, and reset tools.
- Admin: manages users, controls, evidence, policies, and integrations.
- Auditor: reviews controls, evidence, logs, risk posture, and AI explanations.
- Editor: uploads evidence/policies and updates operational registers.
- Viewer/Employee: reads assigned compliance posture and acknowledges policies. **Default role for any new user is Viewer (fail-closed).**

## Key Capabilities
- Department dashboard with readiness, risks, failed controls, and active integrations — all computed from real rows, empty until populated.
- Hidden super-admin console (`/super-admin`) with identity, departments, integrations, AI providers, and operations.
- Clerk user sync for users created outside the app.
- Document ingestion (PDF, TXT, Markdown, CSV, JSON) into an org-scoped RAG corpus.
- Live connectors: AWS, GCP, Azure, Okta, Auth0, Entra ID, Google Workspace, GitHub, Snyk, CrowdStrike, Jamf, Workday. Each sync flips mapped framework controls Passing/Failing and records drift.
- Importable framework library (SOC 2, ISO 27001, NIST CSF, PCI DSS, GDPR, Basel III) with shared cross-tagged controls.
- AI scanner with keyword-rule baseline, RAG citations, token-level attribution, and an honest held-out benchmark (accuracy, precision/recall/F1, confusion matrix).
- BYOK-style envelope encryption for stored integration/provider secrets.
- When no AI model is usable, AI features return an explicit "no model available" notice — never fabricated output.

## Explicitly Out of Scope
- Demo/sample data of any kind (the app ships empty by design).
- Simulated evidence or simulated attestation (removed).
- Multi-vendor AI provider marketplace (removed; in-house model + interim Groq only).

## Success Criteria
- A Clerk-created user appears after Sync Clerk Users.
- A department can be created and users assigned to it.
- Connecting a real integration and syncing flips its mapped controls and updates framework readiness.
- Uploaded policies/evidence become searchable in RAG.
- Analysis returns metrics, citations, recommended actions, and an AI/rule summary.
- Backend test suite passes in CI.
