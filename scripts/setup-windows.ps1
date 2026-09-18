$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskRuntime = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies'
$taskBundledNode = Join-Path $taskRuntime 'node/bin/node.exe'
$taskNode = if (Test-Path -LiteralPath $taskBundledNode) { $taskBundledNode } else { (Get-Command node).Source }
$taskNpmDir = Split-Path -Parent (Get-Command npm.cmd).Source
$taskNpmCli = Join-Path $taskNpmDir 'node_modules/npm/bin/npm-cli.js'
Push-Location $taskRoot
try {
  & $taskNode -e 'const [major,minor]=process.versions.node.split(".").map(Number); if(major<22||(major===22&&minor<19)) throw Error("Node >=22.19 required")'
  if ($LASTEXITCODE -ne 0) { throw 'Unsupported Node runtime' }
  & $taskNode $taskNpmCli ci
  if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
  & "$PSScriptRoot/run.ps1" index
  if ($LASTEXITCODE -ne 0) { throw 'MoAH index failed' }
} finally { Pop-Location }
