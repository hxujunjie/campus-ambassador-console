param([switch]$Remove)

$ErrorActionPreference = "Stop"
$taskName = "Campus Console Enterprise WeChat Daily Sync"

if ($Remove) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Output "已移除每日企业微信同步任务。"
  exit 0
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $repoRoot ".wecom\sync-config.json"
if (-not (Test-Path -LiteralPath $configPath)) {
  throw "请先运行 npm run wecom:configure 选择群并设置线上公开别名。"
}

$node = (Get-Command node -ErrorAction Stop).Source
$syncScript = Join-Path $PSScriptRoot "wecom-sync.mjs"
Push-Location $repoRoot
try {
  & $node --experimental-strip-types $syncScript sync --publish --dry-run
  if ($LASTEXITCODE -ne 0) {
    throw "自动同步预检未通过，尚未创建计划任务。请先修复 CLI、群授权或 GitHub 读取问题。"
  }
}
finally {
  Pop-Location
}

$wrapper = Join-Path $PSScriptRoot "run-wecom-sync.ps1"
$powershell = Join-Path $PSHOME "powershell.exe"
if (-not (Test-Path -LiteralPath $powershell)) {
  $powershell = (Get-Command pwsh -ErrorAction Stop).Source
}
$action = New-ScheduledTaskAction `
  -Execute $powershell `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$wrapper`"" `
  -WorkingDirectory $repoRoot
$trigger = New-ScheduledTaskTrigger -Daily -At ([datetime]::Today.AddHours(20))
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 15) `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -RunOnlyIfNetworkAvailable
$principal = New-ScheduledTaskPrincipal `
  -UserId "$env:USERDOMAIN\$env:USERNAME" `
  -LogonType Interactive `
  -RunLevel Limited
$task = New-ScheduledTask `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Principal $principal `
  -Description "Reads group-level message totals locally and refreshes the public campus workbench snapshot."
Register-ScheduledTask -TaskName $taskName -InputObject $task -Force | Out-Null
Write-Output "已设置每日 20:00 自动同步。电脑需开机且当前 Windows 用户已登录；遗漏时间会在下次可运行时补执行。日志保存在 .wecom\auto-sync.log。"
