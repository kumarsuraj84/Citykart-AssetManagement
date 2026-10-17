# CKAM HTTPS Implementation Plan (10.0.1.98)

| | |
|---|---|
| Date | 2026-10-16 (prepared during the security closure programme, WP-D1) |
| Status | **PREPARED, NOT DONE. DO NOT INSTALL ANYTHING.** This is a plan and a decision list for the owner. No proxy, certificate, DNS or firewall change has been made |
| Closes | IF-02 (plain HTTP over the internet), AU-13 (refresh cookie not `Secure`); supports EXT-04 and the EXT-05 internet-forward decision |
| Server | App server **10.0.1.98**, shared with Spinwheel and Citykart Desk. CKAM is one uvicorn process on port **3211** serving the API and the built frontend; there is no nginx or IIS in CKAM's own production today |
| Public name in the docs | `ckam.citykartstores.com` (DNS A record `ckam` -> `182.72.84.10`; router forwards TCP 3211 -> `10.0.1.98:3211`). **Verified in the repository:** `docs/ai/PRODUCTION_INFRASTRUCTURE.md` line 19 and `CKAM_THREAT_MODEL.md` line 49 both use `http://ckam.citykartstores.com:3211/` |
| Sources | `docs/ai/PRODUCTION_INFRASTRUCTURE.md` (layout, the deferred-HTTPS note of 2026-10-08), `CKAM_EXTERNAL_SECURITY_ACTIONS.md` EXT-04/EXT-05, `backend/app/core/config.py`, `backend/app/core/body_limit.py`, `backend/app/observability/middleware.py`, `backend/app/main.py` (security headers) |

## In plain words

Today anyone who signs in to CKAM from outside the office sends their password across the internet in the open.
Anyone on the path (a cafe network, an ISP, a compromised router) can read it. HTTPS puts the traffic in a sealed
envelope. The cleanest way on this Windows server is to put a small **reverse proxy** in front of CKAM: the proxy
holds the certificate, answers on 443 over HTTPS, and passes the request to CKAM on the loopback address
(127.0.0.1:3211) where it is never exposed to the network directly. Nothing in CKAM's own code has to change except
two settings and one CSP detail.

Simple example: the proxy is the building's front desk with a locked door (the certificate). Visitors talk to the
front desk over a secure line; the front desk walks the message to the office inside, which no longer has its own
door to the street.

---

## 1. Reverse-proxy options on Windows

The owner picks one. All four terminate TLS on 443 and forward to `http://127.0.0.1:3211`.

| Option | Pros | Cons | Fit for CKAM |
|---|---|---|---|
| **Caddy for Windows** | Simplest config (a few lines); automatic certificate renewal built in (ACME, incl. DNS-01); runs as a service; sensible secure defaults | A newer tool the team may not know; another binary to patch; renewal needs outbound internet or DNS API | **Recommended.** Least moving parts; renewal is the biggest HTTPS risk and Caddy handles it |
| **IIS + URL Rewrite + ARR** | Already the Windows standard; GUI; integrates with Windows cert store and auto-renew for AD-CS/ACME via win-acme | Heavier; ARR install; more surface area; shared IIS on this box would couple CKAM to the other apps' IIS | Good **only if IIS is already the standard on 10.0.1.98** and the other apps use it |
| **nginx for Windows** | Familiar; CKAM's dev/UAT already uses nginx (`frontend/nginx.conf`), so the header/size rules are known | The Windows build lags and is semi-official; no built-in cert renewal (needs win-acme + a reload task); runs as a console app unless wrapped as a service | Workable; renewal and service-wrapping are manual |
| **Traefik** | Automatic certs; good if the org already runs it | Designed around containers/service discovery; overkill for one static upstream | Not recommended here |

**Recommendation: Caddy for Windows**, run as a Windows service, because automatic renewal removes the single most
common cause of an HTTPS outage (an expired certificate). If the org already standardises on IIS for the other apps
on this box, IIS + ARR + win-acme is the acceptable alternative. **Check `D:\Citykart_Applications\PORTS.md` first**
(the server is shared): confirm 443 is free, and register it there for CKAM before use.

---

## 2. Certificate options

| Option | How proof works with port 3211 | Device impact | Renewal |
|---|---|---|---|
| **Existing `*.citykartstores.com` wildcard** (if CityKart already owns one) | No proof needed; install the cert the company already has | None (public CA) | Whenever the company renews it; copy the new cert to the proxy |
| **Let's Encrypt (public, free) via DNS-01** | HTTP-01 proof needs port 80 reachable from the internet; because the public entry is 3211, use **DNS-01** (a `_acme-challenge.ckam` TXT record) | None (public CA) | Every ~90 days; **automatic only with DNS-API access** for `citykartstores.com`; otherwise a manual TXT record every 90 days (risky — easy to forget) |
| **Paid 1-year public certificate** | Buy for `ckam.citykartstores.com`, install on the proxy | None (public CA) | Yearly, calendared with an alert |
| Internal CA / self-signed | n/a | **Must install the CA on every user device/browser** or they see a warning | per internal CA |

**Recommendation:** use the **existing wildcard if one exists** (simplest, nothing to automate). Otherwise
**Let's Encrypt with DNS-01 and DNS-API access** so Caddy renews automatically. Avoid manual-TXT Let's Encrypt
unless someone owns the 90-day calendar task. Avoid self-signed/internal-CA for an internet-facing app (device
install burden and user warnings). **Decision needed: does CityKart already hold a `*.citykartstores.com`
wildcard, and is DNS-API access available for that zone?**

Protect the private key file: readable only by Administrators and the CKAM service account (EXT-06). Never commit a
key or cert to git.

---

## 3. DNS

- The `ckam` A record -> `182.72.84.10` already exists (per `PRODUCTION_INFRASTRUCTURE.md`). HTTPS needs no change
  to it **if** the proxy listens on the same public IP.
- **LAN users:** today some reach the app by IP (`http://10.0.1.98:3211`). After HTTPS, a certificate is valid for
  the **name**, not the IP, so LAN users must use `https://ckam.citykartstores.com` too. Add an internal DNS record
  (or split-horizon) so `ckam.citykartstores.com` resolves to `10.0.1.98` inside the LAN; otherwise LAN traffic
  hair-pins out to the public IP and back.
- If a DNS-01 certificate is used, a `_acme-challenge.ckam` TXT record is created/updated at renewal (automatic
  with DNS-API).

**Decision needed:** internal DNS record for `ckam.citykartstores.com` -> 10.0.1.98 (or accept hair-pinning)?

---

## 4. Ports, binding and firewall

Target design:

- Proxy listens on **443** (HTTPS) on the public interface, and on **80** only to redirect to 443 (section 5).
- CKAM uvicorn binds to **loopback only**: change the launcher so uvicorn uses `--host 127.0.0.1 --port 3211`
  (today it is reachable on the LAN directly). After this, nothing but the proxy can reach the app.
- **Router forward:** change the internet forward from `TCP 3211 -> 10.0.1.98:3211` to `TCP 443 -> 10.0.1.98:443`
  (and optionally `80 -> 80` for the redirect). This is an EXT-05 item — coordinate with the EXT-05 decision (close
  the forward entirely for a VPN-only model, or keep it only behind HTTPS with a store-IP allow-list).
- **Windows firewall (10.0.1.98):** add an inbound allow for TCP 443 (and 80 if used), scoped like the other apps'
  rules; **remove** the inbound 3211 rule once the proxy is confirmed working (so 3211 is no longer LAN-reachable).
  Change only CKAM's own firewall rules.

**Decision needed:** 443 free on 10.0.1.98 (check `PORTS.md`)? Keep port 80 for redirect, or 443-only?

---

## 5. HTTP -> HTTPS redirect

- If port 80 is kept, the proxy answers 80 with a permanent redirect to `https://ckam.citykartstores.com/...` and
  serves nothing else there.
- The old `http://...:3211` URL stops working once 3211 is no longer forwarded/bound; tell users the new address
  before the switch. Consider a short-lived helper so an old `:3211` request redirects, only if the forward is kept
  during a transition.

---

## 6. CKAM settings to change (small, in the same change)

| Setting (`shared\.env`) | From | To | Why |
|---|---|---|---|
| `COOKIE_SECURE` | `false` | `true` | The refresh cookie then carries `Secure` (AU-13). **Only flip this once HTTPS is actually serving** — a `Secure` cookie is never sent over HTTP, so setting it early signs everyone out every 15 minutes |
| `BASE_URL` | `http://ckam.citykartstores.com:3211` | `https://ckam.citykartstores.com` (or `:443`) | Encoded into the Asset-Detail QR link (`backend/app/reports/export_service.py::_asset_detail_url`). Labels printed from the **Print Labels** screen in its **default "Barcode + QR"** format use the same QR image (`/api/assets/{id}/qr.png`), so they carry the URL too; only the "QR Code" and "Barcode" formats contain just the asset code. Every **Asset-Detail** QR and every default-format label already saved/printed keeps the old address: keep the old `http://…:3211` address redirecting to the new one, or plan a re-label *(updated 2026-10-17, security release, gate rehearsal GT-F02; the earlier text said Print Labels labels were unaffected)*. Change once, at cutover |
| `TRUSTED_PROXIES` | empty | the proxy's address **only** (`127.0.0.1` if the proxy is on the same host, or the proxy's LAN IP) | So the app records the real client IP from `X-Forwarded-For` (section 8). Setting it to anything wider would let a local process forge addresses |

uvicorn stays started with **`--no-proxy-headers`** (EXT-38): the app does its own trusted-proxy check in
`app.observability.middleware.client_ip`; uvicorn must not independently rewrite the address. Confirmed in
`backend/app/observability/middleware.py` (XFF believed only from a `TRUSTED_PROXIES` peer, right-most non-proxy
address taken).

---

## 7. Security headers — avoid duplicates (who sets what)

CKAM already sets the full header set itself in `backend/app/main.py::_security_headers`
(`Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`,
and `Cache-Control: no-store` on `/api/`). **The proxy must NOT add its own copies of any of these** — two CSP
headers is a bug (and the dev/UAT nginx already had this exact duplication issue, N5). Rules:

- **CSP and all the app's security headers: set by the app only.** Configure the proxy to pass them through
  untouched and to add none of its own.
- **HSTS (`Strict-Transport-Security`): set by the proxy only** (the app does not, and must not over plain HTTP) —
  see section 9.
- If the chosen proxy adds a default `Server` banner, hide it (the app and dev nginx use `server_tokens off`
  equivalents).

When the self-hosted-fonts change (FONTS / EXT-11) lands, the two Google hosts drop out of the CSP; that is an app
change, not a proxy change — the proxy still just passes the CSP through.

---

## 8. Proxy trust and client IP (rate-limit consequence)

- The proxy must set `X-Forwarded-For` to the **real client address** and overwrite any client-supplied value
  (never append blindly), because the app takes the right-most non-trusted address.
- Set CKAM `TRUSTED_PROXIES` to the proxy's address **only**. Then `audit_log.ip` and the sign-in rate-limit key
  become the real client IP instead of the proxy's.
- **Rate-limit consequence:** today, with no proxy, the limit keys on the connecting address. Once the proxy
  forwards the real client IP, the per-IP sign-in limit (20/min, `RATE_LIMIT_LOGIN_PER_IP`) applies per real client
  again — good. But a whole store or office behind one NAT address still shares one key (EXT-40): watch
  `RATE_LIMITED` rows for a few weeks after the switch and raise the value only if real users are refused at busy
  times. If the proxy address were ever left out of `TRUSTED_PROXIES`, every request would look like it came from
  the proxy and one busy office could lock everyone out — so getting `TRUSTED_PROXIES` right is part of the test
  plan.

---

## 9. HSTS — staged, only after HTTPS is proven

`Strict-Transport-Security` tells browsers to refuse plain HTTP for this name. Enable it **only after** HTTPS has
been stable for some days, and stage it so a mistake cannot lock the name out:

1. Start with a short max-age, e.g. `max-age=300` (5 minutes), no `includeSubDomains`, no `preload`.
2. After a stable week, raise to `max-age=86400` (1 day).
3. After a stable month, `max-age=31536000` (1 year).
4. Add `includeSubDomains` / `preload` only if the whole `citykartstores.com` zone is HTTPS and the owner intends
   it — **not at first** (it would affect sibling apps on the domain).

Set HSTS **at the proxy**, on HTTPS responses only.

---

## 10. Body-size limits at the proxy (align with the app)

The app enforces (confirmed in `backend/app/core/body_limit.py`): sign-in / password endpoints **64 KB**, general
JSON **5 MB**, multipart uploads **16 MB**; the Excel import reader allows **15 MB**. Set the proxy's maximum
request body to about **17 MB** so it rejects clearly oversized bodies early but never cuts off a legitimate 16 MB
upload before the app's own friendly 413 can answer. (Caddy: `request_body max_size 17MB`; nginx:
`client_max_body_size 17m`.) Do not set it below 16 MB.

---

## 11. Timeouts

- Proxy read/write timeout to the upstream: comfortably above the app's slowest normal response. The ERP copy and
  some exports can take a while, but those are internal/background; user requests are quick. A proxy upstream
  timeout of **60-120 s** is safe; too low would turn a slow report into a 504.
- Keep-alive to the loopback upstream enabled.

---

## 12. Logging

- The proxy's access log records the real client IP and the TLS version; keep it (it complements the app's
  `app.jsonl` access lines and helps the EXT-03 compromise assessment).
- With `TRUSTED_PROXIES` set correctly, the app's own `audit_log.ip` already holds the real client IP, so the two
  logs agree.
- Ship/keep proxy logs under the same retention and off-server copy as the app logs (EXT-21).

---

## 13. Rollback

- Keep the current plain-HTTP setup runnable: the change is reversible by (a) setting `COOKIE_SECURE=false` and
  `BASE_URL` back to the `http://...:3211` value, (b) re-binding uvicorn to the LAN (or re-adding the 3211 firewall
  rule and router forward), and (c) stopping the proxy. Because `COOKIE_SECURE=true` breaks sign-in over HTTP,
  rolling back **must** include flipping it back to `false` and restarting `CKAM-Web`.
- Do the switch in a window; keep the old router forward config exported so it can be restored.
- Certificate/key files: keep the previous working set so a bad renewal can be rolled back.

---

## 14. Test plan (owner-run, after install)

1. `https://ckam.citykartstores.com/` loads; a public TLS checker shows a valid certificate for the name, chain OK,
   **TLS 1.2+ only** (disable TLS 1.0/1.1 at the proxy).
2. `http://ckam.citykartstores.com/` redirects to HTTPS (if port 80 kept) or does not connect (if closed).
3. `http://10.0.1.98:3211` no longer reachable from the LAN (3211 rule removed, uvicorn on loopback).
4. Sign in; confirm the refresh cookie carries `Secure` (browser dev tools) and a session survives a refresh (so
   `COOKIE_SECURE=true` + HTTPS is consistent).
5. Headers: exactly one `Content-Security-Policy` and one of each security header on an app response; one HSTS
   header from the proxy on HTTPS; no duplicates.
6. Client IP: sign in from two different client IPs; `GET /api/admin/logs/audit` shows the two **real** addresses,
   not the proxy's (proves `TRUSTED_PROXIES` is right). A forged `X-Forwarded-For` sent by a client is ignored
   (the proxy overwrites it).
7. Upload a ~15-16 MB document (succeeds) and a >17 MB body (refused at the proxy); a normal sign-in body is fine.
8. QR: print one Asset-Detail QR after the `BASE_URL` change and scan it -> opens `https://...`.
9. Renewal: force or simulate a renewal (Caddy/win-acme) and confirm the new cert is picked up without downtime;
   confirm a calendar alert exists for the expiry if renewal is manual.

---

## 15. Effort / downtime estimate

- **Effort:** roughly half a day to a day for Infra (install + configure the proxy, obtain/install the certificate,
  DNS record, firewall/router change, CKAM 3-setting change, tests). Most of the time is certificate issuance and
  the LAN-DNS/router coordination, not CKAM itself.
- **Downtime:** a few minutes at cutover (bind uvicorn to loopback + restart `CKAM-Web`, switch the router forward).
  Plan a short window and tell users the address changes to `https://ckam.citykartstores.com`.

---

## 16. Decision list for the owner

1. **Proxy:** Caddy (recommended) / IIS+ARR (if IIS is already standard here) / nginx-for-Windows / Traefik.
2. **Certificate:** existing `*.citykartstores.com` wildcard? If not — Let's Encrypt DNS-01 with DNS-API
   (recommended) / manual-TXT Let's Encrypt (needs a 90-day owner) / paid 1-year.
3. **DNS-API access** for `citykartstores.com` available (enables auto-renew)? Yes / No.
4. **Internal DNS** record `ckam.citykartstores.com` -> 10.0.1.98 for LAN users? Yes / accept hair-pinning.
5. **Internet exposure (EXT-05):** close the forward and use VPN for outside users / keep it behind HTTPS with a
   store-IP allow-list / keep it open behind HTTPS.
6. **Port 80** kept for the redirect, or 443-only?
7. **Window** date/time and the user notice about the new HTTPS address.

**DO NOT INSTALL ANYTHING** until the owner has decided the above. This document changes no server.
