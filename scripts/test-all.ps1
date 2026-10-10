# Full test of the Ramas ERP project - one command:
#   1. Server API tests        (server/test: api, accounts, docket + challan calculations) against the dev database
#   2. Client build check      (production build of every page into a temp folder - catches compile / import errors)
#   3. UI test as EMP001       (every page in headless Edge, every tab clicked: crashes, console errors, failing APIs)
#   4. UI test as admin        (same, with the admin-only pages)
# Needs the dev servers running: API http://localhost:4000 and web http://localhost:5173 (START-APP.ps1).
#
#   powershell -ExecutionPolicy Bypass -File scripts\test-all.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\test-all.ps1 -SkipUi      (only 1 + 2)
#
# Reports: docs\test-reports\  (summary-<time>.md + the UI test reports). Exit code 0 = everything passed.
param([switch]$SkipUi)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$reports = Join-Path $root 'docs\test-reports'
New-Item -ItemType Directory -Force -Path $reports | Out-Null
$stamp = Get-Date -Format 'yyyy-MM-dd-HH-mm'
$startedAt = Get-Date
$results = @()
function Add-Result($step, $ok, $detail) {
  $script:results += [pscustomobject]@{ Step = $step; Result = $(if ($ok) { 'PASS' } else { 'FAIL' }); Detail = $detail }
  $color = $(if ($ok) { 'Green' } else { 'Red' })
  Write-Host ("{0,-28} {1}  {2}" -f $step, $(if ($ok) { 'PASS' } else { 'FAIL' }), $detail) -ForegroundColor $color
}

Write-Host "`n=== Ramas ERP - full test ($stamp) ===`n" -ForegroundColor Cyan

# ---- 0. servers
$api = $false; $web = $false
try { $api = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 10 http://127.0.0.1:4000/api/health).Content -like '*ok*' } catch {}
# the web dev server can be slow on its first request (Vite optimising packages): try for up to a minute
for ($i = 0; $i -lt 6 -and -not $web; $i++) { try { $web = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 10 http://localhost:5173/).StatusCode -eq 200 } catch { Start-Sleep 5 } }
if (-not $api) { Write-Host 'API is not running on :4000 - start the app first (START-APP.ps1).' -ForegroundColor Red; exit 2 }

# ---- 1. server API tests
Write-Host '1/4  Server API tests (2-6 min) ...' -ForegroundColor Cyan
$log = Join-Path $reports "server-tests-$stamp.txt"
Push-Location (Join-Path $root 'server')
npm test *> $log
$code = $LASTEXITCODE
Pop-Location
$txt = Get-Content $log -Raw
$tests = if ($txt -match 'tests (\d+)') { $Matches[1] } else { '?' }
$pass = if ($txt -match 'pass (\d+)') { $Matches[1] } else { '?' }
$fail = if ($txt -match 'fail (\d+)') { $Matches[1] } else { '?' }
Add-Result 'Server API tests' ($code -eq 0 -and $fail -eq '0') "$pass / $tests passed, $fail failed  (log: docs\test-reports\server-tests-$stamp.txt)"

# ---- 2. client production build
Write-Host '2/4  Client production build ...' -ForegroundColor Cyan
$dist = Join-Path $env:TEMP "ramas-build-check-$stamp"
Push-Location (Join-Path $root 'client')
$buildOut = npx vite build --outDir $dist --emptyOutDir 2>&1 | Out-String
$code = $LASTEXITCODE
Pop-Location
$warn = ($buildOut -split "`n" | Where-Object { $_ -match 'Circular|error' }) -join ' '
Add-Result 'Client build' ($code -eq 0 -and -not $warn) $(if ($warn) { $warn } else { 'all pages compile, no circular chunks' })
Remove-Item -Recurse -Force $dist -ErrorAction SilentlyContinue

# ---- 3 + 4. UI tests
if ($SkipUi) {
  Write-Host '3-4  UI tests skipped (-SkipUi)' -ForegroundColor Yellow
} elseif (-not $web) {
  Add-Result 'UI tests' $false 'web app is not running on :5173'
} else {
  foreach ($u in @(@{ n = 'EMP001'; p = 'emp123'; step = '3/4' }, @{ n = 'admin'; p = 'admin123'; step = '4/4' })) {
    Write-Host "$($u.step)  UI test as $($u.n) (every page, about 3 min) ..." -ForegroundColor Cyan
    $env:UI_USER = $u.n; $env:UI_PASS = $u.p
    $out = node (Join-Path $root 'scripts\ui-test.mjs') 2>&1 | Out-String
    $code = $LASTEXITCODE
    $line = ($out -split "`n" | Where-Object { $_ -match '^Pages ' }) -join ''
    $failed = ($out -split "`n" | Where-Object { $_ -match '^FAIL ' }) -join '; '
    Add-Result "UI test ($($u.n))" ($code -eq 0) $(if ($failed) { "$line  FAILED: $failed" } else { $line.Trim() })
  }
  Remove-Item Env:UI_USER, Env:UI_PASS -ErrorAction SilentlyContinue
}

# ---- summary
$allOk = -not ($results | Where-Object { $_.Result -eq 'FAIL' })
$md = @("# Full test - $stamp", '', "Overall: **$(if ($allOk) { 'PASS' } else { 'FAIL' })**", '', '| Step | Result | Detail |', '|---|---|---|')
$md += $results | ForEach-Object { "| $($_.Step) | $($_.Result) | $($_.Detail -replace '\|', '/') |" }
$md -join "`n" | Out-File -Encoding utf8 (Join-Path $reports "summary-$stamp.md")
# machine-readable copy for the in-app Test Dashboard (/test-dashboard)
[pscustomobject]@{
  stamp = $stamp; overall = $(if ($allOk) { 'PASS' } else { 'FAIL' }); finishedAt = (Get-Date).ToString('s')
  seconds = [int]((Get-Date) - $startedAt).TotalSeconds; serverLog = "server-tests-$stamp.txt"; steps = $results
} | ConvertTo-Json -Depth 4 | Out-File -Encoding utf8 (Join-Path $reports "summary-$stamp.json")
Write-Host "`nOverall: $(if ($allOk) { 'PASS' } else { 'FAIL' })   report: docs\test-reports\summary-$stamp.md`n" -ForegroundColor $(if ($allOk) { 'Green' } else { 'Red' })
if ($allOk) { exit 0 } else { exit 1 }
