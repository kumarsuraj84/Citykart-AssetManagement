# Syntax check only; executes nothing.
foreach ($f in 'r1_expand.ps1', 'r2_cutover.ps1', 'r3_verify.ps1') {
  $p = Join-Path 'D:\Citykart_Applications\Citykart_AssetManagement_App\backup\staging-0b8c525' $f
  if (-not (Test-Path $p)) { "$f : not there yet"; continue }
  $errs = $null; $tok = $null
  [void][System.Management.Automation.Language.Parser]::ParseFile($p, [ref]$tok, [ref]$errs)
  if ($errs -and $errs.Count -gt 0) { foreach ($e in $errs) { "$f ERROR line $($e.Extent.StartLineNumber): $($e.Message)" } } else { "$f : parses OK" }
}
