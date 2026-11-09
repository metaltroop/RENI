@echo off
cd /d "%~dp0"
echo ========================================================
echo  RENI UAC TEST LAUNCHER
echo  Triggering Windows UAC Consent Elevation Prompt...
echo ========================================================
powershell -NoProfile -Command "Start-Process '.\test_uac_elevation.exe' -Verb runas"
