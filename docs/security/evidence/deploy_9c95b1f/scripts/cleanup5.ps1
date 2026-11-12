$ErrorActionPreference = 'Continue'
$ev = 'D:\CKAM_EVIDENCE_20261017_111445\release_9c95b1f'
$st = 'D:\Citykart_Applications\Citykart_AssetManagement_App\backup\staging-9c95b1f'
if (Test-Path "$ev\env.before-9c95b1f") { Remove-Item -LiteralPath "$ev\env.before-9c95b1f" -Force; "deleted env.before-9c95b1f" }
"env copy still there: $(Test-Path "$ev\env.before-9c95b1f")"
foreach ($f in 'r0_parse.ps1','r1_expand.ps1','r2_cutover.ps1','r3_verify.ps1','brand_areas_ro.py') { if (Test-Path "$st\$f") { Remove-Item -LiteralPath "$st\$f" -Force } }
"staging now: $((Get-ChildItem $st | Select-Object -ExpandProperty Name) -join ', ')"
"POST /api/assets/batch unauthenticated -> $(& curl.exe -s -o NUL -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{}' http://127.0.0.1:3211/api/assets/batch)  (401 expected)"
"health: $(& curl.exe -s --max-time 5 http://127.0.0.1:3211/api/health)"
Remove-Item -LiteralPath $PSCommandPath -Force
