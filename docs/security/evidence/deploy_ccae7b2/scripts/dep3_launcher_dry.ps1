# Dry run of the NEW launcher template with -WhatIf (maps nothing, starts nothing). CKAM keeps running.
$ErrorActionPreference = 'Continue'
$root = 'D:\Citykart_Applications\Citykart_AssetManagement_App'
$rel = "$root\releases\ccae7b2"
$test = "$root\precheck\run_ckam_web.test.ps1"
Copy-Item "$rel\ops\windows\run_ckam_web.ps1.template" $test -Force
$errs = $null; $tok = $null
[void][System.Management.Automation.Language.Parser]::ParseFile($test, [ref]$tok, [ref]$errs)
"parse errors: $(@($errs).Count)"
"--- -WhatIf run, log redirected to a scratch folder ---"
& powershell -NoProfile -ExecutionPolicy Bypass -File $test -WhatIf -LogDir "$root\precheck\launcher_dry_logs" 2>&1 | ForEach-Object { "$_" }
"exit code: $LASTEXITCODE"
"CKAM still serving: " + (& curl.exe -s http://127.0.0.1:3211/api/health)
