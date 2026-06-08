# Product Requirements Document

## Product
GRC Guard AI is a multi-department banking governance, risk, and compliance platform for ARB Apex Bank.

## Problem
Compliance teams need one operating console for controls, risks, evidence, policies, vendors, integrations, and AI-assisted analysis. The system must support departmental ownership while preserving company-wide oversight for super admins.

## Goals
- Show real users and departments from Clerk and local super-admin provisioning.
- Connect evidence to controls, risks, departments, assets, and source systems.
- Ingest regulatory, policy, and evidence documents into a searchable RAG corpus.
- Generate explainable compliance analysis using local rules and optional external AI providers.
- Support real integrations and local simulation for testing before vendor credentials exist.

## Primary Users
- Super Admin: controls identity, departments, AI providers, integrations, simulation, and reset tools.
- Admin: manages users, controls, evidence, policies, and integrations.
- Auditor: reviews controls, evidence, logs, risk posture, and AI explanations.
- Editor: uploads evidence/policies and updates operational registers.
- Viewer/Employee: reads assigned compliance posture and acknowledges policies.

## Key Capabilities
- Department dashboard with readiness, risks, failed controls, and active integrations.
- Super Admin hidden URL console with identity, departments, integrations, AI providers, and operations.
- Clerk user sync for users created outside the app.
- Document ingestion for PDF, TXT, Markdown, CSV, and JSON.
- RAG search and corpus statistics.
- AI analysis endpoint combining controls, risks, evidence freshness, assets, integrations, and RAG citations.
- BYOK-style credential encryption for stored integration/provider secrets.
- Simulation Lab for local system testing.

## Success Criteria
- A Clerk-created user appears after Sync Clerk Users.
- A department can be created and users assigned to it.
- Uploaded policies/evidence become searchable in RAG.
- Analysis returns metrics, citations, recommended actions, and an AI/local summary.
- Backend tests and frontend production build pass.

