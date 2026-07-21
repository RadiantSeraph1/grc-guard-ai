"""Shared helpers for Vertex AI managed fine-tuning (GPU-free).

Used by both the CLI (backend/training/scripts/vertex_finetune.py) and the
in-app "Fine-tune on Vertex AI" button (backend/main.py, Settings -> AI
Gateway) so the two entry points never drift out of sync. See
docs/VERTEX_FINETUNING.md for the full write-up of why this path exists.

Lives at backend/ top level (not backend/training/) because backend/training/
is .dockerignore'd out of the production image — it holds the heavy,
GPU-only QLoRA pipeline. This module only needs the app's own already-shipped
deps (google-genai, google-cloud-storage), so it ships with the API image.
"""
import json
import os
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent  # backend/
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from ai_gateway import VERTEX_AI_PROJECT, VERTEX_AI_LOCATION  # noqa: E402

GCS_BUCKET = os.environ.get("GCS_BUCKET", "grc-guard-uploads-claude-code-501412")
GCS_PREFIX = "training/vertex-finetune"
DEFAULT_BASE_MODEL = "gemini-2.5-flash"


def to_gemini_format(rows: list) -> list:
    """Alpaca {instruction,input,output} -> Gemini tuning {contents:[user,model]}."""
    converted = []
    for row in rows:
        user_text = row["instruction"]
        if row.get("input"):
            user_text += f"\n\n{row['input']}"
        converted.append({
            "contents": [
                {"role": "user", "parts": [{"text": user_text}]},
                {"role": "model", "parts": [{"text": row["output"]}]},
            ]
        })
    return converted


def build_seed_dataset() -> list:
    """The perspective-labeled Basel III/CBEST/GDPR/AML/SOC 2 seed set."""
    from scripts.prepare_finetune_dataset import SEED_EXAMPLES, generate_augmented_examples
    return SEED_EXAMPLES + generate_augmented_examples(SEED_EXAMPLES)


def upload_jsonl_to_gcs(rows: list, filename: str) -> str:
    """Write `rows` as JSONL to a temp file and upload it; returns the gs:// URI."""
    import tempfile
    from google.cloud import storage

    with tempfile.TemporaryDirectory() as tmp:
        local_path = Path(tmp) / filename
        local_path.write_text("\n".join(json.dumps(r) for r in rows) + "\n", encoding="utf-8")

        client = storage.Client(project=VERTEX_AI_PROJECT or None)
        bucket = client.bucket(GCS_BUCKET)
        blob = bucket.blob(f"{GCS_PREFIX}/{filename}")
        blob.upload_from_filename(str(local_path))

    return f"gs://{GCS_BUCKET}/{GCS_PREFIX}/{filename}"


def submit_tuning_job(gcs_uri: str, base_model: str = DEFAULT_BASE_MODEL,
                       display_name: str = "grc-auditor-banking-sft"):
    """Submit a Vertex AI supervised fine-tuning job; returns the TuningJob (async, not polled)."""
    if not VERTEX_AI_PROJECT:
        raise RuntimeError("VERTEX_AI_PROJECT (or GOOGLE_CLOUD_PROJECT) is not set.")

    from google import genai
    from google.genai import types

    client = genai.Client(vertexai=True, project=VERTEX_AI_PROJECT, location=VERTEX_AI_LOCATION)
    return client.tunings.tune(
        base_model=base_model,
        training_dataset={"gcs_uri": gcs_uri},
        config=types.CreateTuningJobConfig(tuned_model_display_name=display_name),
    )


def get_tuning_job(job_name: str):
    """Fetch current state of a previously submitted TuningJob by resource name."""
    from google import genai
    client = genai.Client(vertexai=True, project=VERTEX_AI_PROJECT, location=VERTEX_AI_LOCATION)
    return client.tunings.get(name=job_name)
