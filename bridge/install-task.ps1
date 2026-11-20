# Registers the "PostlineBridge" scheduled task: starts the always-on Gmail bridge at logon, hidden.
# Pause without uninstalling: create a file named PAUSE in this folder. Remove with:
#   Unregister-ScheduledTask -TaskName PostlineBridge -Confirm:$false
$vbs = Join-Path $PSScriptRoot 'launch-bridge-hidden.vbs'
$action   = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('"' + $vbs + '"')
$trigger  = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
            -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 3650)
Register-ScheduledTask -TaskName 'PostlineBridge' -Action $action -Trigger $trigger -Settings $settings -Description 'Always-on Postline bridge: Gmail <-> iCloud.' -Force | Out-Null
Start-ScheduledTask -TaskName 'PostlineBridge'
Get-ScheduledTask -TaskName 'PostlineBridge' | Select-Object TaskName, State | Format-Table -AutoSize | Out-String | Write-Host
