# READ-ONLY: lists security-product services and installed programs by name. Changes nothing.
$pat = 'seqrite|quick ?heal|sophos|crowdstrike|sentinel|symantec|norton|trend|mcafee|kaspersky|eset|bitdefender|cylance|carbon ?black|cortex|palo alto|malwarebytes|avast|avg|webroot|fortinet|forti'
"HOST: $env:COMPUTERNAME"
"--- services matching security products (name, state)"
Get-Service | Where-Object { $_.Name -match $pat -or $_.DisplayName -match $pat } | ForEach-Object { "{0} [{1}]" -f $_.DisplayName, $_.Status }
"--- installed programs matching security products"
$keys = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
Get-ItemProperty $keys -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match $pat } | ForEach-Object { "{0} {1}" -f $_.DisplayName, $_.DisplayVersion }
"--- Defender exclusion counts (paths not printed)"
try { $p = Get-MpPreference; "paths={0} processes={1} extensions={2}" -f @($p.ExclusionPath).Count, @($p.ExclusionProcess).Count, @($p.ExclusionExtension).Count } catch { "Get-MpPreference failed: $($_.Exception.Message)" }
"--- done"
