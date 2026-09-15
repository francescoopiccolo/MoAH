param([ValidateSet('pi', 'bench')][string]$Command = 'pi')
$ErrorActionPreference = 'Stop'
$taskPreviousKey = $env:OPENROUTER_API_KEY
try {
  if (!$env:OPENROUTER_API_KEY) {
    $taskSecret = Read-Host 'OpenRouter API key (solo per questa esecuzione)' -AsSecureString
    $env:OPENROUTER_API_KEY = [System.Net.NetworkCredential]::new('', $taskSecret).Password
    $taskSecret.Dispose()
    if (!$env:OPENROUTER_API_KEY) { throw 'API key mancante' }
  }
  if ($Command -eq 'bench') {
    & "$PSScriptRoot/run.ps1" bench benchmarks/smoke.json
  } else {
    & "$PSScriptRoot/run.ps1" pi --provider openrouter --model qwen/qwen3-coder-next --thinking off
  }
  exit $LASTEXITCODE
} finally { $env:OPENROUTER_API_KEY = $taskPreviousKey }
