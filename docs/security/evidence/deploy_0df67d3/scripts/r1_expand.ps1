# Release 0df67d3, step 1: verify the zip ON THE SERVER, expand into a NEW release folder, compare every file hash. CKAM keeps running untouched.
$ErrorActionPreference = 'Continue'
$root = 'D:\Citykart_Applications\Citykart_AssetManagement_App'
$ev = 'D:\CKAM_EVIDENCE_20261017_111445\release_0df67d3'
New-Item -ItemType Directory -Force $ev | Out-Null
$stage = "$root\backup\staging-0df67d3"
$zip = "$stage\ckam-release-0df67d3.zip"
$size = (Get-Item $zip).Length
$h = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLowerInvariant()
$wantHash = 'd3eff54db5f3a2b80c2ec27386abfd3eb209b1dcf34193dc4842e5fa0b168879'
"zip size: $size (expected 2167958) -> $($size -eq 2167958)"
"zip sha256: $h"
"zip sha256 matches: $($h -eq $wantHash)"
if ($size -ne 2167958 -or $h -ne $wantHash) { 'STOP: zip differs'; exit 2 }
$rel = "$root\releases\0df67d3"
if (Test-Path $rel) { 'STOP: releases\0df67d3 already exists'; exit 2 }
New-Item -ItemType Directory -Path $rel | Out-Null
Expand-Archive -LiteralPath $zip -DestinationPath $rel
"VERSION: $((Get-Content "$rel\backend\VERSION") -join '')"
$files = Get-ChildItem -LiteralPath $rel -Recurse -File
"file count: $($files.Count) (expected 220)"
"bundle name in index.html: $(Select-String -Path "$rel\frontend-dist\index.html" -Pattern 'index-CT4T5MWh\.js' -Quiet)"
(Get-Content "$rel\RELEASE.json" -Raw | ConvertFrom-Json) | Select-Object release_sha_short, alembic_head, constraints_pins | Format-List
$actual = @{}
foreach ($f in $files) { $actual[$f.FullName.Substring($rel.Length + 1).Replace('\', '/')] = (Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
$expected = @{}
foreach ($line in Get-Content "$stage\expected_hashes_0df67d3.txt") { if ($line -match '^([0-9a-f]{64})  (.+)$') { $expected[$Matches[2]] = $Matches[1] } }
$bad = @(); foreach ($k in $expected.Keys) { if ($actual[$k] -ne $expected[$k]) { $bad += $k } }
$extra = @($actual.Keys | Where-Object { -not $expected.ContainsKey($_) })
"expected entries: $($expected.Count); on disk: $($actual.Count); hash mismatches: $($bad.Count); files not in manifest: $($extra.Count)"
if ($bad.Count -gt 0) { $bad | Select-Object -First 10 | ForEach-Object { "  MISMATCH $_" } }
$actual.GetEnumerator() | Sort-Object Name | ForEach-Object { '{0}  {1}' -f $_.Value, $_.Name } | Set-Content -LiteralPath "$ev\release_0df67d3_filehashes.txt" -Encoding ASCII
if ($bad.Count -gt 0 -or $extra.Count -gt 0 -or $files.Count -ne 220) { 'STOP: expanded folder is not the released package'; exit 2 }
'EXPAND_OK: every file equals the manifest'
"live release still serving: " + (& curl.exe -s --max-time 5 http://127.0.0.1:3211/api/health)
