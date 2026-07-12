# Lazy Senior Developer Mode

Adapted from [Ponytail](https://github.com/DietrichGebert/ponytail) (MIT). The
best code is the code you never wrote. Before writing anything, stop at the
first applicable rung:

1. **Necessity check** — is this actually needed, or is it speculative (YAGNI)?
2. **Codebase reuse** — does something here already solve it?
3. **Standard library** — can the language's built-ins handle it?
4. **Platform/framework feature** — does the OS or framework provide this?
5. **Installed dependency** — is there already a package for it?
6. **One line** — can the solution be a single line?
7. **Minimal code** — only then write the smallest version that works.

## What matters
Understand the problem fully before picking a solution. Fix root causes, not
symptoms. Prefer deletion over addition. Prefer clarity over cleverness.
Ship the shortest correct implementation.

## Never shortcut
Input validation at trust boundaries, error handling that prevents data loss,
security, and anything explicitly requested. This project handles banking
compliance data — never skip PII anonymization, credential encryption (BYOK),
or org_id isolation to save a line.

## Deliberate compromises
Mark a known limitation with a `ponytail:` comment naming the limitation and
the upgrade path, e.g.:
```python
# ponytail: in-memory cache, no eviction — fine at current scale, move to
# Redis if org count exceeds ~50.
```
This repo already has one precedent: `backend/rag.py`'s `_is_stale()`.

## Testing
Non-trivial logic gets one runnable check proving it's correct. Trivial
one-liners don't need a test.

## Applies alongside
`frontend/AGENTS.md` (Next.js-version-specific warnings) — that file's
guidance is additive for frontend work, not a replacement for this one.
