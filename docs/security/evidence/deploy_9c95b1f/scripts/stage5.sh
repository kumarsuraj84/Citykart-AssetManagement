#!/bin/bash
set -e
SP="C:/Users/User2/AppData/Local/Temp/claude/5245b8d3003443b6/33a6302e-4441-4084-94a5-472d20016684/scratchpad"
R="D:/ANKUR AI PROJECTS/Asset Management/release-packages"
K=~/.ssh/citykart_newservers
H=administrator@10.0.1.98
ST='D:/Citykart_Applications/Citykart_AssetManagement_App/backup/staging-9c95b1f'
ssh -i $K -o BatchMode=yes $H 'powershell -NoProfile -Command "New-Item -ItemType Directory -Force D:\Citykart_Applications\Citykart_AssetManagement_App\backup\staging-9c95b1f | Out-Null; echo staging-ready"'
export MSYS_NO_PATHCONV=1
scp -i $K -o BatchMode=yes "$R/ckam-release-9c95b1f.zip" $H:$ST/ckam-release-9c95b1f.zip
scp -i $K -o BatchMode=yes "$SP/expected_hashes_9c95b1f.txt" $H:$ST/expected_hashes_9c95b1f.txt
scp -i $K -o BatchMode=yes "$R/MANIFEST.9c95b1f.sha256.txt" $H:$ST/MANIFEST.9c95b1f.sha256.txt
scp -i $K -o BatchMode=yes "$SP/deploy5/brand_areas_ro.py" $H:$ST/brand_areas_ro.py
for f in r0_parse r1_expand r2_cutover r3_verify; do scp -i $K -o BatchMode=yes "$SP/deploy5/$f.ps1" $H:$ST/$f.ps1; done
ssh -i $K -o BatchMode=yes $H 'powershell -NoProfile -ExecutionPolicy Bypass -File D:\Citykart_Applications\Citykart_AssetManagement_App\backup\staging-9c95b1f\r0_parse.ps1'
