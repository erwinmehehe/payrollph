param(
  [string]$PackageDirectory = (Split-Path -Parent $MyInvocation.MyCommand.Path)
)
$ErrorActionPreference = 'Stop'
$manifestPath = Join-Path $PackageDirectory 'VALIDATION-MANIFEST.json'
if (-not (Test-Path -LiteralPath $manifestPath)) {
  throw 'Missing VALIDATION-MANIFEST.json. Use the complete original artifact.'
}
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifest.status -notlike 'SYNTHETIC ONLY*') {
  throw 'This script accepts only the synthetic QA handoff.'
}
if ($manifest.moduleResult -ne 'not run' -or $manifest.submittedToBir -ne $false) {
  throw 'The source manifest was changed; retain the original artifact.'
}
$relative = [string]$manifest.primaryFile
if ([string]::IsNullOrWhiteSpace($relative) -or
    [IO.Path]::IsPathRooted($relative) -or $relative.Contains('..')) {
  throw 'Unsafe or missing primary DAT path.'
}
$datPath = Join-Path $PackageDirectory $relative
if (-not (Test-Path -LiteralPath $datPath -PathType Leaf)) {
  throw 'The exact source DAT is missing from the handoff package.'
}
$expected = ([string]$manifest.sha256).ToLowerInvariant()
$actual = (Get-FileHash -LiteralPath $datPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($expected -ne $actual) {
  throw "DAT SHA-256 MISMATCH. STOP. Expected $expected but got $actual."
}
Write-Output 'PASS: exact synthetic DAT file SHA-256 matches the audited browser output.'
Write-Output ("Source: " + $datPath)
Write-Output ("SHA-256: " + $actual)
Write-Output 'BIR OFFICIAL MODULE STATUS: NOT RUN. This PowerShell script does NOT validate tax fields or file anything.'
