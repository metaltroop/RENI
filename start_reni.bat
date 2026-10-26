@echo off
chcp 65001 >nul
setlocal

title RENI // HOST SERVER AND TUNNEL LAUNCHER
echo ==============================================================================
echo   R.E.N.I.S. // LAUNCHING REMOTE ACCESS SYSTEM AND TUNNEL
echo ==============================================================================

:: Check for Administrative Elevation and re-run as admin if needed
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [!] Requesting elevated administrator execution...
    powershell -Command "Start-Process cmd -ArgumentList '/c \"\"%~f0\"\"' -Verb RunAs"
    exit /b
)

cd /d "%~dp0"

:: 1. Detect and auto-launch Cloudflare Tunnel if installed
set "CLOUDFLARED_BIN="
if exist "C:\Program Files (x86)\cloudflared\cloudflared.exe" (
    set "CLOUDFLARED_BIN=C:\Program Files (x86)\cloudflared\cloudflared.exe"
) else if exist "C:\Program Files\cloudflared\cloudflared.exe" (
    set "CLOUDFLARED_BIN=C:\Program Files\cloudflared\cloudflared.exe"
) else (
    where.exe cloudflared.exe >nul 2>&1
    if %errorLevel% equ 0 set "CLOUDFLARED_BIN=cloudflared"
)

if defined CLOUDFLARED_BIN (
    echo [*] Checking for and terminating any prior RENI tunnel...
    powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter 'Name = ''cloudflared.exe''' | Where-Object { $_.CommandLine -like '* reni*' -or $_.CommandLine -like '*8765*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; Write-Host ('[+] Terminated previous RENI tunnel (PID ' + $_.ProcessId + ')') }"
    echo [*] Launching fresh RENI Cloudflare Tunnel in background...
    start "RENI Cloudflare Tunnel" /MIN "%CLOUDFLARED_BIN%" tunnel run --url http://127.0.0.1:8765 reni
    echo [+] RENI Cloudflare Tunnel started (bound to IPv4 http://127.0.0.1:8765).
)

:: 2. Check for Python virtual environment in RENIS\venv and launch server
if exist "RENIS\venv\Scripts\activate.bat" (
    echo [*] Activating Python environment from .\RENIS\venv...
    call "RENIS\venv\Scripts\activate.bat"
    python "RENIS\renis_server.py"
) else (
    echo [!] Virtual environment not found at .\RENIS\venv.
    echo [*] Falling back to system Python...
    python "RENIS\renis_server.py"
)

if %errorLevel% neq 0 (
    echo.
    echo [-] RENIS Server terminated unexpectedly with exit code %errorLevel%.
    echo [*] If dependencies are missing, run setup_renis_admin.bat first.
    pause
)

:: 3. Clean up RENI tunnel on shutdown
if defined CLOUDFLARED_BIN (
    echo.
    echo [*] Stopping RENI Cloudflare Tunnel...
    powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter 'Name = ''cloudflared.exe''' | Where-Object { $_.CommandLine -like '* reni*' -or $_.CommandLine -like '*8765*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }" >nul 2>&1
)

