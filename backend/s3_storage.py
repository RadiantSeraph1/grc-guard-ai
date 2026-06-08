import os
from typing import Optional

S3_BUCKET_NAME = os.environ.get("S3_BUCKET_NAME")
S3_ACCESS_KEY = os.environ.get("S3_ACCESS_KEY")
S3_SECRET_KEY = os.environ.get("S3_SECRET_KEY")
S3_REGION = os.environ.get("S3_REGION", "us-east-1")

def get_s3_client():
    if not S3_BUCKET_NAME or not S3_ACCESS_KEY or not S3_SECRET_KEY:
        return None
    try:
        import boto3
        return boto3.client(
            "s3",
            aws_access_key_id=S3_ACCESS_KEY,
            aws_secret_access_key=S3_SECRET_KEY,
            region_name=S3_REGION
        )
    except Exception as e:
        print(f"Failed to initialize S3 client: {str(e)}")
        return None

def upload_file(file_content: bytes, s3_key: str, local_fallback_path: str) -> str:
    """
    Upload file bytes to S3, or write to local disk if S3 is not configured.
    Returns the path/url where the file is stored.
    """
    s3_client = get_s3_client()
    if s3_client:
        try:
            s3_client.put_object(
                Bucket=S3_BUCKET_NAME,
                Key=s3_key,
                Body=file_content
            )
            print(f"Uploaded file to S3: s3://{S3_BUCKET_NAME}/{s3_key}")
            return f"s3://{S3_BUCKET_NAME}/{s3_key}"
        except Exception as e:
            print(f"S3 upload failed: {str(e)}. Falling back to local storage.")
    
    # Local fallback
    os.makedirs(os.path.dirname(local_fallback_path), exist_ok=True)
    with open(local_fallback_path, "wb") as f:
        f.write(file_content)
    print(f"Saved file to local fallback: {local_fallback_path}")
    return local_fallback_path

def download_file(s3_key: str, local_fallback_path: str) -> bytes:
    """
    Download file bytes from S3, or read from local disk if S3 is not configured.
    """
    s3_client = get_s3_client()
    if s3_client:
        try:
            response = s3_client.get_object(
                Bucket=S3_BUCKET_NAME,
                Key=s3_key
            )
            return response["Body"].read()
        except Exception as e:
            print(f"S3 download failed: {str(e)}. Attempting to read from local fallback.")
            
    # Local fallback
    if os.path.exists(local_fallback_path):
        with open(local_fallback_path, "rb") as f:
            return f.read()
    raise FileNotFoundError(f"File not found in S3 ({s3_key}) or local path ({local_fallback_path})")
