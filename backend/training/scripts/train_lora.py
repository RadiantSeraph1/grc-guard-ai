"""Phase 1 — QLoRA domain fine-tune on the banking corpus (MODEL_TRAINING_PLAN Task 3).

Fine-tunes a small open-weight instruct model on
`data/processed/banking_corpus.jsonl` (build with build_banking_corpus.py
first) so the model learns the CBEST attacker/user perspective distinction and
Basel III/GDPR/SOC 2 compliance decisions directly, instead of relying on
prompting alone. Open weights are required (not a hosted/closed API) so Phase
2's attention-extraction and SHAP-on-internals XAI can run against this model.

Base model defaults to `microsoft/Phi-3-mini-4k-instruct` (3.8B, MIT license,
no gated HF access needed, fits 4-bit QLoRA on a 16GB T4/V100). Pass --base to
use a bigger model (e.g. meta-llama/Llama-3.1-8B-Instruct) on a larger GPU.

Requires a CUDA GPU with bitsandbytes support (Colab T4/A100, or the GCP V100
once GPUS_ALL_REGIONS quota is granted) — will NOT run on CPU or on a local
Windows dev machine without CUDA. Install deps first:

  pip install -r backend/training/requirements-train.txt

Run (train):
  python backend/training/scripts/build_banking_corpus.py   # if not already built
  python backend/training/scripts/train_lora.py --epochs 3

Run (evaluate only — before/after comparison against the Basel/CBEST benchmark
and the adversarial cases, same scoring the API's /api/evaluation/llm-benchmark
and /api/evaluation/adversarial use):
  python backend/training/scripts/train_lora.py --eval-only                     # base model
  python backend/training/scripts/train_lora.py --eval-only --adapter artifacts/banking-lora  # tuned

Artifact -> backend/training/artifacts/banking-lora/ — serve it to the app by
running it behind an OpenAI-compatible endpoint (e.g. vLLM) and pointing the
`inhouse` provider's base_url at it in Settings -> AI Gateway (ai_gateway.py
already has a live `inhouse` provider slot; no app code changes needed).
"""
import argparse
import json
import random
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[1]          # backend/training
BACKEND_DIR = BASE_DIR.parent                             # backend
PROCESSED = BASE_DIR / "data" / "processed"
ARTIFACT_DIR = BASE_DIR / "artifacts" / "banking-lora"

sys.path.insert(0, str(BACKEND_DIR))  # so we can import benchmark_cases.py


# ---------------------------------------------------------------------------
# Corpus -> instruction-tuning example formatting
# ---------------------------------------------------------------------------
PROMPT_TEMPLATE = """### Instruction:
{instruction}

### Input:
{input}

### Response:
{output}"""

INSTRUCTIONS = {
    "perspective_cbest": (
        "You are a banking CBEST threat-modeling analyst. Classify the following "
        "security scenario into the correct CBEST threat category FROM THE STATED "
        "PERSPECTIVE. Explicitly distinguish the attacker's action from the "
        "victim/user's experience — the same scenario can be a different category "
        "depending on perspective."
    ),
    "regulatory_paraphrase": (
        "You are a senior banking GRC compliance auditor. Determine whether the "
        "following scenario is COMPLIANT or a VIOLATION under the relevant Basel "
        "III / GDPR / SOC 2 requirement, and explain why with the specific "
        "threshold or rule."
    ),
    "oscal": (
        "You are a compliance control-mapping assistant. Given the following NIST "
        "800-53 control identifier and statement, explain what it requires."
    ),
    "asokore_vuln": (
        "You are a security remediation assistant. Given the following vulnerability "
        "finding, state the recommended remediation."
    ),
    "asokore_asset_weak": (
        "You are a security posture auditor. Identify the compliance issue "
        "evidenced by the following asset finding."
    ),
}


def format_example(row: dict) -> dict:
    source = row.get("source", "")
    instruction = INSTRUCTIONS.get(source, "Analyze the following banking compliance scenario.")
    text = row.get("text", "")

    if source == "perspective_cbest":
        output = f"Category: {row.get('control_id', '')}\nRationale: {row.get('rationale', '')}"
    elif source == "regulatory_paraphrase":
        output = f"Decision: {row.get('label', '')}\nRationale: {row.get('rationale', '')}"
    elif source == "oscal":
        rationale = (row.get("rationale") or "")[:600]
        output = f"Control: {row.get('control_id', '')}\nRequirement: {rationale}"
    else:  # asokore_vuln, asokore_asset_weak
        output = f"Finding: {row.get('label', 'FAIL')}\nRemediation/Rationale: {row.get('rationale', '')}"

    prompt = PROMPT_TEMPLATE.format(instruction=instruction, input=text, output=output)
    return {"text": prompt}


def load_corpus(path: Path) -> list:
    if not path.exists():
        raise FileNotFoundError(
            f"{path} not found. Run build_banking_corpus.py first to generate the corpus."
        )
    rows = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def split(rows: list, val_frac: float = 0.1, seed: int = 13):
    rows = list(rows)
    random.Random(seed).shuffle(rows)
    n = max(1, int(len(rows) * val_frac))
    return rows[n:], rows[:n]


# ---------------------------------------------------------------------------
# Evaluation against the app's own Basel III / CBEST benchmark + adversarial
# cases — the same ground truth /api/evaluation/llm-benchmark and
# /api/evaluation/adversarial score against, so results are directly comparable
# to what the live app reports for the hosted-provider baseline.
# ---------------------------------------------------------------------------
def evaluate_model(generate_fn) -> dict:
    from benchmark_cases import BASEL_BENCHMARK, ADVERSARIAL_CASES

    correct = 0
    taxonomy: dict = {}
    for case in BASEL_BENCHMARK:
        prompt = PROMPT_TEMPLATE.format(
            instruction="You are a senior banking GRC compliance expert. Answer precisely and concisely.",
            input=case["question"],
            output="",
        )
        response = generate_fn(prompt).lower()
        hit = any(kw.lower() in response for kw in case["ground_truth_keywords"])
        correct += 1 if hit else 0
        bucket = taxonomy.setdefault(case.get("error_category", "Standard Factual"), {"total": 0, "correct": 0})
        bucket["total"] += 1
        bucket["correct"] += 1 if hit else 0

    detected = 0
    for case in ADVERSARIAL_CASES:
        prompt = PROMPT_TEMPLATE.format(
            instruction=(
                "You are a senior banking GRC compliance auditor. Decide if the following "
                "scenario is COMPLIANT or a VIOLATION, watching for disguised/euphemistic "
                "language that masks a real compliance issue."
            ),
            input=case["input"],
            output="",
        )
        response = generate_fn(prompt).upper()
        detected += 1 if "VIOLATION" in response else 0

    basel_total = len(BASEL_BENCHMARK)
    adv_total = len(ADVERSARIAL_CASES)
    return {
        "basel_accuracy": round(correct / basel_total * 100, 1) if basel_total else 0,
        "basel_total": basel_total,
        "error_taxonomy": {
            cat: {**s, "accuracy": round(s["correct"] / s["total"] * 100, 1) if s["total"] else 0}
            for cat, s in taxonomy.items()
        },
        "adversarial_detection_rate": round(detected / adv_total * 100, 1) if adv_total else 0,
        "adversarial_total": adv_total,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="microsoft/Phi-3-mini-4k-instruct",
                     help="HF base model id. Default fits 4-bit QLoRA on a 16GB T4/V100.")
    ap.add_argument("--corpus", default=str(PROCESSED / "banking_corpus.jsonl"))
    ap.add_argument("--out", default=str(ARTIFACT_DIR))
    ap.add_argument("--epochs", type=int, default=3)
    ap.add_argument("--batch", type=int, default=2)
    ap.add_argument("--grad-accum", type=int, default=8)
    ap.add_argument("--lr", type=float, default=2e-4)
    ap.add_argument("--lora-r", type=int, default=16)
    ap.add_argument("--lora-alpha", type=int, default=32)
    ap.add_argument("--lora-dropout", type=float, default=0.05)
    ap.add_argument("--max-seq-length", type=int, default=1024)
    ap.add_argument("--eval-only", action="store_true", help="Skip training; only run the benchmark eval.")
    ap.add_argument("--adapter", default=None, help="Path to a trained LoRA adapter (for --eval-only).")
    args = ap.parse_args()

    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig

    bnb_config = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.bfloat16,
        bnb_4bit_use_double_quant=True,
    )

    tokenizer = AutoTokenizer.from_pretrained(args.base)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    print(f"Loading base model {args.base} in 4-bit (QLoRA)...")
    model = AutoModelForCausalLM.from_pretrained(
        args.base, quantization_config=bnb_config, device_map="auto",
        trust_remote_code=True,
    )

    if args.adapter:
        from peft import PeftModel
        print(f"Loading LoRA adapter from {args.adapter}...")
        model = PeftModel.from_pretrained(model, args.adapter)

    def generate_fn(prompt: str) -> str:
        inputs = tokenizer(prompt, return_tensors="pt", truncation=True,
                            max_length=args.max_seq_length).to(model.device)
        with torch.no_grad():
            out = model.generate(**inputs, max_new_tokens=200, do_sample=False,
                                  pad_token_id=tokenizer.pad_token_id)
        full = tokenizer.decode(out[0], skip_special_tokens=True)
        return full[len(tokenizer.decode(inputs["input_ids"][0], skip_special_tokens=True)):]

    if args.eval_only:
        print("Running benchmark evaluation only (no training)...")
        results = evaluate_model(generate_fn)
        print(json.dumps(results, indent=2))
        return

    from datasets import Dataset
    from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
    from trl import SFTTrainer, SFTConfig

    print(f"Loading corpus from {args.corpus}...")
    rows = load_corpus(Path(args.corpus))
    print(f"  {len(rows)} rows")
    train_rows, val_rows = split(rows)
    train_ds = Dataset.from_list([format_example(r) for r in train_rows])
    val_ds = Dataset.from_list([format_example(r) for r in val_rows])
    print(f"  {len(train_ds)} train / {len(val_ds)} val examples")

    print("Before fine-tuning, baseline benchmark:")
    before = evaluate_model(generate_fn)
    print(json.dumps(before, indent=2))

    model = prepare_model_for_kbit_training(model)
    lora_config = LoraConfig(
        r=args.lora_r, lora_alpha=args.lora_alpha, lora_dropout=args.lora_dropout,
        bias="none", task_type="CAUSAL_LM",
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
    )
    model = get_peft_model(model, lora_config)
    model.print_trainable_parameters()

    sft_config = SFTConfig(
        output_dir=args.out,
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch,
        gradient_accumulation_steps=args.grad_accum,
        learning_rate=args.lr,
        max_seq_length=args.max_seq_length,
        logging_steps=10,
        save_strategy="epoch",
        eval_strategy="epoch",
        bf16=True,
        report_to=[],
    )
    trainer = SFTTrainer(
        model=model, args=sft_config,
        train_dataset=train_ds, eval_dataset=val_ds,
    )
    trainer.train()

    Path(args.out).mkdir(parents=True, exist_ok=True)
    trainer.save_model(args.out)
    tokenizer.save_pretrained(args.out)

    print("After fine-tuning, benchmark:")
    after = evaluate_model(generate_fn)
    print(json.dumps(after, indent=2))

    comparison_path = Path(args.out) / "eval_before_after.json"
    comparison_path.write_text(json.dumps({"before": before, "after": after}, indent=2))
    print(f"\nSaved adapter -> {args.out}")
    print(f"Before/after comparison -> {comparison_path}")
    print(
        "\nServe with vLLM (or similar OpenAI-compatible server), then set the "
        "`inhouse` provider's base_url in Settings -> AI Gateway to point at it. "
        "No app code changes needed."
    )


if __name__ == "__main__":
    main()
