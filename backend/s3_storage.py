"""
GRC Guard AI — Unified cloud storage backend.

Supports three backends, selected by environment variables:
  1. GCS  — if GCS_BUCKET is set
  2. S3   — if S3_BUCKET_NAME is set (existing behaviour)
  3. Local — fallback for development (no bucket configured)

All public functions use the same signature so callers don't care which
backend is active.
"""

import os
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Environment config
# ---------------------------------------------------------------------------

# GCS
GCS_BUCKET = os.environ.get("GCS_BUCKET")

# S3
S3_BUCKET_NAME = os.environ.get("S3_BUCKET_NAME")
S3_ACCESS_KEY = os.environ.get("S3_ACCESS_KEY")
S3_SECRET_KEY = os.environ.get("S3_SECRET_KEY")
S3_REGION = os.environ.get("S3_REGION", "us-east-1")

# Local fallback base directory
LOCAL_STORAGE_DIR = os.environ.get("LOCAL_STORAGE_DIR", "temp_uploads")

# ---------------------------------------------------------------------------
# Backend detection (evaluated once at import time)
# ---------------------------------------------------------------------------

_BACKEND: str  # "gcs" | "s3" | "local"

if GCS_BUCKET:
    _BACKEND = "gcs"
elif S3_BUCKET_NAME and S3_ACCESS_KEY and S3_SECRET_KEY:
    _BACKEND = "s3"
else:
    _BACKEND = "local"

logger.info("Storage backend: %s", _BACKEND)


# ---------------------------------------------------------------------------
# GCS helpers
# ---------------------------------------------------------------------------

def _get_gcs_client():
    """Lazy-initialise a GCS client."""
    try:
        from google.cloud import storage
        return storage.Client()
    except Exception as e:
        logger.error("Failed to initialise GCS client: %s", e)
        return None


def _gcs_upload(file_content: bytes, remote_key: str) -> str:
    client = _get_gcs_client()
    if client is None:
        raise RuntimeError("GCS client unavailable")
    bucket = client.bucket(GCS_BUCKET)
    blob = bucket.blob(remote_key)
    blob.upload_from_string(file_content)
    uri = f"gs://{GCS_BUCKET}/{remote_key}"
    logger.info("Uploaded to GCS: %s", uri)
    return uri


def _gcs_download(remote_key: str) -> bytes:
    client = _get_gcs_client()
    if client is None:
        raise RuntimeError("GCS client unavailable")
    bucket = client.bucket(GCS_BUCKET)
    blob = bucket.blob(remote_key)
    data = blob.download_as_bytes()
    logger.info("Downloaded from GCS: gs://%s/%s", GCS_BUCKET, remote_key)
    return data


# ---------------------------------------------------------------------------
# S3 helpers
# ---------------------------------------------------------------------------

def _get_s3_client():
    """Lazy-initialise an S3 client."""
    try:
        import boto3
        return boto3.client(
            "s3",
            aws_access_key_id=S3_ACCESS_KEY,
            aws_secret_access_key=S3_SECRET_KEY,
            region_name=S3_REGION,
        )
    except Exception as e:
        logger.error("Failed to initialise S3 client: %s", e)
        return None


def _s3_upload(file_content: bytes, remote_key: str) -> str:
    client = _get_s3_client()
    if client is None:
        raise RuntimeError("S3 client unavailable")
    client.put_object(Bucket=S3_BUCKET_NAME, Key=remote_key, Body=file_content)
    uri = f"s3://{S3_BUCKET_NAME}/{remote_key}"
    logger.info("Uploaded to S3: %s", uri)
    return uri


def _s3_download(remote_key: str) -> bytes:
    client = _get_s3_client()
    if client is None:
        raise RuntimeError("S3 client unavailable")
    response = client.get_object(Bucket=S3_BUCKET_NAME, Key=remote_key)
    data = response["Body"].read()
    logger.info("Downloaded from S3: s3://%s/%s", S3_BUCKET_NAME, remote_key)
    return data


# ---------------------------------------------------------------------------
# Local filesystem helpers
# ---------------------------------------------------------------------------

def _local_path(remote_key: str, org_id: Optional[str] = None) -> str:
    """Build a local filesystem path mirroring the remote key structure."""
    if org_id:
        return os.path.join(LOCAL_STORAGE_DIR, org_id, remote_key)
    return os.path.join(LOCAL_STORAGE_DIR, remote_key)


def _local_upload(file_content: bytes, remote_key: str, org_id: Optional[str] = None) -> str:
    path = _local_path(remote_key, org_id)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(file_content)
    logger.info("Saved to local storage: %s", path)
    return path


def _local_download(remote_key: str, org_id: Optional[str] = None) -> bytes:
    path = _local_path(remote_key, org_id)
    if not os.path.exists(path):
        raise FileNotFoundError(f"Local file not found: {path}")
    with open(path, "rb") as f:
        return f.read()


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def upload_file(
    file_content: bytes,
    remote_key: str,
    org_id: Optional[str] = None,
    local_fallback_path: Optional[str] = None,
) -> str:
    """
    Upload *file_content* to the configured storage backend.

    Args:
        file_content: Raw bytes of the file to store.
        remote_key: Object key / path in the remote bucket.
        org_id: Optional organisation ID used for namespacing.
        local_fallback_path: Legacy parameter — if provided and we fall back to
            local storage, this path is used instead of the auto-generated one.

    Returns:
        The URI or local path where the file was persisted.
    """
    # Namespace the key by org_id when provided
    namespaced_key = f"{org_id}/{remote_key}" if org_id else remote_key

    if _BACKEND == "gcs":
        try:
            return _gcs_upload(file_content, namespaced_key)
        except Exception as e:
            logger.warning("GCS upload failed, falling back to local: %s", e)

    if _BACKEND == "s3":
        try:
            return _s3_upload(file_content, namespaced_key)
        except Exception as e:
            logger.warning("S3 upload failed, falling back to local: %s", e)

    # Local fallback
    if local_fallback_path:
        os.makedirs(os.path.dirname(local_fallback_path), exist_ok=True)
        with open(local_fallback_path, "wb") as f:
            f.write(file_content)
        logger.info("Saved to legacy local fallback: %s", local_fallback_path)
        return local_fallback_path

    return _local_upload(file_content, remote_key, org_id)


def download_file(
    remote_key: str,
    org_id: Optional[str] = None,
    local_fallback_path: Optional[str] = None,
) -> bytes:
    """
    Download file bytes from the configured storage backend.

    Args:
        remote_key: Object key / path in the remote bucket.
        org_id: Optional organisation ID used for namespacing.
        local_fallback_path: Legacy parameter — if the remote download fails and
            this path exists locally, read from it instead.

    Returns:
        The raw bytes of the requested file.

    Raises:
        FileNotFoundError: If the file cannot be found in any backend.
    """
    namespaced_key = f"{org_id}/{remote_key}" if org_id else remote_key

    if _BACKEND == "gcs":
        try:
            return _gcs_download(namespaced_key)
        except Exception as e:
            logger.warning("GCS download failed: %s", e)

    if _BACKEND == "s3":
        try:
            return _s3_download(namespaced_key)
        except Exception as e:
            logger.warning("S3 download failed: %s", e)

    # Local fallback
    if local_fallback_path and os.path.exists(local_fallback_path):
        with open(local_fallback_path, "rb") as f:
            return f.read()

    try:
        return _local_download(remote_key, org_id)
    except FileNotFoundError:
        raise FileNotFoundError(
            f"File not found in any backend — key={remote_key}, org_id={org_id}, "
            f"local_fallback={local_fallback_path}"
        )


def get_active_backend() -> str:
    """Return the name of the currently active storage backend."""
    return _BACKEND
