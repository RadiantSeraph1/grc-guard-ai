"""Phase 1 (GPU-free) — Vertex AI supervised fine-tuning of Gemini.

Replaces train_lora.py for this project: the GCP project's GPU quota
(GPUS_ALL_REGIONS) was denied, so local/Colab QLoRA is off the table. Vertex AI's
managed Supervised Fine-Tuning (SFT) service tunes Gemini on Google's own TPU/GPU
fleet - the caller never provisions an accelerator, so it is unaffected by the
GPU quota and needs nothing beyond the existing Vertex AI API access already used
by ai_gateway.py.

Pipeline:
  1. Read the Alpaca-style JSONL from prepare_finetune_dataset.py
     (instruction/input/output rows).
  2. Convert each row to Gemini's tuning format: a `contents` list of one user
     turn + one model turn.
  3. Upload the converted JSONL to GCS (tuning requires a gs:// URI).
  4. Submit a supervised tuning job via the google-genai SDK against Vertex AI.
  5. Poll until the job finishes and print the tuned model's resource name.

Run:
  python backend/scripts/prepare_finetune_dataset.py --output grc_finetune.jsonl
  python backend/training/scripts/vertex_finetune.py --dataset grc_finetune.jsonl

Then point the app at the result: Settings -> AI Gateway -> set "Model override"
to the printed tuned model resource name. No app code changes needed
(ai_gateway.py:_build_model already reads AIProviderConfig.model_override).
"""
import argparse
import json
import sys
import time
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[2]  # backend/
sys.path.insert(0, str(BACKEND_DIR))

import vertex_tune_lib as lib  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", default="grc_finetune.jsonl",
                     help="Alpaca-style JSONL from prepare_finetune_dataset.py")
    ap.add_argument("--base", default="gemini-2.5-flash",
                     help="Base Gemini model id to tune (must support Vertex SFT).")
    ap.add_argument("--display-name", default="grc-auditor-banking-sft")
    ap.add_argument("--poll-interval", type=int, default=30)
    args = ap.parse_args()

    src = Path(args.dataset)
    rows = [json.loads(line) for line in src.read_text(encoding="utf-8").splitlines() if line.strip()]
    print(f"Loaded {len(rows)} instruction rows from {src}")

    converted = lib.to_gemini_format(rows)
    filename = src.stem + "_gemini_sft.jsonl"
    gcs_uri = lib.upload_jsonl_to_gcs(converted, filename)
    print(f"Uploaded -> {gcs_uri}")

    job = lib.submit_tuning_job(gcs_uri, base_model=args.base, display_name=args.display_name)
    print(f"Submitted tuning job: {job.name} (state={job.state})")

    while job.state not in (
        "JOB_STATE_SUCCEEDED", "JOB_STATE_FAILED", "JOB_STATE_CANCELLED",
    ):
        time.sleep(args.poll_interval)
        job = lib.get_tuning_job(job.name)
        print(f"  ... state={job.state}")

    if job.state != "JOB_STATE_SUCCEEDED":
        raise SystemExit(f"Tuning job did not succeed: {job.state} ({getattr(job, 'error', '')})")

    tuned_endpoint = job.tuned_model.endpoint
    print(f"\nTuning finished. Tuned model endpoint (use this, not .model — Vertex "
          f"serves tuned Gemini models via their Endpoint):\n  {tuned_endpoint}")
    print("\nNext step: Settings -> AI Gateway -> Model override -> paste the name above.")


if __name__ == "__main__":
    main()
