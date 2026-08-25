# Always-on launcher for the backend, meant to be run by a Task Scheduler
# job that fires "At log on" so the server comes back automatically after
# a reboot (see RUNNING_INSTRUCTIONS.md's "Always-on deployment" section
# for the full setup this script is one piece of). Safe to run by hand too
# — it does exactly what the manual `uvicorn` command in
# RUNNING_INSTRUCTIONS.md does, just resolving the port from .env instead
# of requiring you to remember/pass it.

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$logDir = Join-Path $PSScriptRoot "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir "uvicorn.log"

$port = "8000"
$envFile = Join-Path $PSScriptRoot ".env"
if (Test-Path $envFile) {
    $match = Select-String -Path $envFile -Pattern '^API_PORT=(\d+)' -ErrorAction SilentlyContinue
    if ($match) { $port = $match.Matches[0].Groups[1].Value }
}

$python = Join-Path $PSScriptRoot "venv\Scripts\python.exe"
if (-not (Test-Path $python)) {
    throw "venv not found at $python — run 'python -m venv venv; venv\Scripts\pip install -r requirements.txt' first."
}

"$(Get-Date -Format o) — starting on port $port" | Add-Content -Path $logFile
& $python -m uvicorn app.main:app --host 0.0.0.0 --port $port *>> $logFile
"$(Get-Date -Format o) — process exited" | Add-Content -Path $logFile
