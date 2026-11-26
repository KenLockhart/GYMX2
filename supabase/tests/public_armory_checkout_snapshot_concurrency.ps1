#Requires -Version 7.2
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[A-Fa-f0-9]{64}$')]
  [string]$ExpectedMigrationSha256
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Fail closed: this harness is permitted to touch only the dedicated clone D.
$ContainerName = 'supabase_db_GYMX2'
$DatabaseName = 'gymx2_public_armory_guest_test_20261118d'
$MigrationPath = (Resolve-Path (Join-Path $PSScriptRoot '..\migrations\20261118110000_public_armory_guest_commerce.sql')).Path
$ActualMigrationSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $MigrationPath).Hash
if ($ActualMigrationSha256 -ne $ExpectedMigrationSha256.ToUpperInvariant()) {
  throw 'Frozen migration hash does not match the approved test hash.'
}

$docker = (Get-Command docker -ErrorAction Stop).Source
$runningContainers = @(& $docker ps --format '{{.Names}}')
if ($LASTEXITCODE -ne 0 -or $runningContainers -notcontains $ContainerName) {
  throw 'The expected local database container is not running.'
}

$runTag = [Guid]::NewGuid().ToString('N')
$applicationNames = @(
  "armory_snap_a_$runTag",
  "armory_snap_b_$runTag",
  "armory_edit_a_$runTag",
  "armory_edit_b_$runTag",
  "armory_snap_observer_$runTag"
)
$coachId = [Guid]::NewGuid().ToString()
$snapshotItemId = [Guid]::NewGuid().ToString()
$editFirstItemId = [Guid]::NewGuid().ToString()
$snapshotIntentId = [Guid]::NewGuid().ToString()
$editFirstIntentId = [Guid]::NewGuid().ToString()
$guestEmail = "snapshot-$runTag@example.test"

$snapshotOldPath = "$coachId/snapshot-$runTag-before.pdf"
$snapshotOldName = "snapshot-$runTag-before.pdf"
$snapshotNewPath = "$coachId/snapshot-$runTag-after.pdf"
$snapshotNewName = "snapshot-$runTag-after.pdf"
$editOldPath = "$coachId/edit-$runTag-before.pdf"
$editOldName = "edit-$runTag-before.pdf"
$editNewPath = "$coachId/edit-$runTag-after.pdf"
$editNewName = "edit-$runTag-after.pdf"

$scratchDir = Join-Path ([System.IO.Path]::GetTempPath()) "gymx2-armory-concurrency-$runTag"
$containerScratch = "/tmp/gymx2-armory-concurrency-$runTag"
$localSqlFiles = [System.Collections.Generic.List[string]]::new()
$containerSqlFiles = [System.Collections.Generic.List[string]]::new()
$containerMarkers = [System.Collections.Generic.List[string]]::new()
$ownedProcesses = [System.Collections.Generic.List[object]]::new()
$setupAttempted = $false
$containerScratchCreated = $false
$succeeded = $false

function Start-DockerProcess {
  param([Parameter(Mandatory = $true)][string[]]$Arguments)

  $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $docker
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  foreach ($argument in $Arguments) { $startInfo.ArgumentList.Add($argument) }

  $process = [System.Diagnostics.Process]::new()
  $process.StartInfo = $startInfo
  if (-not $process.Start()) { throw 'Could not start the owned Docker command.' }
  $stdoutTask = $process.StandardOutput.ReadToEndAsync()
  $stderrTask = $process.StandardError.ReadToEndAsync()
  return [pscustomobject]@{
    Process = $process
    StdoutTask = $stdoutTask
    StderrTask = $stderrTask
  }
}

function Complete-DockerProcess {
  param(
    [Parameter(Mandatory = $true)]$Running,
    [Parameter(Mandatory = $true)][int]$TimeoutSeconds,
    [Parameter(Mandatory = $true)][string]$Description
  )

  if (-not $Running.Process.WaitForExit($TimeoutSeconds * 1000)) {
    try { $Running.Process.Kill($true); $Running.Process.WaitForExit(2000) } catch { }
    throw "$Description exceeded its bounded wait."
  }
  $stdout = $Running.StdoutTask.GetAwaiter().GetResult()
  $stderr = $Running.StderrTask.GetAwaiter().GetResult()
  if ($Running.Process.ExitCode -ne 0) {
    $safeError = ($stderr -split "`r?`n" | Where-Object { $_ -match '\S' } | Select-Object -Last 1)
    throw "$Description failed with exit $($Running.Process.ExitCode): $safeError"
  }
  return $stdout
}

function Invoke-TargetSql {
  param(
    [Parameter(Mandatory = $true)][string]$Sql,
    [string]$ApplicationName = $applicationNames[4]
  )

  $running = Start-DockerProcess -Arguments @(
    'exec', '-e', "PGAPPNAME=$ApplicationName", $ContainerName,
    'psql', '-X', '-A', '-t', '-q', '-w', '-v', 'ON_ERROR_STOP=1',
    '-U', 'postgres', '-d', $DatabaseName, '-c', $Sql
  )
  $result = Complete-DockerProcess -Running $running -TimeoutSeconds 4 -Description 'Read-only target query'
  return $result.Trim()
}

function Write-ContainerSql {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Sql
  )

  $localPath = Join-Path $scratchDir $Name
  $containerPath = "$containerScratch/$Name"
  [System.IO.File]::WriteAllText($localPath, $Sql, [System.Text.UTF8Encoding]::new($false))
  $localSqlFiles.Add($localPath)
  $containerSqlFiles.Add($containerPath)
  $null = Complete-DockerProcess -Running (Start-DockerProcess -Arguments @(
    'cp', $localPath, "${ContainerName}:$containerPath"
  )) -TimeoutSeconds 5 -Description 'Copy owned concurrency script'
  return $containerPath
}

function Start-TargetSqlFile {
  param(
    [Parameter(Mandatory = $true)][string]$ApplicationName,
    [Parameter(Mandatory = $true)][string]$ContainerPath
  )

  $running = Start-DockerProcess -Arguments @(
    'exec', '-e', "PGAPPNAME=$ApplicationName", $ContainerName,
    'psql', '-X', '-A', '-t', '-q', '-w', '-v', 'ON_ERROR_STOP=1',
    '-U', 'postgres', '-d', $DatabaseName, '-f', $ContainerPath
  )
  $ownedProcesses.Add($running)
  return $running
}

function Wait-ContainerMarker {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][int]$TimeoutSeconds
  )

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  while ([DateTime]::UtcNow -lt $deadline) {
    $probe = Start-DockerProcess -Arguments @('exec', $ContainerName, 'test', '-f', $Path)
    if (-not $probe.Process.WaitForExit(5000)) {
      try { $probe.Process.Kill($true); $probe.Process.WaitForExit(2000) } catch { }
      throw 'Marker probe exceeded its bounded wait.'
    }
    $null = $probe.StdoutTask.GetAwaiter().GetResult()
    $probeError = $probe.StderrTask.GetAwaiter().GetResult()
    if ($probe.Process.ExitCode -eq 0) { return }
    if ($probe.Process.ExitCode -ne 1) { throw "Marker probe failed: $probeError" }
    Start-Sleep -Milliseconds 100
  }
  throw 'Timed out waiting for an owned transaction marker.'
}

function Wait-DatabaseLockWait {
  param(
    [Parameter(Mandatory = $true)][string]$ApplicationName,
    [Parameter(Mandatory = $true)][int]$TimeoutSeconds
  )

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  while ([DateTime]::UtcNow -lt $deadline) {
    $waiting = Invoke-TargetSql -Sql "select coalesce((select wait_event_type = 'Lock' from pg_stat_activity where datname = '$DatabaseName' and application_name = '$ApplicationName' and state = 'active' limit 1), false)"
    if ($waiting -eq 't') { return }
    Start-Sleep -Milliseconds 100
  }
  throw 'The competing session did not enter a PostgreSQL lock wait.'
}

function Stop-OwnedProcessesAndSessions {
  foreach ($running in $ownedProcesses) {
    if (-not $running.Process.HasExited) {
      try { $running.Process.Kill(); $running.Process.WaitForExit(2000) } catch { }
    }
  }

  $namesSql = ($applicationNames | ForEach-Object { "'$_'" }) -join ','
  $terminateSql = "select count(*) from pg_stat_activity where datname = '$DatabaseName' and application_name = any(array[$namesSql]) and pg_terminate_backend(pid)"
  try { $null = Invoke-TargetSql -Sql $terminateSql -ApplicationName "armory_cleanup_$runTag" } catch { }
}

function Remove-OwnedContainerFiles {
  $paths = @($containerSqlFiles.ToArray()) + @($containerMarkers.ToArray())
  if ($paths.Count -gt 0) {
    $arguments = @('exec', $ContainerName, 'rm', '-f', '--') + $paths
    $null = Complete-DockerProcess -Running (Start-DockerProcess -Arguments $arguments) -TimeoutSeconds 5 -Description 'Remove exact owned SQL and marker files'
  }
  if ($containerScratchCreated) {
    $null = Complete-DockerProcess -Running (Start-DockerProcess -Arguments @('exec', $ContainerName, 'rmdir', '--', $containerScratch)) -TimeoutSeconds 5 -Description 'Remove exact owned temporary directory'
    $script:containerScratchCreated = $false
  }
}

$snapshotMarker = "$containerScratch/snapshot-ready"
$snapshotEditMarker = "$containerScratch/snapshot-edit-started"
$editFirstMarker = "$containerScratch/edit-first-ready"
$editFirstCreateMarker = "$containerScratch/edit-first-create-started"
$containerMarkers.AddRange([string[]]@($snapshotMarker, $snapshotEditMarker, $editFirstMarker, $editFirstCreateMarker))

try {
  if ((Invoke-TargetSql -Sql 'select current_database()') -ne $DatabaseName) {
    throw 'Fail-closed database identity check failed.'
  }
  $functionExists = Invoke-TargetSql -Sql "select to_regprocedure('public.create_armory_checkout_intent(uuid,uuid,uuid,text,text,text,integer,timestamptz,integer,integer,text,text,text,text,text)') is not null"
  if ($functionExists -ne 't') { throw 'Frozen create-intent RPC signature is missing from clone C.' }
  $armoryTableExists = Invoke-TargetSql -Sql "select case when to_regclass('public.armory_items') is not null then 't' else 'f' end"
  if ($armoryTableExists -ne 't') { throw 'Expected Armory schema is missing from clone C.' }
  $cloneEmpty = Invoke-TargetSql -Sql "select (select count(*) from auth.users) + (select count(*) from auth.sessions) + (select count(*) from public.profiles) + (select count(*) from public.armory_items) + (select count(*) from public.armory_checkout_intents) + (select count(*) from public.purchases) = 0"
  if ($cloneEmpty -ne 't') { throw 'Clone C contains pre-existing user or commerce fixtures; refusing to write.' }

  if (Test-Path -LiteralPath $scratchDir) { throw 'Owned local scratch path unexpectedly exists.' }
  New-Item -ItemType Directory -Path $scratchDir | Out-Null
  $containerDirProbe = Start-DockerProcess -Arguments @('exec', $ContainerName, 'test', '-e', $containerScratch)
  if (-not $containerDirProbe.Process.WaitForExit(5000)) {
    try { $containerDirProbe.Process.Kill($true); $containerDirProbe.Process.WaitForExit(2000) } catch { }
    throw 'Container scratch directory preflight exceeded its bounded wait.'
  }
  $null = $containerDirProbe.StdoutTask.GetAwaiter().GetResult()
  $null = $containerDirProbe.StderrTask.GetAwaiter().GetResult()
  if ($containerDirProbe.Process.ExitCode -eq 0) { throw 'Owned container scratch path unexpectedly exists.' }
  if ($containerDirProbe.Process.ExitCode -ne 1) { throw 'Could not verify the container scratch path is absent.' }
  $null = Complete-DockerProcess -Running (Start-DockerProcess -Arguments @('exec', $ContainerName, 'mkdir', '--', $containerScratch)) -TimeoutSeconds 5 -Description 'Create exact owned temporary directory'
  $containerScratchCreated = $true

  $dirProbe = Start-DockerProcess -Arguments @('exec', $ContainerName, 'test', '-e', $containerScratch)
  if (-not $dirProbe.Process.WaitForExit(5000)) {
    try { $dirProbe.Process.Kill($true); $dirProbe.Process.WaitForExit(2000) } catch { }
    throw 'Container scratch directory verification exceeded its bounded wait.'
  }
  $null = $dirProbe.StdoutTask.GetAwaiter().GetResult()
  $null = $dirProbe.StderrTask.GetAwaiter().GetResult()
  if ($dirProbe.Process.ExitCode -ne 0) { throw 'Could not verify the owned container scratch directory was created.' }

  $setupAttempted = $true
  $setupSql = @"
begin;
insert into auth.users (id, email, raw_user_meta_data)
values ('$coachId', 'snapshot-$runTag@example.test', '{"display_name":"Concurrency Coach"}');
update public.profiles set role = 'coach' where id = '$coachId';
insert into public.armory_items (
  id, coach_id, kind, category, title, description, price_cents,
  file_path, file_name, visible_to_all, shipping_cents, required_membership_tier
) values
  ('$snapshotItemId', '$coachId', 'paid', 'ebook', 'Snapshot first', 'Concurrency fixture', 1000, '$snapshotOldPath', '$snapshotOldName', true, 0, 'everyone'),
  ('$editFirstItemId', '$coachId', 'paid', 'ebook', 'Edit first', 'Concurrency fixture', 1100, '$editOldPath', '$editOldName', true, 0, 'everyone');
commit;
"@
  $null = Invoke-TargetSql -Sql $setupSql

  $snapshotVersion = Invoke-TargetSql -Sql "select to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD') || 'T' || to_char(updated_at at time zone 'UTC', 'HH24:MI:SS.US') || 'Z' from public.armory_items where id = '$snapshotItemId'"
  $editFirstVersion = Invoke-TargetSql -Sql "select to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD') || 'T' || to_char(updated_at at time zone 'UTC', 'HH24:MI:SS.US') || 'Z' from public.armory_items where id = '$editFirstItemId'"
  if ($snapshotVersion -notmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$' -or
      $editFirstVersion -notmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$') {
    throw 'Could not safely capture the synthetic item-version tokens.'
  }

  # Interleaving 1: the intent RPC locks and snapshots the file before the edit starts.
  $snapshotCall = "select public.create_armory_checkout_intent('$snapshotIntentId', '$snapshotItemId', null, '$guestEmail', 'en', null, 100, '$snapshotVersion'::timestamptz, 1000, 0, 'Snapshot first', 'paid', 'ebook', '$snapshotOldPath', '$snapshotOldName');"
  $snapshotSql = @"
begin;
$snapshotCall
\! touch $snapshotMarker
select pg_sleep(4);
commit;
"@
  $snapshotPath = Write-ContainerSql -Name 'snapshot-first.sql' -Sql $snapshotSql
  $snapshotProcess = Start-TargetSqlFile -ApplicationName $applicationNames[0] -ContainerPath $snapshotPath
  Wait-ContainerMarker -Path $snapshotMarker -TimeoutSeconds 5

  $editSql = @"
begin;
\! touch $snapshotEditMarker
update public.armory_items
set title = 'Snapshot edited', price_cents = 1300,
    file_path = '$snapshotNewPath', file_name = '$snapshotNewName'
where id = '$snapshotItemId';
commit;
"@
  $editPath = Write-ContainerSql -Name 'snapshot-edit.sql' -Sql $editSql
  $editProcess = Start-TargetSqlFile -ApplicationName $applicationNames[1] -ContainerPath $editPath
  Wait-ContainerMarker -Path $snapshotEditMarker -TimeoutSeconds 5
  Wait-DatabaseLockWait -ApplicationName $applicationNames[1] -TimeoutSeconds 3
  if ($snapshotProcess.Process.HasExited -or $editProcess.Process.HasExited) {
    throw 'Snapshot-first/edit-second transactions did not remain interleaved behind the item lock.'
  }
  $snapshotOutput = Complete-DockerProcess -Running $snapshotProcess -TimeoutSeconds 8 -Description 'Snapshot-first transaction'
  $editOutput = Complete-DockerProcess -Running $editProcess -TimeoutSeconds 8 -Description 'Snapshot-first item edit'
  if ($snapshotOutput.Trim() -ne 't') { throw 'Snapshot-first intent RPC did not accept the current item snapshot.' }

  $snapshotCheck = Invoke-TargetSql -Sql "select count(*) = 1 from public.armory_checkout_intents where id = '$snapshotIntentId' and item_id = '$snapshotItemId' and price_cents = 1000 and fee_cents = 100 and file_path = '$snapshotOldPath' and file_name = '$snapshotOldName' and status = 'pending' and stripe_session_id is null and stripe_payment_intent_id is null"
  if ($snapshotCheck -ne 't') { throw 'Snapshot-first intent did not preserve the old pending file/price snapshot.' }
  $snapshotItemCheck = Invoke-TargetSql -Sql "select count(*) = 1 from public.armory_items where id = '$snapshotItemId' and price_cents = 1300 and file_path = '$snapshotNewPath' and file_name = '$snapshotNewName'"
  if ($snapshotItemCheck -ne 't') { throw 'Snapshot-first edit did not complete after the intent commit.' }

  # Interleaving 2: edit commits first; the waiting create RPC must reject its old version.
  $editFirstUpdateSql = @"
begin;
update public.armory_items
set title = 'Edit first updated', price_cents = 1400,
    file_path = '$editNewPath', file_name = '$editNewName'
where id = '$editFirstItemId';
\! touch $editFirstMarker
select pg_sleep(5);
commit;
"@
  $editFirstUpdatePath = Write-ContainerSql -Name 'edit-first-update.sql' -Sql $editFirstUpdateSql
  $editFirstUpdateProcess = Start-TargetSqlFile -ApplicationName $applicationNames[2] -ContainerPath $editFirstUpdatePath
  Wait-ContainerMarker -Path $editFirstMarker -TimeoutSeconds 5

  $staleCreateCall = "select public.create_armory_checkout_intent('$editFirstIntentId', '$editFirstItemId', null, '$guestEmail', 'en', null, 110, '$editFirstVersion'::timestamptz, 1100, 0, 'Edit first', 'paid', 'ebook', '$editOldPath', '$editOldName');"
  $staleCreateSql = @"
begin;
\! touch $editFirstCreateMarker
$staleCreateCall
commit;
"@
  $staleCreatePath = Write-ContainerSql -Name 'edit-first-stale-create.sql' -Sql $staleCreateSql
  $staleCreateProcess = Start-TargetSqlFile -ApplicationName $applicationNames[3] -ContainerPath $staleCreatePath
  Wait-ContainerMarker -Path $editFirstCreateMarker -TimeoutSeconds 5
  Wait-DatabaseLockWait -ApplicationName $applicationNames[3] -TimeoutSeconds 3
  if ($editFirstUpdateProcess.Process.HasExited -or $staleCreateProcess.Process.HasExited) {
    throw 'Edit-first/stale-create transactions did not remain interleaved behind the item lock.'
  }
  $editFirstUpdateOutput = Complete-DockerProcess -Running $editFirstUpdateProcess -TimeoutSeconds 8 -Description 'Edit-first item transaction'
  $staleCreateOutput = Complete-DockerProcess -Running $staleCreateProcess -TimeoutSeconds 8 -Description 'Stale create-intent transaction'
  if ($staleCreateOutput.Trim() -ne 'f') { throw 'Stale create-intent RPC did not reject the pre-edit version.' }

  $editFirstCheck = Invoke-TargetSql -Sql "select count(*) = 0 from public.armory_checkout_intents where id = '$editFirstIntentId'"
  if ($editFirstCheck -ne 't') { throw 'Stale edit-first request inserted a checkout intent.' }
  $editFirstItemCheck = Invoke-TargetSql -Sql "select count(*) = 1 from public.armory_items where id = '$editFirstItemId' and price_cents = 1400 and file_path = '$editNewPath' and file_name = '$editNewName'"
  if ($editFirstItemCheck -ne 't') { throw 'Edit-first item update did not persist.' }
  $succeeded = $true
}
finally {
  $cleanupIssues = [System.Collections.Generic.List[string]]::new()
  try { Stop-OwnedProcessesAndSessions } catch { $cleanupIssues.Add("session shutdown: $($_.Exception.Message)") }

  if ($setupAttempted) {
    $cleanupSql = @"
begin;
delete from public.armory_checkout_intents where id in ('$snapshotIntentId', '$editFirstIntentId');
delete from public.armory_items where id in ('$snapshotItemId', '$editFirstItemId');
delete from auth.users where id = '$coachId';
commit;
select case when
  not exists (select 1 from public.armory_checkout_intents where id in ('$snapshotIntentId', '$editFirstIntentId'))
  and not exists (select 1 from public.armory_items where id in ('$snapshotItemId', '$editFirstItemId'))
  and not exists (select 1 from auth.users where id = '$coachId')
then 'clean' else 'leftover' end;
"@
    try {
      $cleanupResult = Invoke-TargetSql -Sql $cleanupSql -ApplicationName "armory_cleanup_$runTag"
      if ($cleanupResult -ne 'clean') { throw 'Owned fixture cleanup verification failed.' }
    } catch {
      $cleanupIssues.Add("fixture cleanup: $($_.Exception.Message)")
    }
  }

  try {
    $appNamesSql = ($applicationNames | ForEach-Object { "'$_'" }) -join ','
    $remainingSessions = Invoke-TargetSql -Sql "select count(*) from pg_stat_activity where datname = '$DatabaseName' and application_name = any(array[$appNamesSql])" -ApplicationName "armory_cleanup_$runTag"
    if ($remainingSessions -ne '0') { throw 'An owned PostgreSQL session remained after cleanup.' }
  } catch {
    $cleanupIssues.Add("session verification: $($_.Exception.Message)")
  }

  try { Remove-OwnedContainerFiles } catch { $cleanupIssues.Add("container temp cleanup: $($_.Exception.Message)") }
  foreach ($localPath in $localSqlFiles) {
    try { if (Test-Path -LiteralPath $localPath) { Remove-Item -LiteralPath $localPath -Force } }
    catch { $cleanupIssues.Add("local SQL cleanup: $($_.Exception.Message)") }
  }
  try { if (Test-Path -LiteralPath $scratchDir) { Remove-Item -LiteralPath $scratchDir } }
  catch { $cleanupIssues.Add("local directory cleanup: $($_.Exception.Message)") }
  if ($cleanupIssues.Count -gt 0) { throw ('Cleanup incomplete: ' + ($cleanupIssues -join '; ')) }
}

if (-not $succeeded) { throw 'Concurrency checks did not complete.' }
Write-Output 'PASS: snapshot-first kept the old path/price while the subsequent edit waited and committed.'
Write-Output 'PASS: edit-first made the stale snapshot RPC return false and created no intent.'
Write-Output 'PASS: snapshot intent remained pending/unbound; rejected stale request created no intent; no Stripe or Storage operations were invoked.'
Write-Output "PASS: only this run's fixture rows, psql sessions, and temporary SQL files were cleaned up."
