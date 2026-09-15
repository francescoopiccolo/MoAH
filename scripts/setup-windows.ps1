$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskRuntime = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies'
$taskBundledNode = Join-Path $taskRuntime 'node/bin/node.exe'
$taskNode = if (Test-Path -LiteralPath $taskBundledNode) { $taskBundledNode } else { (Get-Command node).Source }
$taskBundledPython = Join-Path $taskRuntime 'python/python.exe'
$taskPython = if (Test-Path -LiteralPath $taskBundledPython) { $taskBundledPython } else { (Get-Command python).Source }
$taskNpmDir = Split-Path -Parent (Get-Command npm.cmd).Source
$taskNpmCli = Join-Path $taskNpmDir 'node_modules/npm/bin/npm-cli.js'
Push-Location $taskRoot
try {
  & $taskNode -e 'const [major,minor]=process.versions.node.split(".").map(Number); if(major<22||(major===22&&minor<19)) throw Error("Node >=22.19 required")'
  if ($LASTEXITCODE -ne 0) { throw 'Unsupported Node runtime' }
  & $taskNode $taskNpmCli ci
  if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
  if (!(Test-Path -LiteralPath '.moah/venv/Scripts/python.exe')) {
    & $taskPython -m venv .moah/venv
    if ($LASTEXITCODE -ne 0) { throw 'Cannot create local Python environment' }
  }
  & '.\.moah\venv\Scripts\python.exe' -m pip install --disable-pip-version-check -r scripts/web-tools-requirements.txt
  if ($LASTEXITCODE -ne 0) { throw 'Web tool prerequisites failed to install' }
  & "$PSScriptRoot/run.ps1" setup
  if ($LASTEXITCODE -ne 0) { throw 'MoAH setup failed' }
} finally { Pop-Location }
