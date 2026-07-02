# GRC Guard AI - local launch (Windows PowerShell)
# Starts both services in separate windows:
#   1. Backend API        http://localhost:8001  (matches frontend proxy)
#   2. Frontend (Next.js)  http://localhost:3000
#
# Run ./install-deps.ps1 first if you haven't installed dependencies.
# Usage:  ./start-dev.ps1

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

# ---- Preflight: make sure dependencies are actually installed -------------
$missing = @()
if (-not (Test-Path "$root\backend\venv\Scripts\python.exe")) { $missing += "backend venv" }
if (-not (Test-Path "$root\frontend\node_modules"))          { $missing += "frontend node_modules" }

if ($missing.Count -gt 0) {
  Write-Host "Dependencies missing: $($missing -join ', ')" -ForegroundColor Red
  Write-Host "Run the installer first:  ./install-deps.ps1" -ForegroundColor Yellow
  exit 1
}

Write-Host "Starting GRC Guard AI services..." -ForegroundColor Cyan

# 1. Backend API (:8001)
Start-Process powershell -ArgumentList @(
  "-NoExit", "-Command",
  "cd '$root\backend'; .\venv\Scripts\Activate.ps1; python -m uvicorn main:app --host 0.0.0.0 --port 8001"
)

# 2. Frontend (:3000)
Start-Process powershell -ArgumentList @(
  "-NoExit", "-Command",
  "cd '$root\frontend'; npm run dev -- -p 3000"
)

Write-Host ""
Write-Host "Launched:" -ForegroundColor Green
Write-Host "  Backend API   http://localhost:8001/api/health"
Write-Host "  Frontend      http://localhost:3000"
Write-Host ""
Write-Host "Each service runs in its own window. Close the windows to stop them." -ForegroundColor Gray
