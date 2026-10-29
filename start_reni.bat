@echo off
chcp 65001 >nul
setlocal

:: Always change directory to project root immediately
cd /d "%~dp0"

title RENI // HOST SYSTEM CONTROL CENTER (v3.0)
echo ==============================================================================
echo   R.E.N.I.S. // HOST CONTROL CENTER AND UNIVERSAL TUNNEL MANAGER (v3.0)
echo ==============================================================================

:: Parse command line flags
set "IS_CLI="
set "NO_ELEVATE="
for %%A in (%*) do (
    if "%%~A"=="--cli" set "IS_CLI=1"
    if "%%~A"=="--no-elevate" set "NO_ELEVATE=1"
)

:: Check for Administrative Privileges and Auto-Elevate
net session >nul 2>&1
if %errorLevel% neq 0 (
    if defined NO_ELEVATE (
        echo [*] Running in Standard User mode.
        echo [!] Note: UAC prompts cannot be viewed or controlled without Administrator rights.
    ) else (
        echo [*] Administrator privileges required to view and control UAC prompts.
        echo [*] Requesting elevation...
        set "PASS_ARGS=%*"
        if defined PASS_ARGS (
            powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -WorkingDirectory '%~dp0' -ArgumentList '%PASS_ARGS%' -Verb RunAs"
        ) else (
            powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -WorkingDirectory '%~dp0' -Verb RunAs"
        )
        exit /b
    )
) else (
    echo [+] Running with Elevated Administrator Privileges [UAC Access Enabled].
)

:: Choose target script based on mode
set "TARGET_SCRIPT=RENIS\renis_gui.py"
if defined IS_CLI (
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
