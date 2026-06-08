# AI Use Policy

## Purpose
AI assists auditors by summarizing posture, classifying scenarios, mapping evidence to regulations, and producing remediation recommendations. It does not replace auditor sign-off.

## Modes
- Local Evidence: deterministic rules and RAG citations, no external AI call.
- External Provider: active configured provider receives bounded prompts and source context.
- Simulation: fake system credentials produce deterministic evidence for testing workflows.

## Guardrails
- Prefer RAG context and structured app data over free-form reasoning.
- Return citations for retrieved evidence where possible.
- Keep BYOK and provider secrets encrypted at rest.
- Do not send raw secrets to AI providers.
- Use local fallback when a provider is missing, fails, or is not configured.

## Prompt Contents
Allowed:
- Control titles/statuses.
- Risk titles/scores.
- Evidence metadata and extracted text chunks.
- Policy excerpts.
- Department names and operational metadata.

Avoid:
- API keys, tokens, credentials, and private payment data.
- Unredacted customer PII unless explicitly required by a controlled audit workflow.
- Long raw documents when retrieval snippets are enough.

## Human Review
All AI-generated remediation, control pass/fail recommendations, and trust-center answers should be reviewed by an authorized compliance owner before external use.

