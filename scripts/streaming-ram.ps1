$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node).Source
$artifact = Join-Path $repo 'stream-artifacts\rg.bundle.mjs'
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("moah-stream-ram-" + [System.IO.Path]::GetRandomFileName())
New-Item -ItemType Directory -Path $tempRoot | Out-Null

function Start-Bg([string]$FilePath, [string[]]$ArgumentList) {
  Start-Process -FilePath $FilePath -ArgumentList $ArgumentList -WindowStyle Hidden -PassThru
}

function Read-Samples([string]$Path) {
  $out = @()
  if (Test-Path -LiteralPath $Path) {
    foreach ($line in [System.IO.File]::ReadAllLines($Path)) {
      if ($line -match '"workingSetBytes"') { $out += ($line | ConvertFrom-Json) }
    }
  }
  return $out
}

function Measure-Mode([string]$Mode) {
  $dir = Join-Path $tempRoot $Mode
  New-Item -ItemType Directory -Path (Join-Path $dir 'src') -Force | Out-Null
  @'
export function double(n) { return n * 2; }
'@ | Set-Content -LiteralPath (Join-Path $dir 'src\calc.js') -Encoding UTF8
  @'
{"type":"module"}
'@ | Set-Content -LiteralPath (Join-Path $dir 'package.json') -Encoding UTF8

  $stream = $Mode -ne 'native'
  $prefetch = $Mode -eq 'prefetch'
  $pkg = [ordered]@{ id = 'rg'; entry = $artifact }
  if ($stream) {
    $pkg.mode = 'stream'
    $pkg.stateless = $true
    $pkg.workerSdk = 'lazy'
    $pkg.nativeResident = $false
  } else {
    $pkg.mode = 'native'
    $pkg.nativeResident = $true
  }
  $config = [ordered]@{
    baseline = [ordered]@{ enabled = $false }
    router = [ordered]@{ enabled = $true; mode = 'auto'; baseUrl = 'https://openrouter.ai/api/v1'; model = 'openai/gpt-4o-mini'; apiKeyEnv = 'MOAH_ROUTER_API_KEY'; maxTools = 6; baseTools = @('read','bash','powershell','edit','write') }
    streaming = [ordered]@{ enabled = $stream; prefetch = $prefetch; cold = $false; hotPreload = 0; maxProcesses = 1; residentBudgetMb = 512; idleTtlMs = 120000; loadTimeoutMs = 30000; callTimeoutMs = 30000; estimatedRssMb = 64 }
    packages = @($pkg)
  }
  $configJson = $config | ConvertTo-Json -Depth 6
  [System.IO.File]::WriteAllText((Join-Path $dir 'moah.config.json'), $configJson, [System.Text.UTF8Encoding]::new($false))

  if (-not $env:MOAH_ROUTER_API_KEY) { throw 'MOAH_ROUTER_API_KEY is required' }
  if (-not $env:OPENROUTER_API_KEY) { throw 'OPENROUTER_API_KEY is required' }

  Push-Location $dir
  & $node (Join-Path $repo 'bin\moah.mjs') index 1> idx.out 2> idx.err
  $child = Start-Bg $node @((Join-Path $repo 'bin\moah.mjs'), 'pi', '--provider', 'openrouter', '--model', 'openai/gpt-4o-mini', '--mode', 'json', '-p', 'Use ripgrep to search for double in src/calc.js, then report the matching line.')
  $sampleFile = Join-Path $dir 'samples.jsonl'
  $sampler = Start-Bg 'powershell.exe' @('-NoProfile','-File',(Join-Path $repo 'scripts\measure-tree.ps1'),'-RootProcessId',([string]$child.Id),'-OutputPath',$sampleFile)
  Wait-Process -Id $child.Id -Timeout 120
  Wait-Process -Id $sampler.Id -Timeout 15
  Pop-Location

  $samples = Read-Samples $sampleFile
  $ws = @($samples | ForEach-Object { [double]$_.workingSetBytes })
  $pb = @($samples | ForEach-Object { [double]$_.privateBytes })
  $counts = @($samples | ForEach-Object { @($_.pids).Count })
  [ordered]@{
    mode = $Mode
    samples = $samples.Count
    workingSetMinMB = if ($ws.Count) { [math]::Round(($ws | Measure-Object -Minimum).Minimum / 1MB, 1) } else { $null }
    workingSetMaxMB = if ($ws.Count) { [math]::Round(($ws | Measure-Object -Maximum).Maximum / 1MB, 1) } else { $null }
    workingSetMeanMB = if ($ws.Count) { [math]::Round(($ws | Measure-Object -Average).Average / 1MB, 1) } else { $null }
    privateMinMB = if ($pb.Count) { [math]::Round(($pb | Measure-Object -Minimum).Minimum / 1MB, 1) } else { $null }
    privateMaxMB = if ($pb.Count) { [math]::Round(($pb | Measure-Object -Maximum).Maximum / 1MB, 1) } else { $null }
    maxChildCount = if ($counts.Count) { ($counts | Measure-Object -Maximum).Maximum } else { $null }
  }
}

try {
  $results = @(
    (Measure-Mode 'native'),
    (Measure-Mode 'demand'),
    (Measure-Mode 'prefetch')
  )
  $results | ConvertTo-Json -Depth 3
} finally {
  Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
