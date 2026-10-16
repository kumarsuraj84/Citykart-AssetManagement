# 01 — CKAM Information Security Policy

| | |
|---|---|
| Document | CKAM-ISMS-01, version 0.1, 2026-10-16 |
| Status | **DRAFT — MANAGEMENT APPROVAL REQUIRED.** Not approved, not communicated, not in operation |
| Owner (proposed) | ISMS Lead (to be appointed, EXT-36); until then the CKAM System Owner |
| Approver | Management (CityKart) |
| Review | Yearly, and after a major incident or a major change to CKAM's hosting |
| Maps to | ISO/IEC 27001:2022 clause 5.2, A.5.1, A.5.2, A.5.10, A.5.12-5.14, A.5.31, A.5.34, A.8.1, A.8.10-8.12, A.8.20-8.24; SOC 2 CC1, CC2, CC5, C1; EXT-17 |

## 1. Purpose

CKAM is CityKart's register of who has which asset, bought from whom, for how much. This policy says how that
information is protected, who is responsible, and which more detailed documents (02-15) apply.

## 2. Scope

The CKAM application and everything it runs on or depends on: the app on 10.0.1.98
(`D:\Citykart_Applications\Citykart_AssetManagement_App`, task `CKAM-Web`), the database `ckassetmanagement` on
10.0.0.205, the document folder on NAS 10.0.0.25 (`CKASSETMANAGEMENT_DATA`), backups, the read-only ERP link to
10.0.1.69, the development PC 10.0.0.47, the source repository, and every person who signs in to CKAM.
**Out of scope:** Spinwheel and Citykart Desk (they share servers but are not CKAM: never read or change them), the
ERP itself, CityKart corporate IT, and the retired server 10.0.1.12 (it must stay switched off for CKAM).

## 3. Principles (non-negotiable)

1. **The server decides every permission.** Hiding a button is convenience, not security; every write re-checks
   role, company and work area on the server.
2. **History is never rewritten.** The asset event ledger, the field-change audit, `master_audit` and `audit_log`
   are append-only. Business records are switched off (deactivated), never deleted.
3. **No secret in code, documents, chat or tickets.** Secrets live only in `shared\.env` / `shared\nas.pw` on the
   server (Administrators + the CKAM service account) and in the company password manager (EXT-23).
4. **Development and testing never happen on production.** Production changes follow doc 04.
5. **Least privilege.** People, service accounts and database roles get only what their job needs (doc 02).
6. **Anything unusual is reported**, through "Report a problem" in CKAM or directly to the CKAM System Owner (doc 05).

## 4. Roles

| Role | Responsibility | Today |
|---|---|---|
| Management | Approves this policy pack, accepts risks in writing, funds actions, chairs the management review (doc 14) | Not evidenced |
| CKAM System Owner | Business owner of CKAM; approves pushes and, separately, deploys; holds a head-office admin account; types server passwords | Exists (the owner) |
| ISMS Lead | Keeps the policies, risk register (doc 12) and evidence; runs reviews | **Not appointed** |
| Dev Lead | Builds and tests CKAM; follows `docs/ai/DEVELOPMENT_GUARDRAILS.md`; prepares releases | Exists (one developer, AI-assisted) |
| IT / Infra | Servers 10.0.1.98 and 10.0.0.205, NAS, router, firewall, backups, patching | Exists; CKAM duties not written down |
| HR | Tells IT about joiners, movers, leavers (doc 03); screening and NDAs | Not evidenced for CKAM |
| Legal | Personal-data law, CERT-In reporting, record retention (EXT-31) | Not engaged |
| Internal Auditor | Checks controls once a year; must not be the developer or the System Owner (doc 13) | Not appointed |
| Every user | Keeps their password to themselves, signs out on shared PCs, reports problems | — |

**Segregation gap (known):** today the same person approves, and the same developer builds and prepares, every
change. Doc 04 and doc 13 describe how to add a second pair of eyes.

## 5. Classification and handling of CKAM information

| Class | CKAM examples | Handling |
|---|---|---|
| **Restricted** | JWT secret, database / NAS / ERP passwords, backup encryption key, temporary passwords at the moment they are issued | Only in `shared\.env`, `shared\nas.pw` and the password manager. Never in e-mail, chat, tickets, screenshots or git. A temporary password is handed over in person or by phone, never in a group chat |
| **Confidential** | Vendor GSTIN, PAN, contacts, PO and invoice values, uploaded documents, staff names / phones / emails, `audit_log` (holds IP addresses and typed login ids), database dumps, exports, diagnostics bundles | Inside CityKart only, to people whose role needs it. Exports stay on company devices and drives; no personal e-mail or personal cloud. Dumps are encrypted when they leave the database server (doc 07) |
| **Internal** | Asset register, asset codes, item catalogue, this policy pack | CityKart staff |
| **Public** | Nothing in CKAM is public | — |

Labelling: export file names keep their CKAM names; a file sent outside CityKart must be approved by the CKAM System
Owner and recorded.

## 6. Acceptable use

* A CKAM login is personal, except the store login, which follows the store-login rule chosen in decision **SD-07**.
* Do not try to see data outside your companies or work area; do not test CKAM's security on production without the
  CKAM System Owner's written approval.
* Lock the screen when leaving the desk (Windows + L); sign out on shared store PCs.
* Until HTTPS exists (SD-05), do not sign in to CKAM over public Wi-Fi.
* **AI-assisted development:** the AI coding assistant may read the repository and prepare changes on the dev PC.
  It never receives production data, production secrets or server passwords; it never pushes or deploys without the
  CKAM System Owner's explicit word; a human reviews every change before it is pushed.

## 7. Cryptography (current state and rule)

| Item | Today | Rule |
|---|---|---|
| Stored passwords | Argon2id | Keep; never log or export a password |
| Sign-in tokens | HS256 with a server secret; production refuses to start with a weak secret (new code, not deployed) | Secret ≥ 32 characters, ≥ 8 different characters, rotated on events and yearly (SD-13) |
| Transport | **Plain HTTP** (IF-02) | HTTPS with a public certificate (SD-05); then `COOKIE_SECURE=true`, later HSTS |
| ERP connection | No TLS settings (IF-16) | TLS once the ERP owner enables it (EXT-25) |
| Backups | Unencrypted | AES-256 when copied off the database server; key in the password manager (doc 07) |

## 8. Network and hosting

* CKAM listens on port 3211 of 10.0.1.98 behind firewall rule `CKAM-Web`. Internet exposure follows decision
  **SD-04**. Only 10.0.1.98 may connect to the CKAM database role (`pg_hba.conf` /32).
* On shared servers touch only CKAM's own folder, task, firewall rule, database, roles, backup task and NAS folder.

## 9. Retention and deletion

`audit_log` is kept until decision **SD-09** sets a period; system / error / problem-report rows follow
`LOG_RETENTION_DAYS` (180 days today, decision **SD-15**). Business records are deactivated, never deleted.
Disposal of servers or disks that held CKAM data needs a wipe record (IT).

## 10. Exceptions

An exception (for example "keep the hard lock-out") is valid only when Management accepts it in writing in
`docs/ai/DECISIONS.md` with a reason and a review date, and the ISMS Lead records it in the risk register (doc 12).

## 11. Evidence this policy would produce

* Signed and dated policy with version history; staff acknowledgement list (doc 10).
* A role list with names (appointment notes).
* Exception records in `docs/ai/DECISIONS.md`.

## 12. What this does NOT yet prove

* No one has approved, signed or communicated this policy; no role in §4 marked "Not appointed" is filled.
* The classification has not been applied to any real export, dump or document.
* The cryptography table describes the target; production today has plain HTTP, unencrypted backups and the
  IF-01 exposure until decision SD-01 is carried out.
