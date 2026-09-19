$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node).Source
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("moah-native-tree-" + [System.IO.Path]::GetRandomFileName())
New-Item -ItemType Directory -Path $tempRoot | Out-Null

function Start-Background([string]$FilePath, [string[]]$ArgumentList) {
  return Start-Process -FilePath $FilePath -ArgumentList $ArgumentList -WindowStyle Hidden -PassThru
}

function Read-Samples([string]$Path) {
  $samples = @()
  if (Test-Path -LiteralPath $Path) {
    foreach ($line in [System.IO.File]::ReadAllLines($Path)) {
      if ($line -match '"workingSetBytes"') { $samples += ($line | ConvertFrom-Json) }
    }
  }
  return $samples
}

function Measure-Mode([string]$Mode, [string[]]$NodeArgs) {
  $sampleFile = Join-Path $tempRoot "$Mode.samples.jsonl"
  $child = Start-Background $node $NodeArgs
  try {
    $sampler = Start-Background 'powershell.exe' @('-NoProfile','-File',(Join-Path $repo 'scripts/measure-tree.ps1'),'-RootProcessId',([string]$child.Id),'-OutputPath',$sampleFile)
    try {
      Wait-Process -Id $child.Id -Timeout 90
    } finally {
      if (-not $sampler.HasExited) { Wait-Process -Id $sampler.Id -Timeout 15 }
    }
  } finally {
    if (-not $child.HasExited) { Stop-Process -Id $child.Id -Force -ErrorAction SilentlyContinue }
  }
  $samples = Read-Samples $sampleFile
  $ws = @($samples | ForEach-Object { [double]$_.workingSetBytes })
  $pb = @($samples | ForEach-Object { [double]$_.privateBytes })
  [ordered]@{
    mode = $Mode
    sampleCount = $samples.Count
    workingSetMinMiB = if ($ws.Count) { [math]::Round(($ws | Measure-Object -Minimum).Minimum / 1MB, 1) } else { $null }
    workingSetMaxMiB = if ($ws.Count) { [math]::Round(($ws | Measure-Object -Maximum).Maximum / 1MB, 1) } else { $null }
    workingSetMeanMiB = if ($ws.Count) { [math]::Round(($ws | Measure-Object -Average).Average / 1MB, 1) } else { $null }
    privateBytesMinMiB = if ($pb.Count) { [math]::Round(($pb | Measure-Object -Minimum).Minimum / 1MB, 1) } else { $null }
    privateBytesMaxMiB = if ($pb.Count) { [math]::Round(($pb | Measure-Object -Maximum).Maximum / 1MB, 1) } else { $null }
    privateBytesMeanMiB = if ($pb.Count) { [math]::Round(($pb | Measure-Object -Average).Average / 1MB, 1) } else { $null }
  }
}

try {
  $results = @(
    (Measure-Mode 'moah-pi-help' @('--import','tsx',(Join-Path $repo 'src/cli.ts'),'pi','--help')),
    (Measure-Mode 'moah-dense-help' @('--import','tsx',(Join-Path $repo 'src/cli.ts'),'dense','--help'))
  )
  $results | ConvertTo-Json -Depth 3
} finally {
  Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
