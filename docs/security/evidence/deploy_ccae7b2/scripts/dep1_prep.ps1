# Step D5/C9 prep. Changes: locks ACL of the NEW evidence folder, copies files INTO it, creates staging folder. No CKAM runtime change.
$ErrorActionPreference = 'Continue'
$root = 'D:\Citykart_Applications\Citykart_AssetManagement_App'
$ev = 'D:\CKAM_EVIDENCE_20261017_111445'
icacls $ev /inheritance:r /grant:r 'Administrators:(OI)(CI)F' 'SYSTEM:(OI)(CI)F' | Out-Null
"evidence ACL exit: $LASTEXITCODE"
icacls $ev | Select-Object -First 4
Copy-Item "$root\shared\.env" "$ev\env.pre-ccae7b2"
(Get-FileHash "$root\shared\.env" -Algorithm SHA256).Hash | Out-File "$ev\env.pre-ccae7b2.sha256.txt"
Copy-Item "$root\shared\run_ckam_web.ps1" "$ev\run_ckam_web.live-before.ps1"
$st = "$root\backup\staging-ccae7b2"
New-Item -ItemType Directory -Force $st | Out-Null
icacls $st /inheritance:r /grant:r 'Administrators:(OI)(CI)F' 'SYSTEM:(OI)(CI)F' | Out-Null
"staging: $st exists=$(Test-Path $st)"
"evidence files now: $((Get-ChildItem $ev -Recurse -File | Measure-Object).Count)"
"--- LIVE LAUNCHER (contains no secret per precheck) ---"
Get-Content "$root\shared\run_ckam_web.ps1"
