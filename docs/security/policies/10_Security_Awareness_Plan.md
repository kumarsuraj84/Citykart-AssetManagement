# 10 — CKAM Security Awareness Plan

| | |
|---|---|
| Document | CKAM-ISMS-10, version 0.1, 2026-10-16 |
| Status | **DRAFT — MANAGEMENT APPROVAL REQUIRED.** No session has been held |
| Owner (proposed) | ISMS Lead (content); HR (scheduling and attendance records) |
| Approver | Management |
| Review | Yearly; after any incident caused by a human mistake |
| Maps to | ISO A.6.3, A.6.8, A.7.7, A.5.10; SOC 2 CC1.4, CC2.2; EXT-32 |

## 1. Who learns what

| Audience | When | Length | Topics |
|---|---|---|---|
| **Every CKAM user** (incl. store managers) | Before their login is issued; yearly refresher | 15 minutes or the one-page guide (§2) | Passwords, store-login rule, temporary password, lock-out, Report a problem, phishing, plain HTTP until HTTPS, locking the screen |
| **Admins** (head-office admin, Full Admins) | On getting the role; yearly | 45 minutes | All of the above plus: least privilege when giving access (doc 02), issuing passwords safely, joiner / mover / leaver (doc 03), quarterly access review (doc 11), weekly security-log review, what an incident is (doc 05) |
| **IT / Infra** | Yearly | 45 minutes | Shared-server rule (touch only CKAM's things), secrets handling (never printed, password manager), backups and restore drill (doc 07), patching (doc 06), incident containment steps (doc 05) |
| **Developer** (incl. AI-assisted work) | Yearly and when the guardrails change | 1 hour | `docs/ai/DEVELOPMENT_GUARDRAILS.md` security rules, secure coding lessons from the 2026-10 VAPT, change procedure (doc 04), no production data or secrets in AI prompts |

## 2. One-page guide for every user (draft text)

> **CKAM security in eight lines**
> 1. Your CKAM password is yours. Never write it on the PC or share it. Store logins: only the store manager uses
>    it (or the rule management chooses).
> 2. A temporary password is given to you in person or by phone; change it at first sign-in. Choose something long
>    that is not "Citykart2026" or your name.
> 3. Five wrong passwords lock the account for a while. If you are locked out and did not cause it, tell IT: someone
>    may be trying your login.
> 4. Use only the address IT gave you for CKAM. A link in an e-mail or WhatsApp asking you to "sign in to CKAM" is
>    suspicious; report it.
> 5. Until CKAM uses https://, do not sign in over public or free Wi-Fi.
> 6. Lock the screen when you leave (Windows + L); sign out on a shared store PC.
> 7. Anything strange (a page you should not see, an error, someone else's assets) → press **Report a problem** in
>    CKAM, or tell the CKAM System Owner. Quote the **Reference** shown on the error.
> 8. Exports and invoices from CKAM stay on company devices; never send them to a personal e-mail.

## 3. Records

HR keeps an attendance list (name, role, date, session) and the user's acknowledgement of doc 01 §6. The ISMS Lead
checks once a year that every login holder has a record (compare with the access review, doc 11).

## 4. Evidence this plan would produce

Attendance lists, signed acknowledgements, the slides / guide version used, yearly completion figure.

## 5. What this does NOT yet prove

* No session has been held and nobody has acknowledged a policy.
* Some lines of the guide depend on open decisions (store logins SD-07, lock-out SD-06, HTTPS SD-05) and must be
  updated when those are decided.
* HR screening and NDAs for privileged users are not evidenced (doc 03).
