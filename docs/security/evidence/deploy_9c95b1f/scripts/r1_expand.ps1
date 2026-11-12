# Release 9c95b1f, step 1: verify the zip ON THE SERVER, expand into a NEW release folder, compare every file hash. CKAM keeps running untouched.
$ErrorActionPreference = 'Continue'
$root = 'D:\Citykart_Applications\Citykart_AssetManagement_App'
$ev = 'D:\CKAM_EVIDENCE_20261017_111445\release_9c95b1f'
New-Item -ItemType Directory -Force $ev | Out-Null
$stage = "$root\backup\staging-9c95b1f"
$zip = "$stage\ckam-release-9c95b1f.zip"
$size = (Get-Item $zip).Length
$h = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLowerInvariant()
$wantHash = 'a200dbabe7004e89ee0b6b09d149fa3385a45634cd36fdc9ff6d1ff8234fe7c4'
"zip size: $size (expected 2193192) -> $($size -eq 2193192)"
"zip sha256: $h"
"zip sha256 matches: $($h -eq $wantHash)"
if ($size -ne 2193192 -or $h -ne $wantHash) { 'STOP: zip differs'; exit 2 }
$rel = "$root\releases\9c95b1f"
if (Test-Path $rel) { 'STOP: releases\9c95b1f already exists'; exit 2 }
New-Item -ItemType Directory -Path $rel | Out-Null
Expand-Archive -LiteralPath $zip -DestinationPath $rel
"VERSION: $((Get-Content "$rel\backend\VERSION") -join '')"
$files = Get-ChildItem -LiteralPath $rel -Recurse -File
"file count: $($files.Count) (expected 227)"
"bundle name in index.html: $(Select-String -Path "$rel\frontend-dist\index.html" -Pattern 'index-D1eiexF1\.js' -Quiet)"
(Get-Content "$rel\RELEASE.json" -Raw | ConvertFrom-Json) | Select-Object release_sha_short, alembic_head, constraints_pins | Format-List
$actual = @{}
foreach ($f in $files) { $actual[$f.FullName.Substring($rel.Length + 1).Replace('\', '/')] = (Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
$expected = @{}
foreach ($line in Get-Content "$stage\expected_hashes_9c95b1f.txt") { if ($line -match '^([0-9a-f]{64})  (.+)$') { $expected[$Matches[2]] = $Matches[1] } }
$bad = @(); foreach ($k in $expected.Keys) { if ($actual[$k] -ne $expected[$k]) { $bad += $k } }
$extra = @($actual.Keys | Where-Object { -not $expected.ContainsKey($_) })
"expected entries: $($expected.Count); on disk: $($actual.Count); hash mismatches: $($bad.Count); files not in manifest: $($extra.Count)"
if ($bad.Count -gt 0) { $bad | Select-Object -First 10 | ForEach-Object { "  MISMATCH $_" } }
$actual.GetEnumerator() | Sort-Object Name | ForEach-Object { '{0}  {1}' -f $_.Value, $_.Name } | Set-Content -LiteralPath "$ev\release_9c95b1f_filehashes.txt" -Encoding ASCII
if ($bad.Count -gt 0 -or $extra.Count -gt 0 -or $files.Count -ne 227) { 'STOP: expanded folder is not the released package'; exit 2 }
'EXPAND_OK: every file equals the manifest'
"live release still serving: " + (& curl.exe -s --max-time 5 http://127.0.0.1:3211/api/health)
