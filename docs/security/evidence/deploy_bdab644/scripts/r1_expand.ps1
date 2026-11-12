# Release bdab644, step 1: verify the zip ON THE SERVER, expand into a NEW release folder, compare every file hash. CKAM keeps running untouched.
$ErrorActionPreference = 'Continue'
$root = 'D:\Citykart_Applications\Citykart_AssetManagement_App'
$ev = 'D:\CKAM_EVIDENCE_20261017_111445\release_bdab644'
New-Item -ItemType Directory -Force $ev | Out-Null
$stage = "$root\backup\staging-bdab644"
$zip = "$stage\ckam-release-bdab644.zip"
$size = (Get-Item $zip).Length
$h = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLowerInvariant()
$wantHash = '52035d9191e6a8a787a99bd2cdf89af9df6f65821189a7e3dfab4540745fc993'
"zip size: $size (expected 2180120) -> $($size -eq 2180120)"
"zip sha256: $h"
"zip sha256 matches: $($h -eq $wantHash)"
if ($size -ne 2180120 -or $h -ne $wantHash) { 'STOP: zip differs'; exit 2 }
$rel = "$root\releases\bdab644"
if (Test-Path $rel) { 'STOP: releases\bdab644 already exists'; exit 2 }
New-Item -ItemType Directory -Path $rel | Out-Null
Expand-Archive -LiteralPath $zip -DestinationPath $rel
"VERSION: $((Get-Content "$rel\backend\VERSION") -join '')"
$files = Get-ChildItem -LiteralPath $rel -Recurse -File
"file count: $($files.Count) (expected 224)"
"bundle name in index.html: $(Select-String -Path "$rel\frontend-dist\index.html" -Pattern 'index-CrA4RAh9\.js' -Quiet)"
(Get-Content "$rel\RELEASE.json" -Raw | ConvertFrom-Json) | Select-Object release_sha_short, alembic_head, constraints_pins | Format-List
$actual = @{}
foreach ($f in $files) { $actual[$f.FullName.Substring($rel.Length + 1).Replace('\', '/')] = (Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
$expected = @{}
foreach ($line in Get-Content "$stage\expected_hashes_bdab644.txt") { if ($line -match '^([0-9a-f]{64})  (.+)$') { $expected[$Matches[2]] = $Matches[1] } }
$bad = @(); foreach ($k in $expected.Keys) { if ($actual[$k] -ne $expected[$k]) { $bad += $k } }
$extra = @($actual.Keys | Where-Object { -not $expected.ContainsKey($_) })
"expected entries: $($expected.Count); on disk: $($actual.Count); hash mismatches: $($bad.Count); files not in manifest: $($extra.Count)"
if ($bad.Count -gt 0) { $bad | Select-Object -First 10 | ForEach-Object { "  MISMATCH $_" } }
$actual.GetEnumerator() | Sort-Object Name | ForEach-Object { '{0}  {1}' -f $_.Value, $_.Name } | Set-Content -LiteralPath "$ev\release_bdab644_filehashes.txt" -Encoding ASCII
if ($bad.Count -gt 0 -or $extra.Count -gt 0 -or $files.Count -ne 224) { 'STOP: expanded folder is not the released package'; exit 2 }
'EXPAND_OK: every file equals the manifest'
"live release still serving: " + (& curl.exe -s --max-time 5 http://127.0.0.1:3211/api/health)
