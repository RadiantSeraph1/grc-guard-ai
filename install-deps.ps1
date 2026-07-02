# GRC Guard AI - one-click dependency installer (Windows PowerShell)
#
# Installs everything the app needs to run:
#   1. Backend  - Python venv + pip install -r backend/requirements.txt
#   2. Frontend - npm install (Next.js app)
#
# Usage:  right-click -> "Run with PowerShell", or:  ./install-deps.ps1
# After it finishes, start everything with:           ./start-dev.ps1

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

function Write-Step($msg)  { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)    { Write-Host "    [OK] $msg" -ForegroundColor Green }
function Write-Fail($msg)  { Write-Host "    [FAIL] $msg" -ForegroundColor Red }

# Resolve a Python launcher (prefers the 'py' launcher, falls back to python).
# Returns the executable and its base args separately so they can be splatted.
function Get-Python {
  foreach ($cmd in @("py", "python")) {
    if (Get-Command $cmd -ErrorAction SilentlyContinue) {
      if ($cmd -eq "py") { return [pscustomobject]@{ Exe = "py"; BaseArgs = @("-3") } }
      else               { return [pscustomobject]@{ Exe = "python"; BaseArgs = @() } }
    }
  }
  return $null
}

Write-Host "GRC Guard AI - installing all dependencies" -ForegroundColor White

# ---- Preflight: required tooling ------------------------------------------
Write-Step "Checking prerequisites"
$py = Get-Python
if (-not $py) {
  Write-Fail "Python not found. Install Python 3.11+ from https://www.python.org/downloads/ and re-run."
  exit 1
}
$pyArgs = $py.BaseArgs
Write-Ok ("Python: " + ((& $py.Exe @pyArgs --version) 2>&1))

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Fail "npm not found. Install Node.js 18+ from https://nodejs.org/ and re-run."
  exit 1
}
Write-Ok ("Node:   " + (node --version) + "  npm: " + (npm --version))

# ---- 1. Backend (Python venv + pip) ---------------------------------------
Write-Step "Backend: creating virtual environment + installing Python packages"
$venv = Join-Path $root "backend\venv"
$venvPy = Join-Path $venv "Scripts\python.exe"

if (-not (Test-Path $venvPy)) {
  & $py.Exe @pyArgs -m venv $venv
  if ($LASTEXITCODE -ne 0) { Write-Fail "Could not create venv."; exit 1 }
  Write-Ok "Created venv at backend\venv"
} else {
  Write-Ok "Reusing existing venv"
}

& $venvPy -m pip install --upgrade pip --quiet
& $venvPy -m pip install -r (Join-Path $root "backend\requirements.txt")
if ($LASTEXITCODE -ne 0) { Write-Fail "Backend pip install failed."; exit 1 }
Write-Ok "Backend Python dependencies installed"

# NOTE: --legacy-peer-deps is required because lucide-react@0.363.0 declares a
# React <=18 peer range while the app runs React 19. The dependency works fine
# at runtime; this flag just stops npm's strict peer-resolver from aborting.

# ---- 2. Frontend (Next.js) -------------------------------------------------
Write-Step "Frontend: npm install"
Push-Location (Join-Path $root "frontend")
npm install --legacy-peer-deps
$feExit = $LASTEXITCODE
Pop-Location
if ($feExit -ne 0) { Write-Fail "Frontend npm install failed."; exit 1 }
Write-Ok "Frontend dependencies installed"

# ---- Done ------------------------------------------------------------------
Write-Host "`nAll dependencies installed." -ForegroundColor Green
Write-Host "Next steps:" -ForegroundColor White
Write-Host "  1. (first run only) seed an empty org:  cd backend; .\venv\Scripts\Activate.ps1; python seed.py" -ForegroundColor Gray
Write-Host "  2. add backend\.env and frontend\.env.local (see README env templates)" -ForegroundColor Gray
Write-Host "  3. start everything:                    .\start-dev.ps1" -ForegroundColor Gray
Write-Host "`nOptional - model training extras (heavy, separate venv):" -ForegroundColor White
Write-Host "  pip install -r backend\training\requirements-train.txt" -ForegroundColor Gray
