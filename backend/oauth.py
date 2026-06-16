"""OAuth 2.0 connect framework for data-source integrations.

Lets an operator connect GitHub / Google Workspace / Microsoft Entra by clicking
"Connect" and granting consent, instead of pasting API keys. Flow:

  start    -> build a provider authorize URL with a signed state (CSRF guard)
  callback -> verify state, exchange the code for tokens, persist (encrypted)
  sync     -> get_valid_access_token() returns a live token, refreshing if expired

Client IDs/secrets come from environment variables (per provider). Tokens are
stored in the integration's encrypted credentials blob as JSON.
"""

import os
import time
import json
import hmac
import base64
import hashlib
import secrets as _secrets
from urllib.parse import urlencode
from typing import Optional

import httpx


# Per-provider OAuth endpoints + scopes. client_env / secret_env name the
# environment variables that hold the registered app credentials.
OAUTH_PROVIDERS = {
    "github": {
        "authorize_url": "https://github.com/login/oauth/authorize",
        "token_url": "https://github.com/login/oauth/access_token",
        "scopes": "repo read:org",
        "client_env": "GITHUB_CLIENT_ID",
        "secret_env": "GITHUB_CLIENT_SECRET",
        "extra_auth": {},
    },
    "google_workspace": {
        "authorize_url": "https://accounts.google.com/o/oauth2/v2/auth",
        "token_url": "https://oauth2.googleapis.com/token",
        "scopes": "https://www.googleapis.com/auth/admin.directory.user.readonly",
        "client_env": "GOOGLE_OAUTH_CLIENT_ID",
        "secret_env": "GOOGLE_OAUTH_CLIENT_SECRET",
        # offline + consent are required to receive a refresh_token from Google.
        "extra_auth": {"access_type": "offline", "prompt": "consent"},
    },
    "entra": {
        "authorize_url": "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
        "token_url": "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        "scopes": "offline_access User.Read.All UserAuthenticationMethod.Read.All",
        "client_env": "ENTRA_CLIENT_ID",
        "secret_env": "ENTRA_CLIENT_SECRET",
        "extra_auth": {},
    },
}


def get_provider(provider_id: str) -> Optional[dict]:
    return OAUTH_PROVIDERS.get(provider_id)


def client_credentials(provider_id: str) -> tuple[Optional[str], Optional[str]]:
    p = OAUTH_PROVIDERS.get(provider_id)
    if not p:
        return None, None
    return os.environ.get(p["client_env"]), os.environ.get(p["secret_env"])


def is_configured(provider_id: str) -> bool:
    cid, secret = client_credentials(provider_id)
    return bool(cid and secret)


def supported_providers() -> list[str]:
    return list(OAUTH_PROVIDERS.keys())


# ---------------------------------------------------------------------------
# Redirect URIs
# ---------------------------------------------------------------------------

def _redirect_base() -> str:
    # Public URL that routes to THIS backend. Must match the registered callback.
    return os.environ.get("OAUTH_REDIRECT_BASE_URL", "http://localhost:8001").rstrip("/")


def redirect_uri(provider_id: str) -> str:
    return f"{_redirect_base()}/api/integrations/{provider_id}/oauth/callback"


def _frontend_return_url() -> str:
    base = os.environ.get("FRONTEND_BASE_URL", "http://localhost:3000").rstrip("/")
    return f"{base}/integrations"


# ---------------------------------------------------------------------------
# Signed state (CSRF) — carries provider + org, HMAC-signed, short-lived
# ---------------------------------------------------------------------------

def _state_secret() -> bytes:
    secret = (
        os.environ.get("OAUTH_STATE_SECRET")
        or os.environ.get("BYOK_SECRET_KEY")
        or "local-oauth-state-secret"
    )
    return secret.encode("utf-8")


def make_state(provider_id: str, org_id: str) -> str:
    payload = {
        "p": provider_id,
        "o": org_id,
        "n": _secrets.token_urlsafe(8),
        "t": int(time.time()),
    }
    raw = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode()
    sig = hmac.new(_state_secret(), raw.encode(), hashlib.sha256).hexdigest()[:32]
    return f"{raw}.{sig}"


def verify_state(state: str, provider_id: str, max_age: int = 600) -> Optional[dict]:
    try:
        raw, sig = state.rsplit(".", 1)
        expected = hmac.new(_state_secret(), raw.encode(), hashlib.sha256).hexdigest()[:32]
        if not hmac.compare_digest(sig, expected):
            return None
        payload = json.loads(base64.urlsafe_b64decode(raw.encode()).decode())
        if payload.get("p") != provider_id:
            return None
        if int(time.time()) - int(payload.get("t", 0)) > max_age:
            return None
        return payload
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Authorize URL + token exchange/refresh
# ---------------------------------------------------------------------------

def authorize_url(provider_id: str, state: str) -> Optional[str]:
    p = OAUTH_PROVIDERS.get(provider_id)
    cid, _ = client_credentials(provider_id)
    if not p or not cid:
        return None
    params = {
        "client_id": cid,
        "redirect_uri": redirect_uri(provider_id),
        "response_type": "code",
        "scope": p["scopes"],
        "state": state,
        **p.get("extra_auth", {}),
    }
    return f"{p['authorize_url']}?{urlencode(params)}"


def _normalize_token(raw: dict) -> dict:
    """Standardize a token response into our stored shape."""
    expires_in = raw.get("expires_in")
    expires_at = int(time.time()) + int(expires_in) - 60 if expires_in else None
    return {
        "oauth": True,
        "access_token": raw.get("access_token"),
        "refresh_token": raw.get("refresh_token"),
        "token_type": raw.get("token_type", "Bearer"),
        "scope": raw.get("scope"),
        "expires_at": expires_at,
    }


def exchange_code(provider_id: str, code: str) -> Optional[dict]:
    p = OAUTH_PROVIDERS.get(provider_id)
    cid, secret = client_credentials(provider_id)
    if not p or not cid or not secret:
        return None
    data = {
        "client_id": cid,
        "client_secret": secret,
        "code": code,
        "redirect_uri": redirect_uri(provider_id),
        "grant_type": "authorization_code",
    }
    try:
        with httpx.Client(timeout=20.0) as client:
            res = client.post(p["token_url"], data=data, headers={"Accept": "application/json"})
            res.raise_for_status()
            return _normalize_token(res.json())
    except Exception as e:
        print(f"OAuth code exchange failed for {provider_id}: {e}")
        return None


def refresh_token(provider_id: str, refresh: str) -> Optional[dict]:
    p = OAUTH_PROVIDERS.get(provider_id)
    cid, secret = client_credentials(provider_id)
    if not p or not cid or not secret or not refresh:
        return None
    data = {
        "client_id": cid,
        "client_secret": secret,
        "refresh_token": refresh,
        "grant_type": "refresh_token",
    }
    try:
        with httpx.Client(timeout=20.0) as client:
            res = client.post(p["token_url"], data=data, headers={"Accept": "application/json"})
            res.raise_for_status()
            tok = _normalize_token(res.json())
            # Providers may omit a new refresh token; keep the existing one.
            if not tok.get("refresh_token"):
                tok["refresh_token"] = refresh
            return tok
    except Exception as e:
        print(f"OAuth refresh failed for {provider_id}: {e}")
        return None


def get_valid_access_token(provider_id: str, creds: dict) -> tuple[Optional[str], Optional[dict]]:
    """Return a non-expired access token for stored OAuth creds.

    Returns (access_token, refreshed_creds_or_None). When refreshed_creds is not
    None, the caller should persist it.
    """
    if not creds or not creds.get("oauth"):
        return None, None
    expires_at = creds.get("expires_at")
    if expires_at and int(time.time()) >= int(expires_at) and creds.get("refresh_token"):
        new_tok = refresh_token(provider_id, creds["refresh_token"])
        if new_tok and new_tok.get("access_token"):
            return new_tok["access_token"], new_tok
    return creds.get("access_token"), None
