param([Parameter(ValueFromRemainingArguments=$true)][string[]]$MoahArgs)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskBundledNode = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
$taskNode = if (Test-Path -LiteralPath $taskBundledNode) { $taskBundledNode } else { (Get-Command node).Source }
$taskNativeRoot = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/native'
$taskPathAdditions = @(
  (Join-Path $taskRoot '.moah/venv/Scripts'),
  (Join-Path $taskRoot '.moah/venv/Lib/site-packages/pypandoc/files'),
  (Join-Path $taskNativeRoot 'git/usr/bin'),
  (Join-Path $taskNativeRoot 'git/cmd'),
  (Join-Path $taskNativeRoot 'poppler/Library/bin')
) | Where-Object { Test-Path -LiteralPath $_ }
$taskOriginalPath = $env:PATH
$env:PATH = ($taskPathAdditions -join ';') + ';' + $env:PATH
Push-Location $taskRoot
try {
  & $taskNode --import tsx src/cli.ts @MoahArgs
  exit $LASTEXITCODE
} finally { Pop-Location; $env:PATH = $taskOriginalPath }
