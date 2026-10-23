@echo off
setlocal

title RENI // NITRO HOST SERVER LAUNCHER
echo ==============================================================================
echo   R.E.N.I.S. // LAUNCHING NITRO REMOTE ACCESS ENGINE
echo ==============================================================================

:: Check for Administrative Elevation and re-run as admin if needed
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [!] Requesting elevated administrator execution...
    powershell -Command "Start-Process cmd -ArgumentList '/c \"\"%~f0\"\"' -Verb RunAs"
    exit /b
)

cd /d "%~dp0"

:: Check for Python virtual environment in RENIS\venv
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
