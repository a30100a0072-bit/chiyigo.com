# preview-gate-binding-canary-stage-a.ps1
# F-3 Phase 2 PR 0.2c-pre-3 -- Stage A (dry-run, zero side effect)
#
# Run via dot-source so generated variables persist into caller PS session:
#   . .\scripts\preview-gate-binding-canary-stage-a.ps1
#
# After completion, paste the printed ids summary back to Claude for review
# before running Stage B (which sets the 24h IRREVERSIBLE retention lock).
#
# r1 codex review (rejected initial; fixed below):
#   H1: account gate too weak -> + Account ID exact + reject CF_API_TOKEN env vars + r2 bucket list verify
#   H2: Pages deployment hash gate missing -> + manual typed Read-Host confirmation gate
#   M3: BAD_PREFIX probe too loose -> + parse JSON body + verify code === 'BAD_PREFIX'/'UNAUTHORIZED'
#   L4: atomic smoke fixed temp filename -> + GUID suffix + finally cleanup tmp/final
#
# r2 codex review (rejected after r1):
#   H1': also reject deprecated CF_* aliases (CF_API_TOKEN/_API_KEY/_EMAIL/CF_ACCOUNT_ID)
#        Wrangler docs still list these as deprecated globals -- enough to fail closed.
#
# r3 codex review (rejected after r2):
#   Critical: missing CLOUDFLARE_ACCOUNT_ID (wrangler 4.87 primary; CF_ACCOUNT_ID is deprecated alias).
#             Renamed list to bannedWranglerEnvVars since account ID is not strictly auth.
#
# r4 fix (Claude live debug; not codex finding):
#   Two PS 5.1 cmdlet quirks surfaced during user real run:
#   1. Invoke-WebRequest consumes response stream before throwing, so GetResponseStream
#      returns empty. Body must be read from $_.ErrorDetails.Message (PS 5.1) with stream
#      fallback for PS 7+. Verified by user run -- got "code='' body=" on first 401 probe.
#   2. Split-Path -LiteralPath -Parent is AmbiguousParameterSet on PS 5.1 (separate sets).
#      Replaced with [System.IO.Path]::GetDirectoryName which is cmdlet-independent.
#
# Checks performed (all read-only / no R2 touch / no rule add):
#   1. wrangler identity + Account ID exact + reject CF_API_TOKEN env + bucket list contains chiyigo-audit-archive
#   2. Pages production deployment hash matches expected (manual typed)
#   3. CRON_SECRET length/shape probe (value loaded into $cronSecret, NOT echoed)
#   4. Generate ids (prefix / ruleName / lifeName / controlKey / newKey / fixturePath / expectedSha)
#   5. Endpoint active probe (bad bearer -> 401 + code=UNAUTHORIZED; real bearer + bad prefix -> 400 + code=BAD_PREFIX)
#   6. Atomic-write helper smoke (GUID-suffixed temp; FileStream.Flush + Move-Item -Force)
#   7. Verify fixture target dir exists

$origEAP = $ErrorActionPreference
$ErrorActionPreference = 'Stop'

# Pinned baseline values (codex r1 H1 + H2):
$EXPECTED_EMAIL       = 'a30100a0072@gmail.com'
$EXPECTED_ACCOUNT_ID  = '2d2c4b4ddbddec1a5d045533c01d715f'
$EXPECTED_BUCKET      = 'chiyigo-audit-archive'
$EXPECTED_PAGES_HASH  = 'd11962b'

try {
  Write-Host ""
  Write-Host "=== Stage A: Dry-run (zero side effect) ===" -ForegroundColor Cyan
  Write-Host ""

  # [1/7] wrangler identity + Account ID + CF env var purity + bucket visibility
  Write-Host "[1/7] wrangler identity gate (codex r1 H1)..." -ForegroundColor Yellow

  # 1a: reject Wrangler env vars that override account/auth selection (must be pure OAuth + dashboard-selected account)
  # codex r2 H1' : also reject deprecated CF_* aliases per Wrangler env vars docs
  # codex r3 critical: also reject CLOUDFLARE_ACCOUNT_ID (wrangler 4.87 primary; CF_ACCOUNT_ID is deprecated alias)
  $bannedWranglerEnvVars = @(
    'CLOUDFLARE_API_TOKEN',
    'CLOUDFLARE_API_KEY',
    'CLOUDFLARE_EMAIL',
    'CLOUDFLARE_ACCOUNT_ID',
    'CF_API_TOKEN',
    'CF_API_KEY',
    'CF_EMAIL',
    'CF_ACCOUNT_ID'
  )
  foreach ($v in $bannedWranglerEnvVars) {
    $val = [Environment]::GetEnvironmentVariable($v)
    if ($val) {
      throw "$v env var is set; this breaks the OAuth-only / dashboard-selected-account gate. Unset: `$env:$v=`$null  (then retry)"
    }
  }
  Write-Host "      OK no CLOUDFLARE_*/CF_* auth/account env vars set (8 vars checked)"

  # 1b: wrangler whoami parse email + Account ID
  $whoamiOut = (& npx wrangler whoami) | Out-String
  if ($whoamiOut -notmatch [regex]::Escape($EXPECTED_EMAIL)) {
    throw "wrangler whoami did not return expected email $EXPECTED_EMAIL. Re-run 'npx wrangler login'."
  }
  $accountIdMatch = [regex]::Match($whoamiOut, '\b([a-f0-9]{32})\b')
  if (-not $accountIdMatch.Success) {
    throw "could not extract 32-char Account ID from wrangler whoami output"
  }
  $actualAccountId = $accountIdMatch.Groups[1].Value
  if ($actualAccountId -ne $EXPECTED_ACCOUNT_ID) {
    throw "Account ID mismatch: expected $EXPECTED_ACCOUNT_ID, got $actualAccountId"
  }
  Write-Host "      OK email matches + Account ID = $($EXPECTED_ACCOUNT_ID.Substring(0, 8))..."

  # 1c: r2 bucket list contains exact chiyigo-audit-archive (not -preview substring)
  $bucketListOut = (& npx wrangler r2 bucket list) | Out-String
  # Strip ANSI escape sequences (PREVIEW_GATE_RUNBOOK A1 codex r2 fix)
  $bucketListStripped = [regex]::Replace($bucketListOut, '\x1B\[[0-9;]*[a-zA-Z]', '')
  # Labelled format: 'name:  chiyigo-audit-archive\n' (wrangler 4.87+ output; reject -preview substring via \s*$)
  $bucketPattern = '(?m)^\s*name:\s*' + [regex]::Escape($EXPECTED_BUCKET) + '\s*$'
  if ($bucketListStripped -notmatch $bucketPattern) {
    throw "bucket '$EXPECTED_BUCKET' not visible in 'wrangler r2 bucket list' (pattern: $bucketPattern). Verify account selection."
  }
  Write-Host "      OK 'wrangler r2 bucket list' contains $EXPECTED_BUCKET (labelled match)"
  Write-Host ""

  # [2/7] Pages production deployment hash gate (codex r1 H2)
  Write-Host "[2/7] Pages production deployment hash gate (codex r1 H2)..." -ForegroundColor Yellow
  Write-Host ""
  Write-Host "  Verify Pages production deployment hash:"
  Write-Host "    1. Open Cloudflare dashboard -> Workers & Pages -> chiyigo-com -> Deployments"
  Write-Host "    2. Find the most-recent Production deployment"
  Write-Host "    3. Type its short commit hash below (fail-closed)"
  Write-Host ""
  $typed = Read-Host "Production deployment commit hash (expected: $EXPECTED_PAGES_HASH)"
  $typedTrimmed = $typed.Trim().Trim('"', "'")
  if ($typedTrimmed -ne $EXPECTED_PAGES_HASH) {
    throw "Pages deployment hash mismatch: typed '$typedTrimmed', expected '$EXPECTED_PAGES_HASH'. Confirm Pages prod deploy is at $EXPECTED_PAGES_HASH before retry."
  }
  Write-Host "      OK Pages production deployment confirmed at $EXPECTED_PAGES_HASH"
  Write-Host ""

  # [3/7] CRON_SECRET length/shape probe (no value echo)
  Write-Host "[3/7] CRON_SECRET probe (length/shape only, no value echo)..." -ForegroundColor Yellow
  if (-not (Test-Path -LiteralPath '.dev.vars')) {
    throw ".dev.vars not found at repo root."
  }
  $secretLine = (Select-String -Path .dev.vars -Pattern '^CRON_SECRET=' | Select-Object -Last 1).Line
  if (-not $secretLine) {
    throw "CRON_SECRET= line not found in .dev.vars"
  }
  $secretValueLen = $secretLine.Length - 'CRON_SECRET='.Length
  Write-Host "      line length  : $($secretLine.Length)"
  Write-Host "      value length : $secretValueLen"
  Write-Host "      shape OK?    : $($secretLine.StartsWith('CRON_SECRET=') -and $secretValueLen -ge 96)"
  if ($secretValueLen -lt 96) {
    throw "CRON_SECRET value length $secretValueLen < 96. Check .dev.vars."
  }
  $cronSecret = $secretLine.Substring('CRON_SECRET='.Length)
  Write-Host "      OK secret loaded into `$cronSecret (NOT echoed)"
  Write-Host ""

  # [4/7] Generate ids (in-memory; no side effect)
  Write-Host "[4/7] Generate ids..." -ForegroundColor Yellow
  $ts        = (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss')
  $rand      = -join ((1..6) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
  $prefix    = "sacrificial/preview-gate-binding/$ts-$rand/"
  $ruleName  = "preview-gate-binding-$ts-$rand"
  $lifeName  = "preview-gate-binding-$ts-$rand-cleanup"
  $controlKey = "${prefix}control.txt"
  $newKeyRand = -join ((1..3) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
  $newKey     = "${prefix}newkey-$newKeyRand.txt"
  $controlBody = "phase=setup`nprefix=$prefix`nbody=v1`n"
  $diffBody    = "phase=test-overwrite-different`nprefix=$prefix`nbody=v2`n"
  $newBody     = "phase=put-new`nprefix=$prefix`n"
  $fixturePath = "docs/fixtures/preview-gate-binding-canary-$ts.json"
  $endpointUrl = 'https://chiyigo.com/api/admin/cron/r2-preview-gate-binding-canary'

  Write-Host "      ts           : $ts"
  Write-Host "      rand         : $rand"
  Write-Host "      prefix       : $prefix"
  Write-Host "      ruleName     : $ruleName"
  Write-Host "      lifeName     : $lifeName"
  Write-Host "      controlKey   : $controlKey"
  Write-Host "      newKey       : $newKey"
  Write-Host "      fixturePath  : $fixturePath"

  # Validate prefix against endpoint PREFIX_REGEX (endpoint line 66)
  $prefixRegex = '^sacrificial/preview-gate-binding/\d{8}-\d{6}-[0-9a-f]{6}/$'
  if ($prefix -notmatch $prefixRegex) {
    throw "prefix '$prefix' does not match PREFIX_REGEX"
  }
  Write-Host "      OK prefix matches PREFIX_REGEX"

  if (-not $controlKey.StartsWith($prefix)) { throw "controlKey must start with prefix" }
  if (-not $newKey.StartsWith($prefix))     { throw "newKey must start with prefix" }
  Write-Host "      OK keys start with prefix"

  # Pre-compute expected sha256 (matches endpoint sha256HexBytes for $controlBody)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $h = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($controlBody))
  $expectedSha = ($h | ForEach-Object { '{0:x2}' -f $_ }) -join ''
  $sha.Dispose()
  Write-Host "      expectedSha  : $expectedSha"
  Write-Host ""

  # [5/7] Endpoint active probe (no R2 touch) -- codex r1 M3: verify response.code, not just status
  Write-Host "[5/7] Endpoint active probe (no R2 touch; codex r1 M3 code verify)..." -ForegroundColor Yellow

  # Helper: extract status + parsed JSON body from an Invoke-WebRequest error
  # PS 5.1 quirk: Invoke-WebRequest consumes the response stream before throwing,
  # so $_.Exception.Response.GetResponseStream().ReadToEnd() returns empty.
  # The captured body lives in $_.ErrorDetails.Message; fallback to stream for PS 7+.
  function Get-ErrorResponseDetail {
    param([System.Management.Automation.ErrorRecord]$ErrorRecord)
    $detail = @{ status = -1; body = $null; code = $null }
    if (-not $ErrorRecord.Exception.Response) { return $detail }
    $detail.status = [int]$ErrorRecord.Exception.Response.StatusCode

    # PS 5.1 path: ErrorDetails.Message is the captured response body
    if ($ErrorRecord.ErrorDetails -and $ErrorRecord.ErrorDetails.Message) {
      $detail.body = $ErrorRecord.ErrorDetails.Message
    } else {
      # PS 7+ fallback: try reading stream (may also work for raw WebException)
      try {
        $stream = $ErrorRecord.Exception.Response.GetResponseStream()
        if ($stream) {
          $reader = New-Object System.IO.StreamReader($stream)
          $detail.body = $reader.ReadToEnd()
          $reader.Dispose()
          $stream.Dispose()
        }
      } catch { }
    }

    if ($detail.body) {
      try {
        $parsed = $detail.body | ConvertFrom-Json -ErrorAction Stop
        $detail.code = $parsed.code
      } catch { }
    }
    return $detail
  }

  # 5a: bad bearer -> 401 + code === 'UNAUTHORIZED'
  $r401 = @{ status = 200; body = $null; code = $null }
  try {
    Invoke-WebRequest -Uri $endpointUrl -Method POST `
      -Headers @{ Authorization = 'Bearer fake-for-probe' } `
      -ContentType 'application/json' `
      -Body '{"op":"head","prefix":"sacrificial/preview-gate-binding/20991231-235959-aaaaaa/","key":"sacrificial/preview-gate-binding/20991231-235959-aaaaaa/x"}' `
      -ErrorAction Stop -UseBasicParsing | Out-Null
  } catch {
    $r401 = Get-ErrorResponseDetail -ErrorRecord $_
  }
  if ($r401.status -ne 401) {
    throw "expected 401 from bad bearer, got status=$($r401.status) body=$($r401.body)"
  }
  if ($r401.code -ne 'UNAUTHORIZED') {
    throw "expected code=UNAUTHORIZED from bad bearer 401, got code='$($r401.code)' body=$($r401.body)"
  }
  Write-Host "      OK bad bearer -> 401 + code=UNAUTHORIZED"

  # 5b: real bearer + bad prefix -> 400 + code === 'BAD_PREFIX'
  $r400 = @{ status = 200; body = $null; code = $null }
  try {
    Invoke-WebRequest -Uri $endpointUrl -Method POST `
      -Headers @{ Authorization = "Bearer $cronSecret" } `
      -ContentType 'application/json' `
      -Body '{"op":"head","prefix":"not-matching/","key":"not-matching/x"}' `
      -ErrorAction Stop -UseBasicParsing | Out-Null
  } catch {
    $r400 = Get-ErrorResponseDetail -ErrorRecord $_
  }
  if ($r400.status -ne 400) {
    throw "expected 400 from bad prefix, got status=$($r400.status) body=$($r400.body)"
  }
  if ($r400.code -ne 'BAD_PREFIX') {
    throw "expected code=BAD_PREFIX from bad prefix 400, got code='$($r400.code)' body=$($r400.body)"
  }
  Write-Host "      OK real bearer + bad prefix -> 400 + code=BAD_PREFIX"
  Write-Host ""

  # [6/7] Atomic-write helper smoke -- codex r1 L4: GUID-suffix + finally cleanup
  Write-Host "[6/7] Atomic-write helper smoke (GUID-suffixed temp; codex r1 L4)..." -ForegroundColor Yellow
  $smokeId = [Guid]::NewGuid().ToString('N').Substring(0, 8)
  $smokeFinal = Join-Path $env:TEMP "preview-gate-canary-smoke-$smokeId.json"
  $smokeTmp   = "$smokeFinal.tmp"
  $smokeOk = $false
  try {
    $utf8NoBom  = New-Object System.Text.UTF8Encoding($false)
    $smokeBytes = $utf8NoBom.GetBytes('{"smoke":"ok"}' + [Environment]::NewLine)
    $fs = [System.IO.File]::Open($smokeTmp, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    try {
      $fs.Write($smokeBytes, 0, $smokeBytes.Length)
      $fs.Flush($true)
    } finally {
      $fs.Dispose()
    }
    Move-Item -LiteralPath $smokeTmp -Destination $smokeFinal -Force
    $smokeReadBack = Get-Content -LiteralPath $smokeFinal -Raw
    if ($smokeReadBack -notmatch '"smoke":"ok"') {
      throw "atomic-write smoke read-back mismatch (got: $smokeReadBack)"
    }
    $smokeOk = $true
  } finally {
    if (Test-Path -LiteralPath $smokeTmp)   { Remove-Item -LiteralPath $smokeTmp   -Force -ErrorAction SilentlyContinue }
    if (Test-Path -LiteralPath $smokeFinal) { Remove-Item -LiteralPath $smokeFinal -Force -ErrorAction SilentlyContinue }
  }
  if (-not $smokeOk) { throw "atomic-write smoke failed" }
  Write-Host "      OK FileStream.Flush(`$true) + Move-Item -Force atomic-replace work (smokeId=$smokeId)"
  Write-Host ""

  # [7/7] Verify fixture target dir exists
  # r4 fix: PS 5.1 Split-Path -LiteralPath -Parent is AmbiguousParameterSet (separate sets);
  # use [System.IO.Path]::GetDirectoryName which is cmdlet-independent.
  Write-Host "[7/7] Verify fixture target dir..." -ForegroundColor Yellow
  $fixtureDir = [System.IO.Path]::GetDirectoryName($fixturePath)
  if (-not (Test-Path -LiteralPath $fixtureDir)) {
    throw "fixture dir not found: $fixtureDir"
  }
  Write-Host "      OK $fixtureDir exists"
  Write-Host ""

  Write-Host "=== Stage A: ALL CHECKS PASSED ===" -ForegroundColor Green
  Write-Host ""
  Write-Host "Variables prepared for Stage B (KEEP THIS PS SESSION ALIVE):"
  Write-Host "  `$ts             = $ts"
  Write-Host "  `$rand           = $rand"
  Write-Host "  `$prefix         = $prefix"
  Write-Host "  `$ruleName       = $ruleName"
  Write-Host "  `$lifeName       = $lifeName"
  Write-Host "  `$controlKey     = $controlKey"
  Write-Host "  `$newKey         = $newKey"
  Write-Host "  `$expectedSha    = $expectedSha"
  Write-Host "  `$fixturePath    = $fixturePath"
  Write-Host "  `$endpointUrl    = $endpointUrl"
  Write-Host "  `$cronSecret     = (loaded, $secretValueLen chars, NOT echoed)"
  Write-Host ""
  Write-Host "Next steps:" -ForegroundColor Cyan
  Write-Host "  1. Paste the above ids summary to Claude for review."
  Write-Host "  2. Once Claude confirms, run Stage B (24h irreversible lock):"
  Write-Host "       . .\scripts\preview-gate-binding-canary-stage-b.ps1"
  Write-Host ""

} finally {
  $ErrorActionPreference = $origEAP
}
