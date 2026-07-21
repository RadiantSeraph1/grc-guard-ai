# Fine-Tuning on Vertex AI Without a GPU

## Why this exists

Phase 1 of the training plan ([`MODEL_TRAINING_PLAN.md`](MODEL_TRAINING_PLAN.md)
Task 3) originally called for QLoRA domain fine-tuning on a CUDA GPU
(`backend/training/scripts/train_lora.py`). This project's `GPUS_ALL_REGIONS`
quota increase request was **denied** on `claude-code-501412`, so that script
cannot run here — there is no accelerator to provision.

Vertex AI's **Supervised Fine-Tuning (SFT)** service sidesteps this entirely:
the training job runs on Google's own managed fleet, not on any accelerator the
caller reserves. It is billed and quota-gated as a *tuning job*, a completely
separate resource from the `aiplatform.googleapis.com/online_prediction_requests`
and GPU quotas that blocked the other paths. No GPU, no VM, no Colab needed —
the whole process runs from a laptop with `gcloud` auth and the app's existing
Python venv.

## What gets tuned, and on what data

The base model is **`gemini-2.5-flash`** — the same model already serving the
GRC Brain in production (`ai_gateway.PROVIDER_DEFAULT_MODEL`). Tuning it (rather
than a separate open-weight model) means the tuned model is a drop-in swap for
the existing provider slot, with zero serving infrastructure to stand up.

The training data is the perspective-labeled instruction set in
[`backend/scripts/prepare_finetune_dataset.py`](../backend/scripts/prepare_finetune_dataset.py):
Basel III capital/liquidity, CBEST threat classification (explicitly
perspective-aware — attacker vs. user/victim framing of the *same* scenario),
GDPR, AML/KYC, SOC 2, and cross-jurisdictional conflict examples, each labeled
with a structured JSON decision (`decision`, `category`, `confidence`,
`reasoning`, `regulatory_reference`, `jurisdictional_note`). The script
augments each seed example with two phrasing variants (Q&A format, role-play
format), so the shipped dataset is 3x the seed count.

## Two ways to run it

- **In-app button:** Settings → AI Gateway → the Gemini provider card has a
  **"Fine-tune on Vertex AI"** button. Click it and the backend runs the whole
  pipeline below as a background job against the seed dataset baked into
  `vertex_tune_lib.build_seed_dataset()`; the card polls every 15s and shows
  `RUNNING` → the tuned model resource name with a **"Use as model override"**
  button once done, or the error if the job failed.
- **CLI:** `vertex_finetune.py`, for a custom dataset or to run outside the app
  process (e.g. from a CI job). Both entry points share the same logic in
  `backend/vertex_tune_lib.py` — deliberately kept at the top level, not under
  `backend/training/`, since that directory is `.dockerignore`'d out of the
  production image — so they never drift apart.

## Pipeline

```
prepare_finetune_dataset.py          vertex_finetune.py
┌─────────────────────────┐          ┌──────────────────────────────────────┐
│ Alpaca-style JSONL:      │  ──────▶ │ 1. convert to Gemini tuning format   │
│ {instruction,input,      │          │    (contents: [user turn, model turn])│
│  output, metadata}       │          │ 2. upload to gs://.../training/      │
└─────────────────────────┘          │ 3. submit SFT job (google-genai SDK) │
                                      │ 4. poll until SUCCEEDED/FAILED       │
                                      │ 5. print tuned model resource name   │
                                      └──────────────────────────────────────┘
```

**Step 1 — build the dataset.**

```bash
python backend/scripts/prepare_finetune_dataset.py --output grc_finetune.jsonl
```

Produces `grc_finetune.jsonl`, one Alpaca-style row per line:
`{"instruction": "...", "input": "...", "output": "...", "metadata": {...}}`.

**Step 2 — convert + submit.**

```bash
python backend/training/scripts/vertex_finetune.py --dataset grc_finetune.jsonl
```

This script (`backend/training/scripts/vertex_finetune.py`):

1. Loads the Alpaca rows and reshapes each into Gemini's tuning schema —
   a `contents` array with one `user` turn (`instruction` + `input`
   concatenated) and one `model` turn (the target `output`). Vertex SFT trains
   on this exact chat-turn structure, not free-text prompts.
2. Uploads the converted JSONL to
   `gs://grc-guard-uploads-claude-code-501412/training/vertex-finetune/`
   (the same GCS bucket the app already uses for uploads —
   `GCS_BUCKET` in `k8s/configmap.yaml`) — Vertex SFT requires a `gs://` URI,
   not inline data.
3. Calls `google.genai.Client(vertexai=True, project=..., location=...).tunings.tune()`,
   reusing the exact `VERTEX_AI_PROJECT` / `VERTEX_AI_LOCATION` values
   `ai_gateway.py` already reads from the environment — same project, same
   region, same Application Default Credentials, no separate auth step.
4. Polls the returned `TuningJob` every 30s and prints state transitions
   (`JOB_STATE_QUEUED` → `JOB_STATE_RUNNING` → `JOB_STATE_SUCCEEDED`).
5. On success, prints the tuned model's **endpoint** resource name
   (`projects/.../locations/.../endpoints/...`) — Vertex serves tuned Gemini
   models through their deployed Endpoint, not the bare Model resource
   (`.model` 404s; `.endpoint` is the one that actually generates content).

**Step 3 — put the tuned model into production.**

The app already has a slot for this: `AIProviderConfig.model_override`
(read by `ai_gateway.py:_build_model`, `backend/ai_gateway.py:233`). The
"Use as model override" button (Settings → AI Gateway) sets this
automatically from the job's endpoint — no manual copy-pasting, and as of
this write-up it's the *only* way to set it (the free-text override field
was removed once a tuned model became the standing model). No code change,
no redeploy — the next Brain query routes to the tuned model.

## Why this satisfies the same thesis requirement as the GPU path

The original QLoRA plan existed to let the model learn the CBEST
attacker/user perspective distinction and Basel/GDPR/SOC 2 decision format
directly, rather than relying on prompting alone (`train_lora.py` docstring).
Vertex SFT on the same labeled corpus achieves the identical objective — the
model's weights are updated on the same perspective-labeled examples — it
just changes *where* the training compute runs (Google's managed fleet
instead of a self-provisioned GPU) and *which* base model is tuned (the
hosted `gemini-2.5-flash` already in production, instead of an open-weight
model requiring a separate serving stack). The trade-off, honestly stated:
the resulting adapter/weights are **not** exportable — this path only works
because the base model is already the one serving the app. It would not be
usable if Phase 2 (SHAP/attention-based XAI requiring internals access to
open weights) still needs an open-weight model; that phase remains genuinely
GPU-dependent and stays blocked until quota is granted.

## Evaluation

Use the same before/after comparison `train_lora.py --eval-only` implements
against `benchmark_cases.BASEL_BENCHMARK` and `ADVERSARIAL_CASES` — run it
against the base `gemini-2.5-flash` (no override set) to get the "before"
number, then again with the Model override pointed at the tuned model for
"after". The app's own `/api/evaluation/llm-benchmark` and
`/api/evaluation/adversarial` endpoints score identically, so the same numbers
reported in Chapter 4 are directly comparable pre/post-tuning.
