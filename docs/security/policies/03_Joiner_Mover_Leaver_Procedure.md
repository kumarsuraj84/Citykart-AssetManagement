# 03 — CKAM Joiner / Mover / Leaver Procedure

| | |
|---|---|
| Document | CKAM-ISMS-03, version 0.1, 2026-10-16 |
| Status | **DRAFT — MANAGEMENT APPROVAL REQUIRED.** Not approved, not in operation |
| Owner (proposed) | HR (trigger) + CKAM System Owner (CKAM changes) + IT / Infra (server and secret changes) |
| Approver | Management |
| Review | Yearly; sample checked in every quarterly access review (doc 11) |
| Maps to | ISO A.5.11, A.5.16, A.5.18, A.6.1, A.6.2, A.6.4-6.6; SOC 2 CC6.2, CC6.3; EXT-33 |

## 1. Purpose

Every CKAM login exists because a named person needs it today, and stops the same day the need ends. Assets held
by a leaver come back before final settlement.

## 2. Triggers

| Event | Who tells whom | By when |
|---|---|---|
| **Joiner** needs CKAM | Line manager → HR → CKAM System Owner (or a Full Admin of that company and work area) | Before the start date |
| **Mover** (new job, work area, company, or store) | Line manager / HR → CKAM System Owner | On the day of the change |
| **Leaver** | HR → CKAM System Owner and IT | On the last working day at the latest; **same day** for a dismissal |
| **Store manager changes** | Area manager → CKAM System Owner | On the day of the change |
| Someone who knew a **server secret** leaves | CKAM System Owner → IT | Same week |

HR controls (screening, contract, NDA, disciplinary process) are CityKart-wide and not evidenced for CKAM
(ISO A.6.1, A.6.2, A.6.4, A.6.6); HR confirms them for staff who get Full Admin or head-office admin.

## 3. Steps in CKAM (the real screens)

### Joiner

1. Open **People & Places › Employees** (Settings › **Users & Access** links there) → **Add**: Code, Name, Place,
   Department, email, phone.
2. Only if the person needs to sign in: switch on **Can sign in**, choose the **Access level** (default Own Assets
   Only), **Work Area** and extra **Company access** exactly as approved on the request (doc 02 least privilege).
3. **Reset password** (one person) or **Issue login passwords…** (several): the temporary password is shown once;
   hand it over in person or by phone. The person must change it at first sign-in.
4. Fill a record (`templates/joiner_mover_leaver_record.md`) and note the request id / e-mail of the approval.

### Mover

1. Edit the Employee: change access level, work area or company access as approved. CKAM ends every open session
   of that person at once (`ACCESS_CHANGED` row; sessions renew only with current rights).
2. If the person moves to another company or place, move the assets with them (Move › Give to Employee / Return to
   Stock Room) as the business requires.
3. Fill the record.

### Leaver

1. **Same day:** edit the Employee and switch off **Can sign in**. This ends every session immediately.
2. Ask the Asset view **Currently with** this person (Assets › More filters › Currently with). Return every asset
   (Move › **Return to Stock Room**, or give it to the successor) before final settlement. CKAM refuses to
   deactivate a person who still holds assets ("X still holds 3 assets. Move them … first").
3. When nothing is held any more: **Deactivate** the Employee (never deleted; history stays).
4. If the leaver was a head-office admin: another head-office admin removes the flag (`PRIMARY_OWNER_REVOKED`).
5. If the leaver knew a server secret, the password manager or a store password: IT rotates it (doc 02 §4) and
   writes a rotation note (no values).
6. Fill the record; HR keeps it with the exit checklist.

### Store manager change (shared store login, decision SD-07)

1. People & Places › **Stores** → the store → **Reset password**; give the new temporary password to the new manager.
2. The old manager's devices are signed out by the reset.

## 4. Evidence this procedure would produce

* One record per event (template), with the request reference and the approver.
* Matching `audit_log` rows: `CREATE` / `UPDATE` / `DEACTIVATE` on `asset_user`, SECURITY `ACCESS_CHANGED`,
  `PASSWORD_RESET`, `PRIMARY_OWNER_GRANTED` / `_REVOKED`; LIFECYCLE `MOVE` rows for returned assets.
* Quarterly: HR leaver list compared with CKAM logins that can still sign in (doc 11).

## 5. What this does NOT yet prove

* No HR-to-CKAM notification exists today; no joiner, mover or leaver record has been made.
* Nothing shows that past leavers' logins were switched off or their assets returned.
* The CKAM mechanics (session end on access change or switch-off, refusal to deactivate a holder) are tested in code,
  but the session-ending fix is **not yet deployed** to production.
