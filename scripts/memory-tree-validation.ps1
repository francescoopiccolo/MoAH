$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node).Source
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("moah-tree-" + [System.IO.Path]::GetRandomFileName())
New-Item -ItemType Directory -Path $tempRoot | Out-Null

function Start-Background([string]$FilePath, [string[]]$ArgumentList) {
  return Start-Process -FilePath $FilePath -ArgumentList $ArgumentList -WindowStyle Hidden -PassThru
}

function Wait-Ready([string]$Marker, [int]$TimeoutMs) {
  $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMs)
  while (-not (Test-Path -LiteralPath $Marker)) {
    if ([DateTime]::UtcNow -gt $deadline) { throw "Timed out waiting for $Marker" }
    Start-Sleep -Milliseconds 250
  }
}

function Read-Samples([string]$Path) {
  $samples = @()
  if (Test-Path -LiteralPath $Path) {
    foreach ($line in [System.IO.File]::ReadAllLines($Path)) {
      if ($line -match '"workingSetBytes"') {
        $samples += ($line | ConvertFrom-Json)
      }
    }
  }
  return $samples
}

$modes = @('idle','workers','evicted')
$results = @()

try {
  foreach ($mode in $modes) {
    $marker = Join-Path $tempRoot "$mode.ready.json"
    $sampleFile = Join-Path $tempRoot "$mode.samples.jsonl"
    $child = Start-Background $node @('--import','tsx',(Join-Path $repo 'scripts/memory-workload-child.ts'),$marker,$mode,'12000','5')
    try {
      Wait-Ready $marker 30000
      $sampler = Start-Background 'powershell.exe' @('-NoProfile','-File',(Join-Path $repo 'scripts/measure-tree.ps1'),'-RootProcessId',([string]$child.Id),'-OutputPath',$sampleFile)
      try {
        Wait-Process -Id $child.Id -Timeout 60
      } finally {
        if (-not $sampler.HasExited) { Wait-Process -Id $sampler.Id -Timeout 15 }
      }
    } finally {
      if (-not $child.HasExited) { Stop-Process -Id $child.Id -Force -ErrorAction SilentlyContinue }
    }

    $samples = Read-Samples $sampleFile
    $ws = @($samples | ForEach-Object { [double]$_.workingSetBytes })
    $pb = @($samples | ForEach-Object { [double]$_.privateBytes })
    $results += [ordered]@{
      mode = $mode
      sampleCount = $samples.Count
      workingSetMinMiB = if ($ws.Count) { [math]::Round(($ws | Measure-Object -Minimum).Minimum / 1MB, 1) } else { $null }
      workingSetMaxMiB = if ($ws.Count) { [math]::Round(($ws | Measure-Object -Maximum).Maximum / 1MB, 1) } else { $null }
      workingSetMeanMiB = if ($ws.Count) { [math]::Round(($ws | Measure-Object -Average).Average / 1MB, 1) } else { $null }
      privateBytesMinMiB = if ($pb.Count) { [math]::Round(($pb | Measure-Object -Minimum).Minimum / 1MB, 1) } else { $null }
      privateBytesMaxMiB = if ($pb.Count) { [math]::Round(($pb | Measure-Object -Maximum).Maximum / 1MB, 1) } else { $null }
      privateBytesMeanMiB = if ($pb.Count) { [math]::Round(($pb | Measure-Object -Average).Average / 1MB, 1) } else { $null }
    }
  }

  $results | ConvertTo-Json -Depth 3
} finally {
  Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
