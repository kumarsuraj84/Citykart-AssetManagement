# Release 0b8c525, step E: verify the zip ON THE SERVER, expand into a NEW release folder, hash every file. CKAM keeps running untouched.
$ErrorActionPreference = 'Continue'
$root = 'D:\Citykart_Applications\Citykart_AssetManagement_App'
$ev = 'D:\CKAM_EVIDENCE_20261017_111445\release_0b8c525'
New-Item -ItemType Directory -Force $ev | Out-Null
$zip = "$root\backup\staging-0b8c525\ckam-release-0b8c525.zip"
$size = (Get-Item $zip).Length
$h = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLowerInvariant()
$wantHash = '11f2262e103e0219453e10cf46011a20ec573226a62de97c8fb9ab8527d2022c'
"zip size: $size (expected 2152169) -> $($size -eq 2152169)"
"zip sha256: $h"
"zip sha256 matches: $($h -eq $wantHash)"
if ($size -ne 2152169 -or $h -ne $wantHash) { 'STOP: zip differs'; exit 2 }
$rel = "$root\releases\0b8c525"
if (Test-Path $rel) { 'STOP: releases\0b8c525 already exists'; exit 2 }
New-Item -ItemType Directory -Path $rel | Out-Null
Expand-Archive -LiteralPath $zip -DestinationPath $rel
"VERSION: $((Get-Content "$rel\backend\VERSION") -join '')"
"file count: $((Get-ChildItem $rel -Recurse -File | Measure-Object).Count) (expected 215)"
"bundle name in index.html: $(Select-String -Path "$rel\frontend-dist\index.html" -Pattern 'index-BJmT-4C3\.js' -Quiet)"
(Get-Content "$rel\RELEASE.json" -Raw | ConvertFrom-Json) | Select-Object release_sha_short, alembic_head, constraints_pins | Format-List
Get-ChildItem -LiteralPath $rel -Recurse -File | ForEach-Object {
  '{0}  {1}' -f (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant(), $_.FullName.Substring($rel.Length + 1).Replace('\','/')
} | Set-Content -LiteralPath "$ev\release_0b8c525_filehashes.txt" -Encoding ASCII
"hash list written: $((Get-Content "$ev\release_0b8c525_filehashes.txt" | Measure-Object -Line).Lines) lines"
"live release still serving: " + (& curl.exe -s --max-time 5 http://127.0.0.1:3211/api/health)
