$ErrorActionPreference = "Stop"

$containerName = "supabase_db_GYMX2"
$databaseName = "gymx2_group_cap25_test_20261118"
$coachId = [guid]::NewGuid().ToString()
$sessionId = [guid]::NewGuid().ToString()
$memberIds = @(0..25 | ForEach-Object { [guid]::NewGuid().ToString() })
$memberUuidList = ($memberIds | ForEach-Object { "'$_'" }) -join ", "
$suffix = [guid]::NewGuid().ToString("N")
$actorAppName = "cap25-invite-race-a"
$actorJob = $null
$requestJob = $null
$databaseReady = $false

function Invoke-CapTestSql([string] $query) {
  $output = & docker exec $containerName psql -X -A -t -v ON_ERROR_STOP=1 -U postgres -d $databaseName -c $query 2>&1
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) {
    throw "Disposable cap test SQL failed (exit $exitCode): $($output -join "`n")"
  }
  return ($output -join "`n").Trim()
}

function Start-CapTestInsert([string] $appName, [string] $memberId, [bool] $holdLock) {
  $query = if ($holdLock) {
    @"
BEGIN;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '10s';
SET LOCAL application_name = '$appName';
INSERT INTO public.session_invites (session_id, member_id) VALUES ('$sessionId', '$memberId');
SELECT pg_sleep(3);
COMMIT;
"@
  } else {
    @"
SET statement_timeout = '15s';
SET lock_timeout = '10s';
SET application_name = '$appName';
INSERT INTO public.session_invites (session_id, member_id) VALUES ('$sessionId', '$memberId');
"@
  }

  return Start-Job -ArgumentList $containerName, $databaseName, $appName, $query -ScriptBlock {
    param($jobContainerName, $jobDatabaseName, $jobAppName, $jobQuery)
    $output = & docker exec -e "PGAPPNAME=$jobAppName" $jobContainerName psql -X -v ON_ERROR_STOP=1 -U postgres -d $jobDatabaseName -c $jobQuery 2>&1
    [pscustomobject]@{
      ExitCode = $LASTEXITCODE
      Output = ($output -join "`n")
    }
  }
}

try {
  $containerState = (& docker inspect --format '{{.State.Running}}' $containerName 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $containerState -ne "true") {
    throw "Expected local database container '$containerName' to be running."
  }
  Invoke-CapTestSql "SELECT 1;" | Out-Null
  $databaseReady = $true

  $userValues = @(
    "('$coachId', 'cap25-coach-$suffix@example.test', '{`"display_name`":`"Cap test coach`"}')"
  )
  for ($index = 0; $index -lt $memberIds.Count; $index++) {
    $memberId = $memberIds[$index]
    $userValues += "('$memberId', 'cap25-member-$index-$suffix@example.test', '{`"display_name`":`"Cap test member`"}')"
  }
  $initialInviteValues = ($memberIds[0..23] | ForEach-Object { "('$sessionId', '$_')" }) -join ",`n"
  $setupSql = @"
SET statement_timeout = '15s';
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
$($userValues -join ",`n");
UPDATE public.profiles SET role = 'coach' WHERE id = '$coachId';
UPDATE public.profiles SET role = 'member' WHERE id IN ($memberUuidList);
INSERT INTO public.calendar_sessions (id, coach_id, title, starts_at, ends_at)
VALUES ('$sessionId', '$coachId', 'Disposable cap 25 concurrency test', now() - interval '10 minutes', now() + interval '30 minutes');
INSERT INTO public.session_invites (session_id, member_id) VALUES
$initialInviteValues;
"@
  Invoke-CapTestSql $setupSql | Out-Null

  $actorJob = Start-CapTestInsert $actorAppName $memberIds[24] $true
  $lockHeld = $false
  for ($attempt = 0; $attempt -lt 100; $attempt++) {
    $active = Invoke-CapTestSql "SELECT count(*) FROM pg_stat_activity WHERE application_name = '$actorAppName' AND state = 'active' AND query ILIKE '%pg_sleep%';"
    if ($active -eq "1") {
      $lockHeld = $true
      break
    }
    Start-Sleep -Milliseconds 100
  }
  if (-not $lockHeld) {
    $actorState = if ($actorJob) { $actorJob.State } else { "not started" }
    $actorOutput = if ($actorJob) { (Receive-Job -Job $actorJob -Keep | ForEach-Object { $_.Output }) -join "`n" } else { "" }
    throw "Timed out waiting for the first insert to hold the session lock (job $actorState): $actorOutput"
  }

  $requestJob = Start-CapTestInsert "cap25-invite-race-b" $memberIds[25] $false
  $finished = Wait-Job -Job @($actorJob, $requestJob) -Timeout 18
  if ($finished.Count -ne 2) {
    throw "Concurrent invite transactions exceeded the 18 second test timeout."
  }
  $actorResult = Receive-Job -Job $actorJob
  $requestResult = Receive-Job -Job $requestJob
  if ($actorResult.ExitCode -ne 0) {
    throw "The 25th invite did not commit successfully: $($actorResult.Output)"
  }
  if ($requestResult.ExitCode -eq 0 -or $requestResult.Output -notmatch "A session can have at most 25 invited members") {
    throw "The concurrent 26th invite was not rejected by the cap trigger: $($requestResult.Output)"
  }

  $finalCount = Invoke-CapTestSql "SELECT count(*) FROM public.session_invites WHERE session_id = '$sessionId';"
  if ($finalCount -ne "25") {
    throw "Concurrent invite race left $finalCount invites instead of 25."
  }
  Write-Output "PASS: concurrent invite at capacity rejected the 26th invite; committed roster count is 25."
}
finally {
  $jobs = @($actorJob, $requestJob) | Where-Object { $_ -ne $null }
  foreach ($job in $jobs) {
    if ($job.State -eq "Running") { Stop-Job -Job $job }
    Remove-Job -Job $job -Force -ErrorAction SilentlyContinue
  }

  if ($databaseReady) {
    $cleanupSql = @"
SET statement_timeout = '15s';
DELETE FROM public.calendar_sessions WHERE id = '$sessionId';
DELETE FROM auth.users WHERE id IN ('$coachId', $memberUuidList);
"@
    try {
      Invoke-CapTestSql $cleanupSql | Out-Null
    }
    catch {
      Write-Warning "Disposable concurrency fixture cleanup failed; database remains limited to '$databaseName'."
      throw
    }
  }
}
