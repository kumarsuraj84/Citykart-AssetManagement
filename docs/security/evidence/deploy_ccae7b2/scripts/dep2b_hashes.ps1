# Read-only: per-file SHA-256 list of the expanded release folder, written into the evidence folder.
$rel = 'D:\Citykart_Applications\Citykart_AssetManagement_App\releases\ccae7b2'
$out = 'D:\CKAM_EVIDENCE_20261017_111445\release_ccae7b2_filehashes.txt'
Get-ChildItem -LiteralPath $rel -Recurse -File | ForEach-Object {
  '{0}  {1}' -f (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant(), $_.FullName.Substring($rel.Length + 1).Replace('\','/')
} | Set-Content -LiteralPath $out -Encoding ASCII
"written: $out lines: $((Get-Content $out | Measure-Object -Line).Lines)"
