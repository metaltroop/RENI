@echo off
setlocal EnableDelayedExpansion

title RENI // SYSTEM, POWER & UAC CONFIGURATION
echo ==============================================================================
echo   R.E.N.I.S. // REMOTE ACCESS SERVER - ADMINISTRATOR SETUP
echo   Windows UAC Secure Desktop, PowerCFG Lid-Close, Firewall, Venv, and AutoStart
echo ==============================================================================

:: 1. Check for Administrative Privileges and Auto-Elevate
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [!] Administrator privileges required. Requesting elevation...
    powershell -Command "Start-Process cmd -ArgumentList '/c \"\"%~f0\"\"' -Verb RunAs"
    exit /b
)

echo [+] Running with Elevated Administrator Privileges.
cd /d "%~dp0"

:: 2. Configure Windows Registry: Disable PromptOnSecureDesktop
echo.
echo [*] [STEP 1/5] Configuring Windows UAC Secure Desktop Policy...
reg add "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System" /v PromptOnSecureDesktop /t REG_DWORD /d 0 /f >nul 2>&1
if %errorLevel% equ 0 (
    echo [+] Successfully set PromptOnSecureDesktop = 0 in Windows Registry.
) else (
    echo [-] Warning: Failed to set PromptOnSecureDesktop registry value.
)

:: 3. Configure PowerCFG: Prevent Sleep on Lid Close & Standby when Plugged In
echo.
echo [*] [STEP 2/5] Configuring Windows PowerCFG (Lid-Closed 24/7 Accessibility)...
powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0 >nul 2>&1
powercfg /change standby-timeout-ac 0 >nul 2>&1
powercfg /change hibernate-timeout-ac 0 >nul 2>&1
powercfg /setactive SCHEME_CURRENT >nul 2>&1
if %errorLevel% equ 0 (
    echo [+] Configured PowerCFG: Closing laptop lid on AC power will NOT suspend the system.
) else (
    echo [-] Warning: PowerCFG lid configuration failed.
)

:: 4. Configure Windows Firewall Rule for Port 8765
echo.
echo [*] [STEP 3/5] Configuring Inbound Windows Firewall Rule for Port 8765...
netsh advfirewall firewall delete rule name="RENI Nitro Server (Port 8765)" >nul 2>&1
netsh advfirewall firewall add rule name="RENI Nitro Server (Port 8765)" dir=in action=allow protocol=TCP localport=8765 profile=any >nul 2>&1
if %errorLevel% equ 0 (
    echo [+] Windows Firewall inbound TCP rule created on port 8765.
) else (
    echo [-] Warning: Failed to create Windows Firewall rule.
)

:: 5. Setup Python Virtual Environment and Install Dependencies
echo.
echo [*] [STEP 4/5] Checking Python Virtual Environment and Dependencies...
if not exist "RENIS\venv" (
    echo [*] Creating virtual environment in .\RENIS\venv...
    python -m venv "RENIS\venv"
    if %errorLevel% neq 0 (
        echo [-] Error: Python was not found or failed to create venv. Ensure Python 3.10+ is installed and in PATH.
        pause
        exit /b 1
    )
) else (
    echo [*] Existing virtual environment found in .\RENIS\venv.
)

echo [*] Upgrading pip and verifying requirements from .\RENIS\requirements.txt...
call "RENIS\venv\Scripts\activate.bat"
python -m pip install -r "RENIS\requirements.txt"
if %errorLevel% neq 0 (
    echo [-] Warning: One or more requirements failed to install. Please check network connectivity.
) else (
    echo [+] All Python requirements verified in .\RENIS\venv.
)

:: 6. Create Windows Scheduled Task for AutoStart with Highest Privileges
echo.
echo [*] [STEP 5/5] Registering Windows Scheduled Task for AutoStart (Highest Privileges)...
set "LAUNCH_CMD=%~dp0start_reni.bat"
schtasks /create /tn "RENIS_AutoStart" /tr "\"%LAUNCH_CMD%\"" /sc onlogon /rl HIGHEST /f >nul 2>&1
if %errorLevel% equ 0 (
    echo [+] Scheduled Task 'RENIS_AutoStart' created with highest administrative privileges.
) else (
    echo [-] Warning: Failed to register Scheduled Task.
)

echo.
echo ==============================================================================
echo   >> RENIS SETUP COMPLETE!
echo   >> Laptop is configured for 24/7 remote access (lid closed on AC).
echo   >> Start server anytime with: start_reni.bat
echo ==============================================================================
echo.
pause
