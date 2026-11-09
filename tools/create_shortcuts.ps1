$WshShell = New-Object -ComObject WScript.Shell
$appData = [Environment]::GetFolderPath('ApplicationData')
$iconPath = "c:\projects\RENI\RENIS\reni_icon.ico"

# 1. Start Menu Programs Shortcut
$startMenuDir = Join-Path $appData "Microsoft\Windows\Start Menu\Programs"
$startMenuPath = Join-Path $startMenuDir "RENI.lnk"
$sc = $WshShell.CreateShortcut($startMenuPath)
$sc.TargetPath = "c:\projects\RENI\start_reni.bat"
$sc.WorkingDirectory = "c:\projects\RENI"
$sc.Description = "RENI // Remote System Control Center"
if (Test-Path $iconPath) {
    $sc.IconLocation = "$iconPath, 0"
}
$sc.Save()
Write-Host "[+] Start Menu Shortcut created: $startMenuPath"

# 2. Windows Startup Shortcut (Task Manager Startup apps list)
$startupDir = Join-Path $appData "Microsoft\Windows\Start Menu\Programs\Startup"
$startupPath = Join-Path $startupDir "RENI.lnk"
$sc2 = $WshShell.CreateShortcut($startupPath)
$sc2.TargetPath = "c:\projects\RENI\start_reni.bat"
$sc2.WorkingDirectory = "c:\projects\RENI"
$sc2.Description = "RENI // Remote System Control Center"
if (Test-Path $iconPath) {
    $sc2.IconLocation = "$iconPath, 0"
}
$sc2.Save()
Write-Host "[+] Windows Startup Shortcut created: $startupPath"
