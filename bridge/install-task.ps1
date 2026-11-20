# Registers the "PostlineBridge" scheduled task: starts the always-on Gmail bridge when you log in to Windows (hidden) and
# re-checks every 5 minutes, so it comes back by itself if it ever stops. A second copy can never start (port lock).
# Pause without uninstalling: create a file named PAUSE in this folder. Remove with:
#   Unregister-ScheduledTask -TaskName PostlineBridge -Confirm:$false
$vbs = Join-Path $PSScriptRoot 'launch-bridge-hidden.vbs'
$action   = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('"' + $vbs + '"')
$logon    = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$watchdog = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
            -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 3650)
Register-ScheduledTask -TaskName 'PostlineBridge' -Action $action -Trigger @($logon, $watchdog) -Settings $settings -Description 'Always-on Postline bridge: Gmail <-> iCloud.' -Force | Out-Null
Start-ScheduledTask -TaskName 'PostlineBridge'
Get-ScheduledTask -TaskName 'PostlineBridge' | Select-Object TaskName, State | Format-Table -AutoSize | Out-String | Write-Host
