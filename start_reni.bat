@echo off
chcp 65001 >nul
setlocal

:: Always change directory to project root immediately
cd /d "%~dp0"

title RENI // HOST SYSTEM CONTROL CENTER (v3.0)
echo ==============================================================================
echo   R.E.N.I.S. // HOST CONTROL CENTER AND UNIVERSAL TUNNEL MANAGER (v3.0)
echo ==============================================================================

:: Check elevation status (informational; standard user works out of the box)
net session >nul 2>&1
if %errorLevel% equ 0 (
    echo [+] Running with Administrator privileges.
) else (
    echo [*] Running in Standard User mode.
)

:: Check for CLI flag
set "TARGET_SCRIPT=RENIS\renis_gui.py"
if "%~1"=="--cli" (
    echo [*] CLI mode requested. Launching terminal server...
    set "TARGET_SCRIPT=RENIS\renis_server.py"
) else (
    echo [*] Launching RENI Desktop GUI Control Center...
)

:: Locate Python executable
set "PYTHON_EXE="
if exist "RENIS\venv\Scripts\python.exe" (
    set "PYTHON_EXE=RENIS\venv\Scripts\python.exe"
) else (
    where.exe python.exe >nul 2>&1
    if %errorLevel% equ 0 set "PYTHON_EXE=python"
)

if not defined PYTHON_EXE (
    echo.
    echo [-] Python executable not found in .\RENIS\venv or system PATH!
    echo [*] Please run setup_renis_admin.bat first to configure the environment.
    pause
    exit /b 1
)

:: Launch the target application
"%PYTHON_EXE%" "%TARGET_SCRIPT%" %*

if %errorLevel% neq 0 (
    echo.
    echo [-] RENI application exited with code %errorLevel%.
    echo [*] Check logs above or run setup_renis_admin.bat if dependencies are missing.
    pause
)
