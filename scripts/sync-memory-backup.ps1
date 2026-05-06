#Requires -Version 5.1
# Manual sync of Claude Code memory store to private backup repo.
# Run from chiyigo.com root:  pwsh scripts/sync-memory-backup.ps1
#
# Scope: chiyigo.com project memory only.
# Backup repo: https://github.com/a30100a0072-bit/claude-memory-backup
# This script is read-only against the chiyigo.com repo. It only commits/pushes
# the memory dir, which has its own .git. No automation/hook — run by hand.

$ErrorActionPreference = 'Stop'

$MemoryDir = 'C:\Users\User\.claude\projects\C--Users-User-Desktop-chiyigo-com\memory'
$Remote    = 'https://github.com/a30100a0072-bit/claude-memory-backup.git'

if (-not (Test-Path $MemoryDir)) {
  Write-Error "Memory dir not found: $MemoryDir"
  exit 1
}
if (-not (Test-Path (Join-Path $MemoryDir '.git'))) {
  Write-Error "Memory dir is not a git repo. Run initial setup first."
  exit 1
}

Push-Location $MemoryDir
try {
  $actualRemote = (git remote get-url origin 2>$null)
  if ($actualRemote -ne $Remote) {
    Write-Error "Remote mismatch. Expected $Remote, got $actualRemote"
    exit 1
  }

  $status = git status --porcelain
  if (-not $status) {
    Write-Host '[sync] no changes — nothing to commit' -ForegroundColor DarkGray
    exit 0
  }

  Write-Host '[sync] changes detected:' -ForegroundColor Cyan
  Write-Host $status

  git add -A
  $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm'
  git commit -m "chore: memory snapshot $stamp"
  git push origin main

  Write-Host '[sync] pushed to backup repo' -ForegroundColor Green
}
finally {
  Pop-Location
}
