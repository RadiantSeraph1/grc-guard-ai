# GRC Auditor — Custom Model Training Plan

Covers the three model tasks selected (Phase-1 training script exists:
`backend/training/scripts/train_control_mapper.py`):
**(1) control mapping**, **(2) compliance decision**, **(3) justification generation**.
Each maps to a real seam in the existing codebase (`backend/rag.py`,
`backend/main.py` `/api/scan`, `backend/ai_gateway.py`).

> **Guiding principle:** don't fine-tune one big LLM to do everything. Train two
> small, cheap, verifiable models (embeddings + classifier) where labels exist or
> can be generated, and keep generation on a strong base model (interim Groq) + RAG.

---

## 0. Recommended order & rationale

| Phase | Model | Why first / later |
|-------|-------|-------------------|
| 1 | **Control mapping** (bi-encoder) | Highest ROI, real labels exist, plugs straight into `rag.py`. Also produces the embedding the classifier reuses. |
| 2 | **Compliance decision** (classifier) | Depends on weak-supervision labels generated from rule engines; can share Phase-1 encoder. |
| 3 | **Justification gen** (LoRA, optional) | Lowest ROI vs. Claude+RAG; only if offline/cost demands it. Needs the most data. |

---

## 1. Shared data infrastructure

Proposed layout (created in Phase 0):

```
backend/training/
  data/
    raw/         # untouched downloads (LexGLUE, CUAD, OSCAL, scraped IaC…)
    interim/     # normalized but not split
    processed/   # final train/val/test JSONL per task
  crosswalk/     # external-label → our-control-family mappings (CSV/JSON)
  scripts/       # download_*.py, label_*.py, build_*.py  (Phase 1+, not now)
  artifacts/     # trained model checkpoints (or push to S3 via s3_storage.py)
  eval/          # gold sets + metrics
```

**Canonical record schema** (one JSONL line; superset — tasks use subsets):

```json
{
  "id": "uuid",
  "source": "ledgar|cuad|checkov|kics|oscal|unfair_tos|edgar|manual",
  "text": "the snippet / clause / config block",
  "framework": "soc-2|iso-27001|nist-800-53|pci-dss|gdpr|basel-iii|cis",
  "control_id": "AC-2 | CIS-1.4 | <our control_code>",
  "label": "PASS|FAIL|null",
  "rationale": "optional source explanation",
  "split": "train|val|test"
}
```

**Crosswalk** is the linchpin: a table mapping each external label space
(LEDGAR provision, CIS rule, NIST control) onto **our** control families
(`models.Control.control_code` / `frameworks`). Build it once, reuse everywhere.
Seed it from the **Secure Controls Framework (SCF)** cross-framework mapping
spreadsheet and NIST 800-53↔CIS mappings.

---

## 2. Task 1 — Control mapping (text → control family)

**Objective:** given a policy/config/log snippet, return the most relevant
control(s). Replaces/augments the lexical+vector match in `rag.search_documents`.

- **Model:** fine-tuned **bi-encoder** (`sentence-transformers`, base
  `BAAI/bge-base-en-v1.5` or `all-MiniLM-L6-v2` for speed) + optional
  **cross-encoder** reranker for top-k.
- **Datasets:**
  - **LEDGAR** (in [`coastalcph/lex_glue`](https://huggingface.co/datasets/coastalcph/lex_glue)) — provision→category, the prime analogue.
  - **CUAD** ([`theatticusproject/cuad-qa`](https://huggingface.co/datasets/theatticusproject/cuad-qa)) — 41 clause types.
  - **NIST 800-53 OSCAL** ([`usnistgov/oscal-content`](https://github.com/usnistgov/oscal-content)) — control titles + "discussion" text become the label-space anchors.
  - **Our own** `controls` rows (`control_code`, `title`, `description`).
- **Method:** contrastive learning. Positive = `(snippet, its control text)`;
  **hard negatives** = sibling controls in the same family.
  `MultipleNegativesRankingLoss`.
- **Schema used:** `{anchor_text, positive_control_id, negatives:[control_id...]}`.
- **Eval:** Recall@1/5, MRR on a held-out split **and** against our seeded
  controls (does it map a known-SOC2 snippet to the SOC2 control?).
- **Integration:** done — set `EMBEDDING_MODEL_PATH` to the trained artifact and `ai_gateway.embed_texts` serves it to all RAG search. Optionally add
  `POST /api/controls/classify` returning ranked control_ids + score.
- **Compute:** MiniLM/bge-base fine-tunes on one T4/A10 in **hours**; CPU works but slow.

---

## 3. Task 2 — Compliance decision (COMPLIANT vs VIOLATION)

**Objective:** binary (or per-control) PASS/FAIL on a config/log snippet. Feeds
the decision step in `/api/scan`.

> **Reality:** there is **no** large public "config → pass/fail" dataset.
> We generate one with rule engines (weak supervision).

- **Model:** encoder classifier (`microsoft/deberta-v3-base`) **or** a linear
  head on the Phase-1 embedding (cheaper, shares weights).
- **Label generation (the core work):**
  1. Collect IaC (Terraform/CloudFormation/K8s) from **permissively licensed**
     public GitHub repos.
  2. Run **Checkov** (1,000+ policies → CIS/SOC2/HIPAA/PCI/NIST) and **KICS**
     (1,900+ queries) over them.
  3. Normalize each finding → `{snippet, framework, control_id, label: PASS|FAIL, source_rule}`.
  4. Dedup, balance classes, hold out a **hand-labeled gold set** for eval.
- **Real labeled supplements:** **UNFAIR-ToS** (fair/unfair, in LexGLUE) and
  **CLAUDETTE/"Claudette meets GDPR"** ([SSRN](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=3208596)) for the policy/GDPR side.
- **Caveats:** scanner labels are **noisy and coverage-limited** → treat as weak
  supervision, never as gold; evaluate only on the hand-labeled set. Strip
  secrets/PII from scraped configs before training.
- **Eval:** F1 per control family on gold; **calibration** — align model
  probability with the `confidence` field `/api/scan` already returns
  (`compute_scan_confidence`).
- **Integration:** decision step in `main.py` `scan_text`.
- **Compute:** DeBERTa-base on one T4/A10, hours.

---

## 4. Task 3 — Justification / remediation generation (optional)

**Objective:** produce the auditor report (summary / reasoning / remediation).

- **Recommendation:** keep **Claude via `ai_gateway` + RAG**. Only LoRA-tune a
  small open model if you need fully offline or lower per-call cost.
- **If tuning:** LoRA/QLoRA on a 7–8B instruct base (`Qwen2.5-7B-Instruct`,
  `Llama-3.1-8B-Instruct`).
  - **Instruction pairs from:** CUAD (clause → explanation), NIST control
    "discussion" (control → remediation), and **your own scan logs**
    (`decision + evidence → justification`) once volume accrues.
  - **Format:** `{system, input: text+retrieved_evidence+decision, output: {summary, reasoning, remediation}}`.
  - **Later:** DPO from real auditor 👍/👎 feedback.
- **Eval:** rubric LLM-as-judge + human spot-check; **faithfulness** to retrieved
  evidence (no invented controls — matches the existing agent instructions).
- **Integration:** the `inhouse` provider slot in `ai_gateway.py` is already live — serve the tuned model behind any OpenAI-compatible endpoint (vLLM) and set its base_url. The app needs zero code changes.
- **Compute:** 7–8B QLoRA needs ~**24 GB** VRAM (A10/A100/3090/4090).

---

## 5. Governance, licensing, isolation

- **Licenses:** CUAD = CC BY 4.0; LexGLUE = mostly permissive/CC (per-subtask);
  OPP-115 = academic; Pile of Law = mixed (check per-source); EDGAR = US public
  domain. Scraped IaC — **respect each repo's license; prefer MIT/Apache.**
- **Tenant data:** do **not** train on customer/org data without consent. Preserve
  the org isolation already enforced (`org_id`) — training corpora stay separate
  from tenant tables.
- **PII/secrets:** run secret-scanning + redaction on any scraped configs.

---

## 6. Phased roadmap & tooling

- **Phase 0 (1–2 days):** scaffold `backend/training/`, build the crosswalk.
- **Phase 1:** Task-1 embeddings → eval → wire into `rag.py`.
- **Phase 2:** Task-2 weak-supervision pipeline → classifier → gold eval.
- **Phase 3:** assemble hand-labeled gold sets (both tasks).
- **Phase 4 (optional):** Task-3 LoRA generator.

**Libraries:** `sentence-transformers`, `transformers`, `datasets`,
`scikit-learn`, `peft`/`trl`; scanners `checkov`, `kics`. Optional tracking:
Weights & Biases. Artifacts → `backend/training/artifacts/` or S3 via existing
`s3_storage.py`.

**Hardware:** encoders (Tasks 1–2) run on a single T4/A10; the optional 7–8B LoRA
(Task 3) needs a ~24 GB GPU.
```
```
