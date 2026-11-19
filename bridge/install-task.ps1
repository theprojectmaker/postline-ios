# Runs the Postline bridge hidden at every login (and starts it now).
$bat = Join-Path $PSScriptRoot 'run-bridge.bat'
$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c start /min `"`" `"$bat`""
$trigger = New-ScheduledTaskTrigger -AtLogOn
$set = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName 'PostlineBridge' -Action $action -Trigger $trigger -Settings $set -Force | Out-Null
Start-ScheduledTask -TaskName 'PostlineBridge'
Write-Host 'PostlineBridge installed and started.'
