$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$syncScript = Join-Path $PSScriptRoot "wecom-sync.mjs"
$localDirectory = Join-Path $repoRoot ".wecom"
$logPath = Join-Path $localDirectory "auto-sync.log"
New-Item -ItemType Directory -Path $localDirectory -Force | Out-Null

$node = (Get-Command node -ErrorAction Stop).Source
$start = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
"[$start] Daily sync started." | Out-File -FilePath $logPath -Append -Encoding utf8
Push-Location $repoRoot
try {
  & $node --experimental-strip-types $syncScript sync --publish *>> $logPath
  $exitCode = $LASTEXITCODE
  $end = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  "[$end] Daily sync finished with exit code $exitCode." | Out-File -FilePath $logPath -Append -Encoding utf8
  exit $exitCode
}
catch {
  $end = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  "[$end] Daily sync could not start. Check the local CLI and configuration." | Out-File -FilePath $logPath -Append -Encoding utf8
  exit 1
}
finally {
  Pop-Location
}
