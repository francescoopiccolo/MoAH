param([int]$RootProcessId, [string]$OutputPath)
$ErrorActionPreference = 'Stop'
$taskEncoding = [System.Text.UTF8Encoding]::new($false)
while ($true) {
  try {
    $taskAll = @(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,WorkingSetSize,PrivatePageCount)
    if (!($taskAll | Where-Object { $_.ProcessId -eq $RootProcessId })) { break }
    $taskIds = [System.Collections.Generic.HashSet[uint32]]::new()
    [void]$taskIds.Add([uint32]$RootProcessId)
    do {
      $taskChanged = $false
      foreach ($taskProcess in $taskAll) {
        if ($taskIds.Contains([uint32]$taskProcess.ParentProcessId) -and $taskIds.Add([uint32]$taskProcess.ProcessId)) { $taskChanged = $true }
      }
    } while ($taskChanged)
    $taskTree = @($taskAll | Where-Object { $taskIds.Contains([uint32]$_.ProcessId) })
    $taskSample = [ordered]@{ time = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); pids = @($taskTree.ProcessId); workingSetBytes = [double](($taskTree | Measure-Object WorkingSetSize -Sum).Sum); privateBytes = [double](($taskTree | Measure-Object PrivatePageCount -Sum).Sum) }
    [System.IO.File]::AppendAllText($OutputPath, (($taskSample | ConvertTo-Json -Compress) + "`n"), $taskEncoding)
  } catch {
    [System.IO.File]::AppendAllText($OutputPath, "{`"error`":`"Memory sampling failed`"}`n", $taskEncoding)
    break
  }
  Start-Sleep -Milliseconds 250
}
