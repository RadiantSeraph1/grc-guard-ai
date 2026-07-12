"""AI gateway built on the agno framework.

Every LLM call in the platform routes through here. The active provider is read
from the per-organization AIProviderConfig table (configured in Settings or via
environment variables). Supported providers:

  - **Vertex AI / Gemini** (primary) — Google's Gemini models via Vertex AI.
  - **In-house** — custom trained GRC model via OpenAI-compatible endpoint.
  - **Groq** (interim) — fast inference for testing until in-house is ready.

When no provider is usable the gateway returns an explicit "no model available"
notice instead of fabricated output.

Providers are constructed as agno model objects and executed with an agno Agent,
giving the whole platform a single, consistent agent runtime.
"""

import json
import logging
import os
from typing import Optional
from sqlalchemy.orm import Session
from database import SessionLocal
from models import AIProviderConfig
import security

logger = logging.getLogger(__name__)

# All provider configs are org-scoped. Background callers (agents, schedulers)
# sometimes pass org_id=None; coercing to the default company here prevents
# creating ownerless (org_id=NULL) rows that double-activate alongside the real
# per-org row (bug C1).
DEFAULT_COMPANY_ID = os.environ.get("DEFAULT_COMPANY_ID", "bank_enterprise")

# Active AI providers. The platform supports Vertex AI (Gemini), the in-house
# trained GRC model, and Groq as an interim provider.
PROVIDER_DEFAULT_MODEL = {
    "gemini":  "gemini-2.0-flash",           # Google Vertex AI
    "groq":    "llama-3.3-70b-versatile",    # interim, remove once "inhouse" is trained
    "inhouse": "grc-auditor-v1",             # our own trained GRC model
    "claude":  "claude-3-5-sonnet-20241022", # Anthropic Claude
}

# Base URLs for the OpenAI-compatible providers (routed through agno's OpenAILike).
# "inhouse" is configured per deployment via the provider's base_url (e.g. a
# vLLM / TGI endpoint serving the trained model).
OPENAI_COMPATIBLE_BASE_URL = {
    "groq": "https://api.groq.com/openai/v1",
    "inhouse": "",
}

OPENAI_COMPATIBLE = set(OPENAI_COMPATIBLE_BASE_URL.keys())

# Vertex AI / Gemini uses its own SDK, not OpenAI-compatible.
VERTEX_AI_PROVIDERS = {"gemini"}
ANTHROPIC_PROVIDERS = {"claude"}

PROVIDER_ENV_KEYS = {
    "gemini":  "GEMINI_API_KEY",
    "groq":    "GROQ_API_KEY",
    "inhouse": "INHOUSE_API_KEY",   # optional: self-hosted endpoints may need no key
    "claude":  "ANTHROPIC_API_KEY",
}

# Vertex AI configuration
VERTEX_AI_PROJECT  = os.environ.get("VERTEX_AI_PROJECT", os.environ.get("GOOGLE_CLOUD_PROJECT", ""))
VERTEX_AI_LOCATION = os.environ.get("VERTEX_AI_LOCATION", "us-central1")


# ---------------------------------------------------------------------------
# Key / config helpers
# ---------------------------------------------------------------------------

def get_vault_key() -> Optional[str]:
    """Return the configured key used for API-key envelope encryption."""
    return os.environ.get("BYOK_SECRET_KEY")


def get_env_provider_key(provider_id: str) -> Optional[str]:
    env_name = PROVIDER_ENV_KEYS.get(provider_id)
    if not env_name:
        return None
    value = os.environ.get(env_name, "").strip()
    return value or None


def get_decrypted_key(config: AIProviderConfig) -> Optional[str]:
    """Decrypt the stored API key, falling back to an environment key."""
    if not config or not config.api_key:
        return get_env_provider_key(config.id) if config else None
    key = get_vault_key()
    if not key:
        return get_env_provider_key(config.id)
    decrypted = security.decrypt_log(config.api_key, key)
    if decrypted.startswith("[Error:"):
        return get_env_provider_key(config.id)
    return decrypted


def get_active_provider_config(db: Session, org_id: str = None) -> AIProviderConfig:
    """Resolve the active AI provider configuration, scoped to org.

    If the explicitly-active provider is the local engine (or unset) but an API
    key is available in the environment, transparently promote the preferred
    real provider (gemini first, then in-house, then Groq) so configured keys
    are used automatically.
    """
    # Never operate on ownerless rows: coerce a missing org to the default company
    # so we read and write a single, consistent per-org provider set (bug C1).
    org_id = org_id or DEFAULT_COMPANY_ID
    config = db.query(AIProviderConfig).filter_by(is_active=True, org_id=org_id).first()
    if config:
        return config

    # No active provider for this org: auto-activate one that has an environment
    # key. Priority: gemini > inhouse > groq.
    env_provider = None
    for pid in ("gemini", "claude", "inhouse", "groq"):
        if get_env_provider_key(pid):
            env_provider = pid
            break
    # Also check for Vertex AI Application Default Credentials (no key needed)
    if not env_provider and VERTEX_AI_PROJECT:
        env_provider = "gemini"

    if not env_provider:
        return None
    prov_config = db.query(AIProviderConfig).filter_by(id=env_provider, org_id=org_id).first()
    if not prov_config:
        prov_config = AIProviderConfig(id=env_provider, org_id=org_id, is_active=True)
        db.add(prov_config)
    else:
        prov_config.is_active = True
    db.query(AIProviderConfig).filter(
        AIProviderConfig.id != env_provider, AIProviderConfig.org_id == org_id
    ).update({"is_active": False})
    db.commit()
    db.refresh(prov_config)
    return prov_config


# ---------------------------------------------------------------------------
# Embeddings (for vector RAG)
# ---------------------------------------------------------------------------
# Embeddings are resolved independently of the chat provider. Preferred backend:
# the local fine-tuned control-mapping encoder (EMBEDDING_MODEL_PATH, Phase-1
# artifact); hosted Vertex AI, OpenAI, or Gemini keys are a vectors-only
# fallback. None configured -> the RAG layer transparently falls back to
# lexical search.

EMBEDDING_PROVIDERS = [
    ("vertex_ai", "VERTEX_AI_PROJECT", "text-embedding-005", 768),
    ("openai",    "OPENAI_API_KEY",    "text-embedding-3-small", 1536),
    ("gemini",    "GEMINI_API_KEY",    "text-embedding-004", 768),
]

# Cached local sentence-transformers model (loaded once per process).
_local_embedder = None


def get_embedding_config() -> Optional[dict]:
    """Resolve the active embedding backend.

    Preference: a local fine-tuned sentence-transformers model (the Phase-1
    control-mapping encoder, via EMBEDDING_MODEL_PATH) > Vertex AI > hosted
    keys > None.
    """
    local_path = os.environ.get("EMBEDDING_MODEL_PATH", "").strip()
    if local_path:
        return {"provider": "local", "model": local_path, "api_key": None, "dim": None}
    for provider, env_name, model, dim in EMBEDDING_PROVIDERS:
        if provider == "vertex_ai":
            # Vertex AI uses ADC (Application Default Credentials), not API key
            project = os.environ.get(env_name, "").strip()
            if project:
                override = os.environ.get("EMBEDDING_MODEL", "").strip()
                return {"provider": "vertex_ai", "api_key": None,
                        "model": override or model, "dim": dim,
                        "project": project, "location": VERTEX_AI_LOCATION}
        else:
            key = os.environ.get(env_name, "").strip()
            if key:
                override = os.environ.get("EMBEDDING_MODEL", "").strip()
                return {"provider": provider, "api_key": key,
                        "model": override or model, "dim": dim}
    return None


def embeddings_available() -> bool:
    return get_embedding_config() is not None


def embed_texts(texts: list, config: Optional[dict] = None) -> Optional[list]:
    """Return a list of embedding vectors (list[float]) for the given texts.

    Returns None if no embedding provider is configured or the call fails, so
    callers can degrade to lexical search without raising.
    """
    if not texts:
        return []
    config = config or get_embedding_config()
    if not config:
        return None
    provider = config["provider"]
    try:
        if provider == "local":
            # Fine-tuned sentence-transformers encoder (Phase-1 artifact).
            global _local_embedder
            if _local_embedder is None:
                from sentence_transformers import SentenceTransformer
                _local_embedder = SentenceTransformer(config["model"])
            return [list(map(float, v)) for v in _local_embedder.encode(texts, normalize_embeddings=True)]
        if provider == "vertex_ai":
            from vertexai.language_models import TextEmbeddingModel
            import vertexai
            vertexai.init(project=config.get("project", VERTEX_AI_PROJECT),
                         location=config.get("location", VERTEX_AI_LOCATION))
            model = TextEmbeddingModel.from_pretrained(config["model"])
            # Vertex AI batch limit is 250 texts
            all_embeddings = []
            for i in range(0, len(texts), 250):
                batch = texts[i:i + 250]
                embeddings = model.get_embeddings(batch)
                all_embeddings.extend([list(e.values) for e in embeddings])
            return all_embeddings
        if provider == "openai":
            from openai import OpenAI
            client = OpenAI(api_key=config["api_key"])
            resp = client.embeddings.create(model=config["model"], input=texts)
            # Preserve input order.
            ordered = sorted(resp.data, key=lambda d: d.index)
            return [list(d.embedding) for d in ordered]
        if provider == "gemini":
            from google import genai
            client = genai.Client(api_key=config["api_key"])
            model_id = config["model"]
            if not model_id.startswith("models/"):
                model_id = f"models/{model_id}"
            resp = client.models.embed_content(model=model_id, contents=texts)
            return [list(e.values) for e in resp.embeddings]
    except Exception as e:
        logger.warning("Embedding generation failed (%s): %s. Falling back to lexical.", provider, e)
        return None
    return None


def embed_query(text: str) -> Optional[list]:
    """Embed a single query string; returns the vector or None."""
    vectors = embed_texts([text])
    if vectors:
        return vectors[0]
    return None


# ---------------------------------------------------------------------------
# agno model construction + execution
# ---------------------------------------------------------------------------

def _build_model(provider: str, api_key: Optional[str], config: AIProviderConfig):
    """Construct an agno model object for the provider, or None.

    Supports three provider families:
    - Vertex AI / Gemini — uses agno's Gemini adapter
    - OpenAI-compatible (Groq, inhouse) — uses agno's OpenAILike adapter
    """
    model_id = (config.model_override if config and config.model_override
                else PROVIDER_DEFAULT_MODEL.get(provider, "grc-auditor-v1"))

    if provider in VERTEX_AI_PROVIDERS:
        try:
            from agno.models.google import Gemini
            return Gemini(
                id=model_id,
                api_key=api_key or None,
                vertexai=True,
                project_id=VERTEX_AI_PROJECT or None,
                location=VERTEX_AI_LOCATION or None,
            )
        except ImportError:
            # Fallback: try google-genai direct
            logger.warning("agno.models.google.Gemini not available, trying OpenAI-compatible fallback")
            return None

    if provider in OPENAI_COMPATIBLE:
        from agno.models.openai.like import OpenAILike
        base_url = (config.base_url if config and config.base_url else None) or OPENAI_COMPATIBLE_BASE_URL.get(provider)
        if not base_url:
            return None
        return OpenAILike(id=model_id, api_key=api_key or "not-needed", base_url=base_url)

    if provider in ANTHROPIC_PROVIDERS:
        try:
            from agno.models.anthropic import Claude
            return Claude(id=model_id, api_key=api_key)
        except ImportError:
            logger.warning("agno.models.anthropic.Claude not available")
            return None

    return None


def _run_agent(prompt: str, system_instruction: Optional[str], provider: str,
               api_key: Optional[str], config: AIProviderConfig) -> str:
    """Run a one-shot agno agent and return its text content."""
    from agno.agent import Agent
    model = _build_model(provider, api_key, config)
    if model is None:
        raise ValueError(f"No agno model could be built for provider '{provider}'.")
    agent = Agent(
        model=model,
        instructions=system_instruction or "You are a senior banking GRC analysis agent.",
        markdown=False,
        telemetry=False,
    )
    result = agent.run(prompt)
    return (result.content or "").strip()


def _provider_usable(provider: str, api_key: Optional[str]) -> bool:
    # Vertex AI can use Application Default Credentials (ADC) — no key needed.
    if provider in VERTEX_AI_PROVIDERS:
        return bool(api_key or VERTEX_AI_PROJECT)
    # The in-house self-hosted endpoint may require no API key.
    if provider == "inhouse":
        return True
    return bool(api_key)


# ---------------------------------------------------------------------------
# Public generation API (signatures preserved for the rest of the app)
# ---------------------------------------------------------------------------

# Honest message returned when no AI model is configured/usable. There is no
# deterministic "local evidence" engine that fabricates analysis — callers either
# get a real model response or this explicit notice.
MODEL_UNAVAILABLE_MESSAGE = (
    "No AI model is currently available. Configure Gemini (Vertex AI), "
    "the in-house model, or Groq in Settings → AI Gateway and try again."
)


def _usable_config(db, org_id):
    """Return (config, api_key) for a usable provider, or (None, None)."""
    config = get_active_provider_config(db, org_id=org_id)
    if not config:
        return None, None
    api_key = get_decrypted_key(config)
    if not _provider_usable(config.id, api_key):
        return None, None
    return config, api_key


def get_brain_model(org_id: str = None):
    """Return an instantiated agno model object based on the active provider."""
    db = SessionLocal()
    try:
        config, api_key = _usable_config(db, org_id)
        if not config:
            return None
        return _build_model(config.id, api_key, config)
    finally:
        db.close()


def generate_content_for_config(prompt: str, config: AIProviderConfig, system_instruction: Optional[str] = None) -> str:
    """Run a prompt against a SPECIFIC provider config, bypassing the org's
    "active" provider selection. Used for base-model-selection benchmarking
    (Ch.3 "base model selection via quantitative benchmarking"), which needs to
    compare every configured provider, not just whichever one is active."""
    api_key = get_decrypted_key(config)
    if not _provider_usable(config.id, api_key):
        raise ValueError(f"Provider '{config.id}' is not usable (no valid credentials).")
    return _run_agent(prompt, system_instruction, config.id, api_key, config)


def generate_content(prompt: str, system_instruction: Optional[str] = None, org_id: str = None) -> str:
    """Unified text generation routed through agno. Returns an explicit notice
    when no model is configured (never fabricated analysis)."""
    db = SessionLocal()
    try:
        config, api_key = _usable_config(db, org_id)
        if not config:
            return MODEL_UNAVAILABLE_MESSAGE
        return _run_agent(prompt, system_instruction, config.id, api_key, config)
    except Exception as e:
        logger.error("Error in AI Gateway: %s", e)
        return MODEL_UNAVAILABLE_MESSAGE
    finally:
        db.close()


def generate_structured_json(prompt: str, schema: dict, system_instruction: Optional[str] = None, org_id: str = None) -> dict:
    """Unified structured JSON generation routed through agno. Returns an empty
    dict when no model is usable so callers degrade gracefully (they read fields
    with .get())."""
    db = SessionLocal()
    try:
        config, api_key = _usable_config(db, org_id)
        if not config:
            return {}
        json_guideline = ("\n\nReturn your response STRICTLY as a single JSON object "
                          "matching this schema (no prose, no markdown fences):\n"
                          + json.dumps(schema, indent=2))
        raw_text = _run_agent(prompt + json_guideline, system_instruction, config.id, api_key, config)
        return parse_json_safely(raw_text)
    except Exception as e:
        logger.error("Error in AI Gateway JSON generation: %s", e)
        return {}
    finally:
        db.close()


def parse_json_safely(text: str) -> dict:
    """Extract and parse a JSON block from raw LLM output text."""
    try:
        return json.loads(text.strip())
    except Exception:
        try:
            start = text.find("{")
            end = text.rfind("}") + 1
            if start != -1 and end != -1:
                return json.loads(text[start:end])
        except Exception as e:
            logger.warning("Failed to parse JSON blocks: %s", e)
    raise ValueError(f"Model output could not be parsed as JSON: {text}")
