# GRC Auditor — Training Data Module

Acquisition + preparation pipeline for the three custom models described in
[`docs/MODEL_TRAINING_PLAN.md`](../../docs/MODEL_TRAINING_PLAN.md):

1. **Control mapping** — text → control family
2. **Compliance decision** — COMPLIANT / VIOLATION
3. **Justification generation** — auditor report (optional)

Every builder normalizes its source into one **canonical JSONL schema**
(`common.py`):

```json
{ "id","source","text","framework","control_id","label","rationale", "...task-specific extras" }
```

## Layout

```
training/
  common.py                 # canonical schema + write_jsonl
  requirements-train.txt    # ML deps (separate from the app)
  crosswalk/seed_crosswalk.csv   # external labels -> our control families
  scripts/
    build_oscal_controls.py        # NIST 800-53 catalog  (no ML deps)  ✅ runnable now
    build_hf_clause_datasets.py    # LEDGAR / UNFAIR-ToS / CUAD (needs `datasets`)
    gen_compliance_labels.py       # Checkov weak-supervision PASS/FAIL labels
  data/{raw,interim,processed}/    # data lake (gitignored except .gitkeep)
```

## Quick start

```bash
# 1. NIST 800-53 control catalog — already materialized (1,196 controls).
python backend/training/scripts/build_oscal_controls.py
#    -> data/processed/nist_800_53_controls.jsonl

# 2. Install ML extras for the rest
pip install -r backend/training/requirements-train.txt

# 3. Labeled clause datasets (control mapping + fair/unfair)
python backend/training/scripts/build_hf_clause_datasets.py --datasets ledgar unfair_tos cuad
#    -> data/processed/{ledgar,unfair_tos,cuad}.jsonl

# 4. Compliance PASS/FAIL labels via weak supervision
#    (point --iac-dir at a corpus of Terraform/CFN/K8s, e.g. cloned public repos)
python backend/training/scripts/gen_compliance_labels.py --iac-dir /path/to/iac
#    -> data/processed/compliance_checkov.jsonl
```

## Datasets & sources

| Dataset | Source | Task | License |
|---|---|---|---|
| NIST SP 800-53 Rev 5 (OSCAL) | [usnistgov/oscal-content](https://github.com/usnistgov/oscal-content) | mapping anchors + RAG | US public domain |
| LEDGAR (via LexGLUE) | [coastalcph/lex_glue](https://huggingface.co/datasets/coastalcph/lex_glue) | control mapping | CC (per-subtask) |
| UNFAIR-ToS (via LexGLUE) | [coastalcph/lex_glue](https://huggingface.co/datasets/coastalcph/lex_glue) | compliance decision | CC |
| CUAD | [theatticusproject/cuad-qa](https://huggingface.co/datasets/theatticusproject/cuad-qa) | control mapping | CC BY 4.0 |
| Checkov findings | [checkov](https://www.checkov.io/) over public IaC | compliance decision (weak) | per source repo |
| EDGAR-CORPUS (bank/finance) | [eloukas/edgar-corpus](https://huggingface.co/datasets/eloukas/edgar-corpus) | RAG / finance | public domain |
| OPP-115 + GDPR map (privacy) | [usableprivacy.org/data](https://usableprivacy.org/data) | GDPR | academic |

## How it works

The pipeline turns messy, heterogeneous public sources into one uniform training
format, so the model-training step never has to care where a row came from.

**1. One canonical schema (`common.py`).**
Every source is normalized into the same JSONL row:

| field | meaning |
|---|---|
| `id` | deterministic hash of `(source, control_id, text)` — re-running a builder never duplicates rows |
| `source` | which dataset produced it (`oscal`, `ledgar`, `cuad`, `checkov`, …) |
| `text` | the actual snippet/clause/config the model reads |
| `framework` | `nist-800-53`, `gdpr`, `soc-2`, … (when known) |
| `control_id` | the label the model predicts (control family, clause type, or rule id) |
| `label` | `PASS` / `FAIL` / `null` — only set for the compliance-decision task |
| `rationale` | source explanation/guidance (used later for the justification model) |

`record(...)` builds a row; `write_jsonl(path, rows)` writes them. That's the whole contract.

**2. Each builder is a thin adapter.** A builder downloads one source and emits
canonical rows — nothing else:

- **`build_oscal_controls.py`** downloads the NIST OSCAL JSON, walks
  `catalog → groups → controls` (recursing into control enhancements), and for
  each control pulls the **statement** prose (→ `text`) and **guidance** prose
  (→ `rationale`). Output: one row per control = the *label space* the auditor
  maps onto, plus a clean RAG corpus. No ML libraries needed.
- **`build_hf_clause_datasets.py`** loads LEDGAR / UNFAIR-ToS / CUAD via
  Hugging Face `datasets` and maps their native fields onto the schema
  (LEDGAR provision → `control_id`; UNFAIR-ToS unfair flag → `label=FAIL`;
  CUAD clause type → `control_id`).
- **`gen_compliance_labels.py`** is the answer to "there's no labeled
  compliant/violation dataset": it runs **Checkov** over your IaC files and
  converts each `passed_checks` / `failed_checks` finding into a row with
  `label=PASS|FAIL` and the rule id (`CKV_AWS_*`) as `control_id`. This is
  **weak supervision** — fast, free labels that are noisy but plentiful.

**3. The crosswalk unifies label spaces.** Different sources use different
vocabularies (LEDGAR says *"Audits"*, Checkov says *"CKV_AWS_18"*, NIST says
*"AU-2"*). `crosswalk/seed_crosswalk.csv` maps all of them onto **your** control
families so a model trained across sources speaks one language. Extend this file
as you add sources.

**4. How the data feeds the three models** (see the plan doc):

```
nist_800_53_controls.jsonl ─┬─► control-mapping anchors (Task 1) ─► rag.py embeddings
ledgar.jsonl / cuad.jsonl  ─┘
unfair_tos.jsonl ───────────┬─► compliance classifier (Task 2) ─► /api/scan decision
compliance_checkov.jsonl ───┘
rationale fields ─────────────► justification fine-tune (Task 3, optional)
```

Add a new source = write one builder that emits canonical rows + one crosswalk
line. Everything downstream stays the same.

## What gets committed to git

`data/.gitignore` controls this:

- ✅ **committed:** all scripts, `common.py`, `crosswalk/`, `requirements-train.txt`,
  `README.md`, and the **`processed/nist_800_53_controls.jsonl`** dataset
  (~1.1 MB, allow-listed).
- ❌ **ignored (regenerate via scripts):** `data/raw/` and `data/interim/` caches,
  and the larger `processed/*.jsonl` outputs (LEDGAR, CUAD, Checkov) — these can
  be tens/hundreds of MB, so they're rebuilt with the commands above rather than
  pushed.

So after `git push`, a teammate who clones gets the code + the NIST dataset
immediately, and runs the build scripts to materialize the rest. To force-commit
an ignored dataset anyway: `git add -f data/processed/<file>.jsonl`.

## Notes

- **Weak labels are noisy.** Checkov coverage is partial; always keep a
  hand-labeled gold set under `data/eval/` for real metrics.
- **Licensing / PII.** Respect each source's license; redact secrets from any
  scraped IaC before training. Never train on tenant data without consent —
  preserve the app's `org_id` isolation.
- **No training code yet** — this module stops at materialized datasets, per the
  agreed plan-first scope. Training scripts (`train_control_mapper.py`, etc.)
  come next.
```
```
