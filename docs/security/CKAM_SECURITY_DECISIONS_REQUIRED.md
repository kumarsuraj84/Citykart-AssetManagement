# CKAM Security Decisions Required (management)

| | |
|---|---|
| System | CKAM (CityKart Asset Manager) |
| Date | 2026-10-16 |
| Written by | Security closure programme, work package WP-D2 (documents only) |
| Code state read | HEAD `627ed73` (security docs) on top of `a3e8fce`; production still runs `3b5e842` (nothing pushed or deployed) |
| Inputs | `CKAM_SECURITY_CLOSURE_REGISTER.md` §6, `CKAM_EXTERNAL_SECURITY_ACTIONS.md`, `CKAM_ISO27001_READINESS.md`, `CKAM_SOC2_READINESS.md`, `docs/ai/DECISIONS.md`, `docs/ai/PRODUCTION_INFRASTRUCTURE.md`, `docs/ai/CKAM_FINAL_OPERATING_MODEL.md`, current source (`backend/app/auth/router.py`, `backend/app/core/config.py`, `backend/app/auth/password_policy.py`, `backend/app/asset_users/router.py`) |
| Status | **Every entry is OPEN. Nothing in this file is decided.** The writer only lays out options and a recommendation |

> **This file decides nothing.** Each decision belongs to the owner / management. When one is taken, record it in
> `docs/ai/DECISIONS.md` (date, choice, why) and update the matching row of `CKAM_SECURITY_CLOSURE_REGISTER.md`.
> Only then may anything be built. Deploying anything still needs its own explicit request (`CLAUDE.md`), and the
> owner types every server, database and NAS password himself.

## In plain words

There are 16 choices only you (or management) can make. Some are urgent because the live server is exposed today
(SD-01, SD-04). Others only matter later (for example SD-16 decides whether ISO 27001 or SOC 2 is a goal at all, which
changes how long logs must be kept in SD-15). Each entry says what happens today, what can go wrong, two or three
options with a plain example, what we recommend, and what it changes for users.

How to answer: reply with the entry number and the letter, for example **"SD-06: A"**. If an entry is not clear,
say so and it will be re-explained with your own example.

## Summary

| ID | Decision | Linked items | Urgency | Recommended | Suggested deadline |
|---|---|---|---|---|---|
| SD-01 | Deploy the security release, then change the server secrets | IF-01, EXT-01/02/03/38/39 | **URGENT** | A (deploy now) | Request by 2026-10-23 |
| SD-02 | Full Admin company scope (D6) | D6, EXT-26, R-04 | 30 days | B (limit to chosen companies) | 2026-11-15, and before CKVPL goes live in production |
| SD-03 | Multi-factor sign-in (MFA) | MFA, EXT-19, R-04, R-05 | 90 days | B (head-office admin + Full Admins first) | 2027-01-14 (sooner if SD-04 keeps the internet open) |
| SD-04 | Internet exposure of port 3211 / VPN | IF-02, EXT-05, R-18 | **URGENT** | A (close the forward; VPN) if stores have VPN, else B | Decide by 2026-10-23, done by 2026-11-15 |
| SD-05 | When to add HTTPS (deferred on 2026-10-08) | IF-02, AU-13, EXT-04, R-01 | 30 days | A (now, after SD-01) | Certificate choice by 2026-10-30, live by 2026-11-15 |
| SD-06 | Lock-out after wrong passwords | AU-04 (AU-02 depends on it), R-21 | 30 days | C (hybrid) | 2026-11-15 |
| SD-07 | Shared store logins | EXT-30, N7, AU-06 design, R-30 | 90 days | A (one login, store manager only) | Before store passwords are issued in bulk; at the latest 2027-01-14 |
| SD-08 | Sign-in limit per internet address (many staff behind one address) | AU-03, EXT-40, R-33 | 30 days after deploy | A (keep 20/min and watch) | 30 days after SD-01 |
| SD-09 | How long `audit_log` is kept vs personal-data law | IF-06, EXT-31, R-11, R-31 | 90 days | B (retention set after legal review) | Legal review started by 2026-11-15; decision by 2027-01-14 |
| SD-10 | Independent external VAPT (budget, supplier) | EXT-14, A.5.35 | 90 days | A (after deploy and infrastructure fixes) | Quotes by 2026-12-15; test by 2027-01-31 |
| SD-11 | Separate production database roles (date and names) | IF-05, IF-06, EXT-07, R-12 | 30 days after SD-01 | B (keep `ckassetapp` as the runtime role, add two new roles) | Window chosen by 2026-11-15 |
| SD-12 | Same-name vendors / brands in the Excel master import | OBS-NAME-IMPORT, RACE-1 | Not urgent | A (refuse, as the single-create screen does) | 2027-01-14 |
| SD-13 | Password expiry and rotation | AU-08, A.5.17, CC6 | 90 days | A (no calendar expiry; change on events) | 2027-01-14 |
| SD-14 | How long a sign-in lasts (session lifetime) | AU-05, AU-06, R-19 | 90 days | B (absolute daily limit, shorter for admins) | 2027-01-14 |
| SD-15 | Log retention vs a 12-month SOC 2 observation period | EXT-21, CC7, R-27 | Only if SD-16 says SOC 2 | C (raise retention and export monthly) | With SD-16 |
| SD-16 | Is ISO 27001 / SOC 2 a goal; who is the ISMS Lead; approve the DRAFT policy pack | EXT-15/16/17/36 | 90 days | B (adopt the policies, decide certification later) | 2027-01-14 |

---

## SD-01 Deploy the security release, then change the server secrets

| | |
|---|---|
| **Decision** | Ask for the security release to be deployed to production now, followed at once by changing every server secret |
| **Current behaviour** | Production (10.0.1.98, release `3b5e842`) still has IF-01: anyone who can reach port 3211 can read any file on the server, including `shared\.env` (database password, the key that signs every sign-in) and `shared\nas.pw`. The fix (`3e134c1`) and all other fixes are local commits on the dev PC only. The port is forwarded from the internet |
| **Security risk** | CRITICAL (R-02, R-03, R-18). With the signing key an outsider can make a valid head-office-admin session without any password and without a LOGIN row in the audit trail |
| **Option A** | Deploy now, following EXT-39 (settings checked, `alembic upgrade head` before start) → EXT-01 → EXT-38 (`--no-proxy-headers`) → EXT-02 (new JWT secret, `ckassetapp`, NAS and ERP passwords) → EXT-03 (look for signs of past use). Example: like changing the shop's locks the same evening the broken window is repaired |
| **Option B** | Wait for the rest of the closure programme and deploy everything together. Example: leaving the window open until the whole shop is renovated |
| **Recommendation** | **A.** Every other improvement is worth little while IF-01 is open. Close or narrow the internet forward (SD-04) while the deploy is prepared |
| **Impact on users / operations** | About a minute of downtime (the 2026-10-14 deploy took ~30 s); everyone signs in again after the new signing key; new code refuses to start if `JWT_SECRET` is weak or the two new migrations were not run (EXT-39 checks this first) |
| **What you must decide** | (1) Say the deploy request in your own words; (2) a time slot; (3) that you will type the superuser / NAS / ERP passwords on the servers |
| **Deadline suggestion** | Request by **2026-10-23** |

## SD-02 Full Admin company scope (D6)

| | |
|---|---|
| **Decision** | Should an ordinary Full Admin work only in the companies chosen for them (CKSPL, CKVPL or both), instead of every company? |
| **Current behaviour** | A Full Admin (role `ADMIN`) sees and acts in **every** company (retest `retest_access.md`, AC-2 row). Can Add & Move Assets and View Only logins are already limited to their own company plus the companies ticked under **Company access**. Production holds one company today (`CKS`); CKVPL is still to be set up. Open since 2026-10-14 (`docs/ai/DECISIONS.md` (1), `CKAM_FINAL_OPERATING_MODEL.md` §13) |
| **Security risk** | Least privilege (R-04, High). Example: a CKVPL IT admin could move CKSPL laptops, read CKSPL vendor contacts and PO values, and issue passwords to CKSPL store logins. A stolen Full Admin password exposes both companies |
| **Option A** | Keep today's rule: a Full Admin works everywhere. Simple; nobody has to tick companies |
| **Option B** | Limit a Full Admin to their own company plus the companies ticked under **Company access** (the same tick-box operators already use). The head-office admin is not affected. A Full Admin who really works for both companies gets both ticked |
| **Recommendation** | **B**, decided before CKVPL goes live in production, so nobody loses access they already use. The product can build it with the existing company-access list (no new screen); it needs cross-company tests for every Full Admin route |
| **Impact on users / operations** | The head-office admin must tick the companies of each Full Admin once; a Full Admin who forgot a tick sees "not in your companies" until it is fixed. Home figures, lists and exports of a Full Admin shrink to their companies |
| **What you must decide** | A or B. If B: should a limited Full Admin be allowed to grant others access to companies they themselves do not have? (Recommended: no, the same rule as work areas) |
| **Deadline suggestion** | **2026-11-15**, and in any case before CKVPL is set up in production |

## SD-03 Multi-factor sign-in (MFA)

| | |
|---|---|
| **Decision** | Should some or all CKAM logins need a second step (a 6-digit code from a phone app) besides the password? |
| **Current behaviour** | Password only. Passwords are stored safely (Argon2id), must pass a policy when chosen, and wrong guesses are slowed (rate limit) and lead to a 15-minute lock. There is no second factor anywhere |
| **Security risk** | A password seen over someone's shoulder, reused from another site, or read off plain-HTTP traffic (SD-05) is enough to act as that person. Worst case: the head-office admin account (R-04, R-05) |
| **Option A** | No MFA. Keep head-office-admin and Full Admin work on the office LAN / VPN only (depends on SD-04). Example: the safe key is kept inside the building |
| **Option B** | Authenticator-app code (TOTP, e.g. Google or Microsoft Authenticator) for the **head-office admin and Full Admins first**; later others if wanted. Recovery: the head-office admin can reset another person's MFA (audited); the head-office admin's own recovery codes are kept sealed in the company password manager (EXT-23) |
| **Option C** | MFA for every staff login (Full Admin, Can Add & Move Assets, View Only); store and Own Assets Only logins stay password-only |
| **Recommendation** | **B**, built after HTTPS (SD-05), because a code typed over plain HTTP can be read too. The product can implement TOTP (new table/columns → Alembic migration, enrolment screen, sign-in step, reset by head-office admin). Store logins are shared phones/PCs, so MFA there is not practical (see SD-07) |
| **Impact on users / operations** | Admins need a smartphone app; one extra step at each sign-in (a sign-in lasts up to 8 idle hours today, see SD-14); a lost phone needs a reset by the head-office admin; one more thing to support |
| **What you must decide** | A, B or C; and who may reset MFA for others |
| **Deadline suggestion** | **2027-01-14** (EXT-19). Sooner if SD-04 keeps CKAM reachable from the internet |

## SD-04 Internet exposure of port 3211 / VPN

| | |
|---|---|
| **Decision** | Who really needs to reach CKAM from outside the CityKart network, and how? |
| **Current behaviour** | The router forwards TCP 3211 from the public address of `ckam.citykartstores.com` to `10.0.1.98:3211`; the site is plain HTTP (`PRODUCTION_INFRASTRUCTURE.md` lines 19 and 23). Anyone on the internet can reach the sign-in page and, until SD-01 is done, the IF-01 hole. Not known to this writer: whether stores connect over the internet, over an MPLS link or over a VPN |
| **Security risk** | R-18 (Critical today): internet-wide scanning, password guessing, and every server weakness exposed to the world |
| **Option A** | Remove the router forward. Staff and stores outside the LAN use the corporate VPN. Example: the shop door opens only for people with a key card |
| **Option B** | Keep the forward, but only behind HTTPS (SD-05), with the router or a firewall allowing only the stores' fixed public addresses (allow-list), and head-office-admin work kept to the LAN / VPN |
| **Option C** | Keep it as today (open to the whole internet, plain HTTP). Not recommended |
| **Recommendation** | **A** if stores already have VPN or MPLS; otherwise **B**. Whatever the final choice: **close the forward now until SD-01 is deployed**, unless stores cannot work without it |
| **Impact on users / operations** | A: users outside the office need VPN; the QR on the Asset 360 page (it links to the public address) only opens inside the network or VPN. Printed asset labels carry only the asset code, so they are not affected. B: IT keeps the allow-list current when a store's internet line changes |
| **What you must decide** | A, B or C; who in IT changes the router; whether to close the forward immediately as a temporary step |
| **Deadline suggestion** | Decide by **2026-10-23**; done by **2026-11-15** (EXT-05) |

## SD-05 When to add HTTPS (deferred on 2026-10-08)

| | |
|---|---|
| **Decision** | When to switch CKAM to HTTPS, and with which certificate |
| **Current behaviour** | Plain HTTP on port 3211 from the LAN and the internet. HTTPS was deferred by you on 2026-10-08 (`PRODUCTION_INFRASTRUCTURE.md` line 24; this deferral is **not** recorded in `docs/ai/DECISIONS.md`). The sign-in cookie cannot carry `Secure` over HTTP (AU-13) |
| **Security risk** | IF-02 HIGH / R-01: passwords and session cookies travel readable. Example: anyone on the same public Wi-Fi or line as a store PC can read the store manager's password as it is typed |
| **Option A** | HTTPS now (within 30 days, right after SD-01), with a public certificate: an existing `*.citykartstores.com` wildcard if CityKart has one, or a paid 1-year certificate. Served by a small proxy (Caddy / IIS) or by uvicorn itself |
| **Option B** | HTTPS only if SD-04 keeps the internet forward; LAN-only use stays on HTTP (accept the risk inside the office) |
| **Option C** | Keep it deferred |
| **Recommendation** | **A.** If a proxy is put in front, CKAM must be told to trust it (`TRUSTED_PROXIES=127.0.0.1`), otherwise every user would appear to come from one address and share one sign-in limit (SD-08) |
| **Impact on users / operations** | `http://10.0.1.98:3211` stops working; everyone uses the name (an internal DNS record may be needed); bookmarks change once. IT must renew the certificate (Let's Encrypt on port 3211 needs a DNS record every 90 days, which is easy to forget; a 1-year paid certificate or the wildcard is simpler). `COOKIE_SECURE=true` and a new `BASE_URL` are set at the same time |
| **What you must decide** | A, B or C; the certificate type; who renews it and where the renewal date is written |
| **Deadline suggestion** | Certificate choice by **2026-10-30**; HTTPS live by **2026-11-15** (EXT-04) |

## SD-06 Lock-out after wrong passwords (AU-04)

| | |
|---|---|
| **Decision** | What should happen after several wrong passwords for one login? |
| **Current behaviour** | After **5 wrong passwords** the account is **locked for 15 minutes**; while locked it answers "locked" for any password, even the right one (AU-02, accepted so that the lock cannot be used to test passwords). On top: at most **20 sign-in attempts per minute per address** and **10 per minute per login id**. A locked account is also refused when its open session tries to renew (`backend/app/auth/router.py` lines 265-266), so a person already signed in is pushed out within about 15 minutes |
| **Security risk** | Anyone who knows or guesses a login id can lock that person out for 15 minutes, and again every 15 minutes (RT-AU-T313/T314). Store logins follow a public pattern (`sm.<code>@citykartstores.com`), so they are easy to guess. One address can keep about **60 accounts** locked (20 tries a minute ÷ 5 = 4 accounts a minute × 15 minutes). Example: someone outside locks all Delhi store logins every morning at opening time |

**The three options side by side**

| | Option A: keep the hard lock | Option B: growing delay, no lock | Option C: hybrid (recommended) |
|---|---|---|---|
| How it works | 5 wrong → locked 15 min (today) | Each wrong password makes the next try wait longer (e.g. 1 s, 2 s, 4 s … up to 30 s); never a lock | Growing delay per login (as B) **plus** today's per-address and per-login limits; a **short lock (e.g. 5 min)** only after sustained abuse (e.g. 20 wrong in an hour) |
| Example | A burglar trying keys locks the door for everyone for 15 minutes | Every wrong key makes the next attempt slower; the owner with the right key still gets in after a short wait | Slow-down first; the door locks briefly only if someone keeps trying for an hour |
| Stops guessing | Strong (5 tries per 15 min) | Good (about 120 tries an hour at 30 s, still far too few for a policy-checked password) | Strong (delay + limits + lock after sustained abuse) |
| Stops a stranger locking people out | No | Yes | Mostly (a short lock only after an hour of attack) |
| What a real user sees | "Account locked, try again later" for 15 min | "Please wait 30 seconds and try again" | Usually a short wait; rarely a 5-minute lock |
| Product effort | None | Small: the existing `locked_until` field can hold "next try allowed at"; no new table expected | Medium: delay as B, plus counting per hour; in-memory limits reset on restart (single process, acceptable) |
| Check needed | — | The wait must apply before the password is checked, for right and wrong passwords alike, so it does not become a guessing aid (AU-02) | Same, plus tests that a stranger cannot keep a person locked |

| | |
|---|---|
| **Recommendation** | **C** (best balance). **B** if you want the smallest change. **A** only if you accept, in writing, that anyone can lock out a named person |
| **Impact on users / operations** | B/C: fewer "locked" calls to IT; a typo costs seconds, not 15 minutes. The sign-in screen message changes (plain sentence with the wait). The audit trail keeps LOGIN_FAILED and LOCKED rows as today |
| **What you must decide** | A, B or C; if C, the numbers (suggested: delay up to 30 s; lock 5 min after 20 wrong in 60 min) |
| **Deadline suggestion** | **2026-11-15** (then built, tested and retested in the closure programme) |

## SD-07 Shared store logins

| | |
|---|---|
| **Decision** | May several store staff share the one store login, or should staff get their own logins? |
| **Current behaviour** | Each Store has one login, `sm.<code>@citykartstores.com`, with access level **Own Assets Only**: it can see the assets with that store and change its password; it cannot add, move or change anything. It has no password until the head-office admin or a Full Admin issues one (shown once, must be changed at first sign-in). In practice several staff may use it on the store PC or phones |
| **Security risk** | R-30 (Medium). (1) The audit trail says "the store", never which person (today only views and password changes are possible, so the harm is limited). (2) One person changing the password locks the others out. (3) Signing out on one device signs out every device of that login (N7). (4) Five wrong passwords by one person lock the whole store out (SD-06). (5) A former employee who knew the password keeps access until it is changed |
| **Option A** | One login per store, used by the **store manager only**; the password is changed whenever the manager changes; no sharing (written rule, EXT-30) |
| **Option B** | Named personal logins for store staff. Note: an Employee login with Own Assets Only today shows the assets with **that person**, not with the store, so B needs a product change (a "member of this store" link) before it is useful |
| **Option C** | Keep sharing, and accept it with a rule: password changed when any staff member leaves; the store manager is accountable for the login |
| **Recommendation** | **A now** (store logins are read-only, so the audit loss is small). Revisit B if store logins ever get write rights (for example confirming a receipt) |
| **Impact on users / operations** | A: other staff ask the manager to look things up; HR/area managers tell IT when a manager changes. B: one login per person to issue and support; more MFA/lock-out cases |
| **What you must decide** | A, B or C; who tells IT when a store manager changes |
| **Deadline suggestion** | Before store passwords are issued in bulk (about 212 stores); at the latest **2027-01-14** (EXT-30) |

## SD-08 Sign-in limit per internet address (many staff behind one address)

| | |
|---|---|
| **Decision** | Is 20 sign-in attempts per minute from one address right for offices where many people share one internet address (NAT)? |
| **Current behaviour** | In the new code (not yet deployed): 20 sign-in attempts per minute per address, 10 per minute per login id, 60 session renewals per minute per address, 10 password changes per minute per address (`backend/app/core/config.py` lines 56-61). Above that the answer is "Too many attempts, wait a minute" (HTTP 429) and a `RATE_LIMITED` row. Each LAN PC has its own address; staff coming from outside through one office line share that line's address |
| **Security risk** | Too low: real users refused at a busy moment (R-33, Low). Too high: password guessing gets faster. If HTTPS is later added with a proxy and `TRUSTED_PROXIES` is not set, **all** users would share one address and one limit |
| **Option A** | Keep 20/min and watch the `RATE_LIMITED` rows for 30 days after the deploy (EXT-40); change only if real users are refused |
| **Option B** | Raise the per-address limit now (e.g. 60/min) for everyone |
| **Option C** | Higher limit only for known office / store addresses (needs a small product change: a list of trusted networks) |
| **Recommendation** | **A**, with the weekly security-log review (doc 05) looking at `RATE_LIMITED` rows. The value is a setting (`RATE_LIMIT_LOGIN_PER_IP`), so changing it needs only a restart |
| **Impact on users / operations** | A: at most a one-minute wait in a rare rush (for example 25 people signing in at shift start from one line in the same minute) |
| **What you must decide** | A, B or C; who looks at the numbers after 30 days |
| **Deadline suggestion** | Review **30 days after SD-01** |

## SD-09 How long the audit trail is kept vs personal-data law

| | |
|---|---|
| **Decision** | How long CKAM keeps `audit_log` rows, which contain personal data |
| **Current behaviour** | `audit_log` is kept **forever**; the app never deletes it. A guarded database function can remove old rows, but only for rows older than **5 years** (migration `a3c5e7f9b1d4`; not yet in production). Rows hold names, login codes, the login id typed on failed sign-ins, and IP addresses. Passwords and secrets are never stored (redaction). Note: `docs/ai/LOGGING_AND_DIAGNOSTICS.md` §4 still says the function only refuses a cut-off under 1 day; the 5-year floor came later |
| **Security risk** | R-11 / R-31 (Medium): keeping personal data longer than needed may conflict with India's Digital Personal Data Protection Act 2023 (to be confirmed by legal counsel, EXT-31). Deleting too early loses evidence for investigations and audits |
| **Option A** | Keep everything forever (today). Simple; best for investigations |
| **Option B** | A fixed retention period set after the legal review (for example the period CityKart must keep fixed-asset and purchase records), with a yearly archive export kept off-server and then removal through the guarded function. If legal counsel wants less than 5 years, the floor in the code must change |
| **Option C** | Keep the rows but blank personal fields in old rows. Not possible without changing the append-only design; not recommended |
| **Recommendation** | **B**, after legal review. Until then keep A and the 5-year floor |
| **Impact on users / operations** | None for users. IT runs a yearly archive (export, check, removal) with a record. The asset movement history (`asset_event`) is a business record and is a separate question for legal counsel |
| **What you must decide** | Ask legal counsel (EXT-31); then pick the period |
| **Deadline suggestion** | Legal review requested by **2026-11-15**; decision by **2027-01-14** |

## SD-10 Independent external VAPT

| | |
|---|---|
| **Decision** | Budget and timing for a security test by an independent firm |
| **Current behaviour** | The 2026-10-15 test (about 1,592 cases) and the closure retest are done by the people who build CKAM. ISO A.5.35 and SOC 2 CC4/CC7 expect an independent check. No budget figure is known to this writer |
| **Security risk** | Builders share blind spots; an outside tester may find what the builders cannot see |
| **Option A** | Engage a firm (for example a CERT-In empanelled auditor) **after** SD-01 and the infrastructure fixes (HTTPS, SYSTEM account, backups), for an authenticated web-application and infrastructure test with a written scope; production tested only with your written approval |
| **Option B** | Engage now for an external scan only (what the internet sees), full test later |
| **Option C** | Defer for 12 months |
| **Recommendation** | **A**, with two or three quotes; a test before the fixes would mostly re-find known items |
| **Impact on users / operations** | A short agreed test window; IT available to answer questions; findings go into doc 06 |
| **What you must decide** | A, B or C; budget ceiling; who signs the scope and test plan |
| **Deadline suggestion** | Quotes by **2026-12-15**; test by **2027-01-31** (EXT-14) |

## SD-11 Separate production database roles (date and names)

| | |
|---|---|
| **Decision** | When to split the production database account, and what to call the new roles |
| **Current behaviour** | The app connects to `ckassetmanagement` on 10.0.0.205 as `ckassetapp` (not a superuser), which also runs the migrations and therefore **owns** the tables. An owner can switch off or drop the append-only triggers and wipe the audit trail (IF-05/IF-06, MITIGATED only). The design and grant script are in `CKAM_SECURITY_REMEDIATION_REPORT.md` §7 (DESIGN ONLY) with the names `ckam_owner`, `ckam_migrator`, `ckam_app` |
| **Name problem** | PostgreSQL role names are shared by the whole server, and 10.0.0.205 also serves other apps. `ckam_app` is the name of the **retired** role on 10.0.1.12 (a different server, but confusing in notes and scripts). The `ckam_` names also do not follow the production naming (`ckassetapp`, `ckassetmanagement`) |
| **Security risk** | R-12 (Medium): an attacker with the runtime password, or a bug, could rewrite the history auditors rely on |
| **Option A** | Three new roles with the production prefix: `ckasset_owner` (owns everything, cannot sign in), `ckasset_migrator` (signs in only during a deploy to run migrations) and `ckasset_runtime` (the running app: normal reads and writes, only SELECT and INSERT on the four audit/history tables, no TRUNCATE, cannot alter or drop anything). `DATABASE_URL` moves to `ckasset_runtime`; `ckassetapp` is then switched to NOLOGIN |
| **Option B** | Keep `ckassetapp` as the **runtime** role (fewer settings change; its password is changed anyway in SD-01) and add `ckasset_owner` and `ckasset_migrator`; ownership moves from `ckassetapp` to `ckasset_owner` |
| **Recommendation** | **B** (smallest change, clear names, no clash). The script in §7 must be adapted to the chosen names and first proven on a throw-away copy (work package WP-B); it must also cover any new tables and triggers added by the closure programme |
| **Impact on users / operations** | About 30 minutes in a quiet window (you type the `postgres` password); the deploy procedure changes (migrations run as `ckasset_migrator` with their own connection setting); the app is restarted once |
| **What you must decide** | A or B (or other names); the date and time of the window; who is present |
| **Deadline suggestion** | Window chosen by **2026-11-15**; done within 30 days after SD-01 and the secret change (EXT-07) |

## SD-12 Same-name vendors and brands in the Excel master import

| | |
|---|---|
| **Decision** | Should the head-office Excel import refuse a vendor or brand whose name already exists? |
| **Current behaviour** | Adding a vendor or brand on a screen refuses a name that an active one already has (`docs/ai/DECISIONS.md` 2026-10-14 (3); made race-safe by RACE-1). The head-office **Excel master import** checks only codes, and the ERP vendor-add paths check the ERP link and GSTIN instead (OBS-NAME-IMPORT) |
| **Security risk** | Low (data quality rather than security): two "ARIHANT INFOCOM LLP" vendors split purchase history and confuse matching |
| **Option A** | Refuse same-name rows in the import preview with a row error that names the existing record (same rule everywhere) |
| **Option B** | Allow them but warn in the preview; the head-office admin decides per row |
| **Option C** | Keep today's behaviour |
| **Recommendation** | **A** for brands; **A** for vendors too, because GSTIN-based matching (not a second same-name vendor) is how CityKart already handles one supplier with several registrations |
| **Impact on users / operations** | Only the head-office admin's imports; a file with duplicates needs those rows fixed or removed |
| **What you must decide** | A, B or C |
| **Deadline suggestion** | **2027-01-14** (next product release; not urgent) |

## SD-13 Password expiry and rotation

| | |
|---|---|
| **Decision** | Should people be forced to change their password on a calendar, and how often should server secrets change? |
| **Current behaviour** | **People:** no expiry and no password history. A chosen password must be 8-128 characters and is refused if it is common, a simple sequence, the company/app name with numbers, a common word with numbers around it, or contains the person's name, code or email (`backend/app/auth/password_policy.py`). Issued and reset passwords are random, shown once, and must be changed at first sign-in. **Server secrets** (JWT key, DB, NAS, ERP passwords): no rotation rule; first rotation is part of SD-01 |
| **Security risk** | A leaked password stays valid until someone changes it. Forced frequent changes make people pick weaker, predictable passwords (`Store@Jan`, `Store@Feb`) |
| **Option A** | No calendar expiry for people (in line with current guidance such as NIST SP 800-63B); a change is **forced on events**: suspected leak, a store manager or staff member leaves (SD-07), after an incident. Server secrets: change on events and at least once a year, recorded without values (doc 02) |
| **Option B** | Expiry every 90 days for everyone (needs a product change: a "password changed at" field → migration, plus a warning screen) |
| **Option C** | Expiry only for head-office admin and Full Admins (e.g. 180 days), plus A for everyone else |
| **Recommendation** | **A**, together with MFA for admins (SD-03). Optional extra: after SD-01, ask the two admin accounts to change their passwords once |
| **Impact on users / operations** | A: nothing changes day to day; IT must actually trigger the event-based changes (joiner/mover/leaver, doc 03) |
| **What you must decide** | A, B or C; the yearly secret-rotation month |
| **Deadline suggestion** | **2027-01-14** |

## SD-14 How long a sign-in lasts (session lifetime)

| | |
|---|---|
| **Decision** | How long someone stays signed in without signing in again |
| **Current behaviour** | The short pass (access token) lasts **15 minutes** and is renewed in the background with the sign-in cookie, which lasts **8 hours of idleness** and is renewed every time it is used (`backend/app/core/config.py` lines 13-14; `auth/router.py` `refresh`). There is **no absolute maximum**: a session that keeps being used never has to sign in again. Sign-out, a password change, an access change or switching off the login end every session of that account at once. Whether an open, unattended browser tab renews itself (background refreshes) was **not verified** |
| **Security risk** | R-19: a PC left signed in at a store counter or an admin's desk stays usable; a stolen cookie is useful for up to 8 idle hours (the AU-06 residual, being closed in WP-A2) |
| **Option A** | Keep today's rule (15 min / 8 h idle, no maximum) |
| **Option B** | Add an **absolute limit of one working day (e.g. 12 hours from sign-in)** for everyone, and a **shorter idle time (e.g. 2 hours) for the head-office admin and Full Admins** |
| **Option C** | Short idle time for everyone (e.g. 1 hour) |
| **Recommendation** | **B.** The product can carry the original sign-in time inside the cookie, so no database change is expected |
| **Impact on users / operations** | B: everyone signs in once per working day; admins sign in again after a long break. C: frequent re-sign-ins at stores, more lock-out risk from typos |
| **What you must decide** | A, B or C; the numbers |
| **Deadline suggestion** | **2027-01-14** |

## SD-15 Log retention vs a 12-month SOC 2 observation period

| | |
|---|---|
| **Decision** | How long system events, error rows and problem reports are kept |
| **Current behaviour** | `error_log`, `system_event` and `client_report` are deleted after `LOG_RETENTION_DAYS` = **180 days** (critical errors and reviewed reports twice as long); log files rotate at 20 MB × 11 per file (660 MB in all); `audit_log` is kept forever (SD-09). Nothing is copied off the server |
| **Security risk** | A SOC 2 Type II auditor samples a 6-12 month period: with 180 days half of a 12-month period's system and error evidence is gone. An attacker who controls the server can also delete logs that exist only there (R-27) |
| **Option A** | Raise `LOG_RETENTION_DAYS` to about **400 days** (a setting; more database space) |
| **Option B** | Keep 180 days and **export monthly** (`GET /api/admin/logs/export?kind=system\|errors\|client`) to storage the CKAM server cannot delete, with a hash of each file (EXT-21) |
| **Option C** | Both A and B |
| **Recommendation** | **C** if SOC 2 Type II is a goal (SD-16); **B** otherwise (off-server copies help any investigation) |
| **Impact on users / operations** | None for users. A: a few hundred MB more on 10.0.0.205 (estimate, not measured). B: a monthly 10-minute task for IT, with a record |
| **What you must decide** | A, B or C |
| **Deadline suggestion** | Together with SD-16 |

## SD-16 Is ISO 27001 / SOC 2 a goal; ISMS Lead; approval of the DRAFT policy pack

| | |
|---|---|
| **Decision** | Does CityKart want ISO 27001 certification or a SOC 2 report for CKAM, who leads it, and are the DRAFT policies in `docs/security/policies/` to be adopted? |
| **Current behaviour** | No ISMS exists for CKAM: no approved policy, no named ISMS Lead, no owned risk register, no access reviews, internal audit or management review (`CKAM_ISO27001_READINESS.md` §3, §11). CKAM is **not** certified and has **no** SOC 2 report. 15 DRAFT documents and 6 blank record forms were written on 2026-10-16; none is approved or in use |
| **Security risk** | Without owners and records, good technical controls decay unnoticed (R-24: one developer and one owner hold everything) |
| **Option A** | Aim for ISO 27001 certification (12+ months: the ISMS must run, with one internal audit and one management review, before an accredited body audits it) |
| **Option B** | Adopt the policies and run the routines (access review, change record, restore test, log review) without a certification goal for now; decide certification in 12 months |
| **Option C** | Aim for SOC 2 (only useful if a customer or partner asks for it; a licensed CPA firm issues it after a 6-12 month observation) |
| **Recommendation** | **B** now; it builds the records any later certification needs |
| **Impact on users / operations** | A named ISMS Lead (part-time); quarterly and monthly routines for the head-office admin and IT (about 2-4 hours a month in total, estimate) |
| **What you must decide** | A, B or C; who is the ISMS Lead; who approves each policy (doc README lists them) |
| **Deadline suggestion** | **2027-01-14** (EXT-17, EXT-36) |

---

## Already decided (not re-opened here)

These owner decisions in `docs/ai/DECISIONS.md` are taken as given by every option above:

* The backend decides every permission; the screen only hides (2026-10-14 (1)).
* Work area (IT / Non-IT) is an authorization boundary and a Full Admin can be limited to one (2026-10-14 (4)).
* Code rules, companies, custom fields, ERP Inbox and Bulk Import are head-office-admin only (2026-10-14 (3), (8)).
* A store always gets its own Stock Room and Install Point; store logins follow `sm.<code>@citykartstores.com` and get no password until one is issued (2026-10-14 (9)).
* Push only on the owner's word; deploy only on a separate request; the owner types server passwords (2026-10-14 (1) guardrail 7, `CLAUDE.md`).
* Login asks only for login id and password, no company selector (2026-09-24).
