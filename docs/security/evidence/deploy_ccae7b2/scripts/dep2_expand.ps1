# Step C8 + E: verify zip on the server, expand into a NEW release folder, verify contents. CKAM keeps running untouched.
$ErrorActionPreference = 'Continue'
$root = 'D:\Citykart_Applications\Citykart_AssetManagement_App'
$ev = 'D:\CKAM_EVIDENCE_20261017_111445'
$zip = "$root\backup\staging-ccae7b2\ckam-security-release-ccae7b2.zip"
$size = (Get-Item $zip).Length
$h = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLowerInvariant()
"zip size: $size (expected 2152224) -> $($size -eq 2152224)"
"zip sha256: $h"
"zip sha256 matches: $($h -eq 'b975c38d1f37387dbd8e15739ea2c27f563549e66bc80eac21878ea6327137e3')"
if ($size -ne 2152224 -or $h -ne 'b975c38d1f37387dbd8e15739ea2c27f563549e66bc80eac21878ea6327137e3') { 'STOP: zip differs'; exit 2 }
$rel = "$root\releases\ccae7b2"
if (Test-Path $rel) { 'STOP: releases\ccae7b2 already exists'; exit 2 }
New-Item -ItemType Directory -Path $rel | Out-Null
Expand-Archive -LiteralPath $zip -DestinationPath $rel
"VERSION: $((Get-Content "$rel\backend\VERSION") -join '')"
"index.html exists: $(Test-Path "$rel\frontend-dist\index.html")"
"constraints exists: $(Test-Path "$rel\backend\constraints.txt")"
"file count: $((Get-ChildItem $rel -Recurse -File | Measure-Object).Count) (expected 215)"
"bundle name in index.html: $(Select-String -Path "$rel\frontend-dist\index.html" -Pattern 'index-Cp5JgQR-\.js' -Quiet)"
(Get-Content "$rel\RELEASE.json" -Raw | ConvertFrom-Json) | Select-Object release_sha_short, alembic_head, constraints_pins | Format-List
# content hash
$items = @(Get-ChildItem -LiteralPath $rel -Recurse -File | ForEach-Object {
  [pscustomobject]@{ P = $_.FullName.Substring($rel.Length + 1).Replace('\','/'); F = $_.FullName } })
$keys = [string[]]($items | ForEach-Object { $_.P }); $arr = [object[]]$items
[Array]::Sort($keys, $arr, [StringComparer]::Ordinal)
$text = (($arr | ForEach-Object { '{0}  {1}' -f (Get-FileHash -LiteralPath $_.F -Algorithm SHA256).Hash.ToLowerInvariant(), $_.P }) -join "`n") + "`n"
$sha = [Security.Cryptography.SHA256]::Create()
$ch = -join ($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($text)) | ForEach-Object { $_.ToString('x2') })
"content hash: $ch"
"content hash matches: $($ch -eq 'e2408eab01bf6c7d1ac4145b8fbd415010be590cc6d9519c2aabe2fb52f5848b')  files: $($arr.Count)"
"--- launcher differences: live (<=) vs template (=>) ---"
Compare-Object (Get-Content "$root\shared\run_ckam_web.ps1") (Get-Content "$rel\ops\windows\run_ckam_web.ps1.template") | Format-Table -AutoSize | Out-String -Width 250
"--- release.json / ops folder"
Get-ChildItem "$rel\ops\windows" | Select-Object Name, Length | Format-Table -AutoSize | Out-String
