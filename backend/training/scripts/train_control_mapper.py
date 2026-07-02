"""Phase 1 — fine-tune the control-mapping bi-encoder (MODEL_TRAINING_PLAN task 1).

Trains a sentence-transformers encoder so that compliance text embeds close to
the control it evidences. Pairs come from the processed JSONL this module
already builds:

  data/processed/nist_800_53_controls.jsonl   (build_oscal_controls.py)
  data/processed/ledgar.jsonl [optional]      (build_hf_clause_datasets.py)

Positive pair = (control/clause text, its control-family anchor text).
Hard negatives come free from in-batch MultipleNegativesRankingLoss.

Run (free Colab/Kaggle T4, or CPU slowly):
  pip install -r backend/training/requirements-train.txt
  python backend/training/scripts/train_control_mapper.py --epochs 2
  python backend/training/scripts/train_control_mapper.py --eval-only  # baseline numbers

Artifact -> training/artifacts/control-mapper/  — serve it to the app with
  EMBEDDING_MODEL_PATH=backend/training/artifacts/control-mapper
(ai_gateway.embed_texts loads it; RAG search becomes semantic immediately).
"""
import argparse
import json
import random
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]          # backend/training
PROCESSED = BASE / "data" / "processed"
ARTIFACT = BASE / "artifacts" / "control-mapper"


def load_pairs():
    """Yield (text, anchor) positives from every processed dataset present."""
    pairs = []
    nist = PROCESSED / "nist_800_53_controls.jsonl"
    if nist.exists():
        rows = [json.loads(l) for l in nist.open(encoding="utf-8") if l.strip()]
        # Anchor = family head text (e.g. AC-2 base control); member = enhancement text.
        by_family = {}
        for r in rows:
            fam = (r.get("control_id") or "").split(".")[0]
            by_family.setdefault(fam, []).append(r)
        for fam, members in by_family.items():
            anchor = f"{fam}: {members[0].get('rationale') or members[0]['text'][:300]}"
            for m in members:
                pairs.append((m["text"][:512], anchor[:512]))
    ledgar = PROCESSED / "ledgar.jsonl"
    if ledgar.exists():
        for l in ledgar.open(encoding="utf-8"):
            r = json.loads(l)
            if r.get("text") and r.get("control_id"):
                pairs.append((r["text"][:512], f"Provision category: {r['control_id']}"))
    return pairs


def split(pairs, val_frac=0.1, seed=13):
    random.Random(seed).shuffle(pairs)
    n = max(1, int(len(pairs) * val_frac))
    return pairs[n:], pairs[:n]


def evaluate(model, val):
    """Recall@1/@5 and MRR: does each text rank its own anchor first among all anchors?"""
    import numpy as np
    texts = [t for t, _ in val]
    anchors = sorted({a for _, a in val})
    a_idx = {a: i for i, a in enumerate(anchors)}
    gold = np.array([a_idx[a] for _, a in val])
    T = model.encode(texts, normalize_embeddings=True, show_progress_bar=False)
    A = model.encode(anchors, normalize_embeddings=True, show_progress_bar=False)
    ranks = (-(T @ A.T)).argsort(axis=1)
    pos = (ranks == gold[:, None]).argmax(axis=1) + 1
    return {"n": len(val), "recall@1": float((pos == 1).mean()),
            "recall@5": float((pos <= 5).mean()), "mrr": float((1 / pos).mean())}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="sentence-transformers/all-MiniLM-L6-v2")
    ap.add_argument("--epochs", type=int, default=2)
    ap.add_argument("--batch", type=int, default=64)
    ap.add_argument("--eval-only", action="store_true", help="score the base (or trained) model, no training")
    args = ap.parse_args()

    from sentence_transformers import SentenceTransformer, InputExample, losses
    from torch.utils.data import DataLoader

    pairs = load_pairs()
    assert pairs, f"No processed data in {PROCESSED}. Run build_oscal_controls.py first."
    train, val = split(pairs)
    print(f"pairs: {len(train)} train / {len(val)} val")

    model_path = str(ARTIFACT) if (args.eval_only and ARTIFACT.exists()) else args.base
    model = SentenceTransformer(model_path)
    print(f"model: {model_path}")
    print("before:", evaluate(model, val))

    if not args.eval_only:
        data = DataLoader([InputExample(texts=[t, a]) for t, a in train],
                          shuffle=True, batch_size=args.batch)
        model.fit(train_objectives=[(data, losses.MultipleNegativesRankingLoss(model))],
                  epochs=args.epochs, warmup_steps=100, show_progress_bar=True)
        after = evaluate(model, val)
        print("after:", after)
        ARTIFACT.mkdir(parents=True, exist_ok=True)
        model.save(str(ARTIFACT))
        (ARTIFACT / "eval.json").write_text(json.dumps(after, indent=2))
        print(f"saved -> {ARTIFACT}\nServe with: EMBEDDING_MODEL_PATH={ARTIFACT}")


if __name__ == "__main__":
    main()
