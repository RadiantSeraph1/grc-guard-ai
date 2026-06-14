# GRC Guard AI - local launch (Windows PowerShell)
# Starts all four services in separate windows:
#   1. Backend API        http://localhost:8001  (matches frontend proxy)
#   2. AgentOS (agno)      http://localhost:7777
#   3. Frontend (Next.js)  http://localhost:3000
#   4. agno UI             http://localhost:3001  -> point endpoint at :7777
#
# Usage:  ./start-dev.ps1

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

Write-Host "Starting GRC Guard AI services..." -ForegroundColor Cyan

# 1. Backend API
Start-Process powershell -ArgumentList @(
  "-NoExit", "-Command",
  "cd '$root\backend'; .\venv\Scripts\Activate.ps1; python -m uvicorn main:app --host 0.0.0.0 --port 8001"
)

# 2. AgentOS (agno runtime for the agno UI)
Start-Process powershell -ArgumentList @(
  "-NoExit", "-Command",
  "cd '$root\backend'; .\venv\Scripts\Activate.ps1; python -m uvicorn agent_os:app --host 0.0.0.0 --port 7777"
)

# 3. Frontend
Start-Process powershell -ArgumentList @(
  "-NoExit", "-Command",
  "cd '$root\frontend'; npm run dev"
)

# 4. agno UI
Start-Process powershell -ArgumentList @(
  "-NoExit", "-Command",
  "cd '$root\agent-ui'; npm run dev"
)

Write-Host ""
Write-Host "Launched:" -ForegroundColor Green
Write-Host "  Backend API   http://localhost:8001/api/health"
Write-Host "  AgentOS       http://localhost:7777"
Write-Host "  Frontend      http://localhost:3000"
Write-Host "  agno UI       http://localhost:3001  (set endpoint to http://localhost:7777)"
