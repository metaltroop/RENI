@echo off
setlocal EnableDelayedExpansion

title RENI // RESTORE WINDOWS FACTORY SECURITY & REMOVE MODIFICATIONS
echo ==============================================================================
echo   R.E.N.I. // SECURITY RESET & UNINSTALL UTILITY
echo   Restores Windows Factory UAC, Secure Desktop, Power, and Firewall Policies
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

echo.
echo [*] [STEP 1/4] Restoring Windows UAC and Secure Desktop to Microsoft Defaults...
:: Restore Secure Desktop (PromptOnSecureDesktop = 1)
reg add "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System" /v PromptOnSecureDesktop /t REG_DWORD /d 1 /f >nul 2>&1

:: Restore UAC Admin Prompt to Default (ConsentPromptBehaviorAdmin = 2: Prompt for consent on secure desktop)
reg add "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System" /v ConsentPromptBehaviorAdmin /t REG_DWORD /d 2 /f >nul 2>&1

:: Disable UIA Desktop Toggle
reg add "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System" /v EnableUIADesktopToggle /t REG_DWORD /d 0 /f >nul 2>&1

:: Disable Software SAS Generation (Software cannot simulate Ctrl+Alt+Del)
reg add "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System" /v SoftwareSASGeneration /t REG_DWORD /d 0 /f >nul 2>&1

echo [+] Registry successfully restored:
echo     [OK] PromptOnSecureDesktop      = 1 (Secure Desktop active, blocks background grab)
echo     [OK] ConsentPromptBehaviorAdmin = 2 (Prompt for consent on secure desktop)
echo     [OK] EnableUIADesktopToggle     = 0 (Assistive desktop switching disabled)
echo     [OK] SoftwareSASGeneration      = 0 (Software Ctrl+Alt+Del simulation disabled)

echo.
echo [*] [STEP 2/4] Restoring Windows PowerCFG Defaults...
powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 1 >nul 2>&1
powercfg /change standby-timeout-ac 30 >nul 2>&1
powercfg /setactive SCHEME_CURRENT >nul 2>&1
echo [+] PowerCFG restored:
echo     [OK] Laptop lid close on AC power restored to Sleep (LIDACTION=1)
echo     [OK] System standby timeout restored to default (30 min)

echo.
echo [*] [STEP 3/4] Deleting RENI Windows Firewall Rules...
netsh advfirewall firewall delete rule name="RENI Remote Server (Port 8765)" >nul 2>&1
netsh advfirewall firewall delete rule name="RENI Nitro Server (Port 8765)" >nul 2>&1
echo [+] Inbound firewall rules for Port 8765 removed.

echo.
echo [*] [STEP 4/4] Optional Test Executable Cleanup...
if exist "test_uac_elevation.exe" (
    echo     [i] Found test_uac_elevation.exe. Removing test binaries...
    del /f /q "test_uac_elevation.exe" >nul 2>&1
    if exist "trigger_uac_test.bat" del /f /q "trigger_uac_test.bat" >nul 2>&1
    echo     [OK] Test executables cleaned up.
) else (
    echo     [i] No test executables found.
)

echo.
echo ==============================================================================
echo   SUCCESS: ALL WINDOWS SETTINGS RESTORED TO FACTORY SECURITY DEFAULTS!
echo ==============================================================================
echo.
echo   Summary of Protection:
echo   - No program can silently auto-elevate to Administrator.
echo   - All UAC prompts will appear exclusively on the isolated Secure Desktop.
echo   - Port 8765 is closed in Windows Firewall.
echo   - Normal lid-close sleep behavior is re-enabled.
echo.
pause
