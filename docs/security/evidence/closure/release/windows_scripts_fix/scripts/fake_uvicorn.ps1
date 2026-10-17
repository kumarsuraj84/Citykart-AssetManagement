# A FAKE "CKAM" listener for testing verify_release.ps1's local-process check: a plain TCP listener on 127.0.0.1
# that answers every request with 200 {"status":"ok"}. -Tag only exists so that the process's command line carries
# a uvicorn-like argument line (that is what the check reads with Get-CimInstance Win32_Process). Stops by itself.
param([int]$Port = 3998, [string]$Tag = '', [int]$Seconds = 120)
$l = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
$l.Start()
$deadline = (Get-Date).AddSeconds($Seconds)
$body = [System.Text.Encoding]::ASCII.GetBytes('{"status":"ok"}')
$head = [System.Text.Encoding]::ASCII.GetBytes("HTTP/1.1 200 OK`r`nContent-Type: application/json`r`nContent-Length: $($body.Length)`r`nConnection: close`r`n`r`n")
while ((Get-Date) -lt $deadline) {
    if (-not $l.Pending()) { Start-Sleep -Milliseconds 20; continue }
    $c = $l.AcceptTcpClient()
    try {
        $s = $c.GetStream(); $s.ReadTimeout = 2000
        $buf = New-Object byte[] 65536; $acc = ''
        do { $n = $s.Read($buf, 0, $buf.Length); if ($n -le 0) { break }; $acc += [System.Text.Encoding]::ASCII.GetString($buf, 0, $n) } while ($acc.IndexOf("`r`n`r`n") -lt 0)
        if ($acc -match 'Content-Length: (\d+)') {
            $need = [int]$Matches[1]; $have = $acc.Length - $acc.IndexOf("`r`n`r`n") - 4
            while ($have -lt $need) { $n = $s.Read($buf, 0, $buf.Length); if ($n -le 0) { break }; $have += $n }
        }
        $s.Write($head, 0, $head.Length); $s.Write($body, 0, $body.Length); $s.Flush()
    } catch { } finally { $c.Close() }
}
$l.Stop()
