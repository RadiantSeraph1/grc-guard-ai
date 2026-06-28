# GRC Auditor — Backend (FastAPI + agno) service image.
FROM python:3.12-slim

# System deps occasionally needed by cryptography / psycopg2 wheels.
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps first for better layer caching.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# App code.
COPY . .

EXPOSE 8001

# The frontend proxy expects the API on :8001. Override CMD to run agent_os:app
# (the agno AgentOS) on :7777 if you also want the agent UI backend.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
