# CKAM Backup & Restore Plan (off-server, encrypted, tested) — EXT-08

| | |
|---|---|
| Date | 2026-10-16 (prepared during the security closure programme, WP-D1) |
| Status | **PREPARED, NOT DONE.** No backup job, copy, encryption or restore has been set up or run by this work. This is a design and procedure for Infra. **PRODUCTION REMAINS NOT REMEDIATED** for IF-08 until an off-server encrypted copy, an offline/immutable copy and a tested restore exist on the real servers |
| Closes | IF-08 (backups sit on the same server as the database, unencrypted, never restore-tested in production); supports R-13/R-14 and the BCP/DR work (EXT-29) |
| Today (confirmed in the docs) | Nightly task `CK_Backup_CKASSETMANAGEMENT` on **10.0.0.205**, 03:00, 30 days kept, output `E:\DB BACKUP\CK_CKASSETMANAGEMENT_DBBACKUP`, `backup.log` there. **Not yet copied off the DB server.** Documents live on NAS **10.0.0.25** (`CKASSETMANAGEMENT_DATA`); no document backup is evidenced |
| Sources | `docs/ai/PRODUCTION_INFRASTRUCTURE.md` (Backups row, open items), `CKAM_EXTERNAL_SECURITY_ACTIONS.md` EXT-08/EXT-21/EXT-23/EXT-29, `CKAM_RELEASE_RUNBOOK.md` §12 (restore), `docs/ai/LOGGING_AND_DIAGNOSTICS.md` (audit kept forever) |

## In plain words

Right now every CKAM backup sits on the **same machine as the live database**, in the clear, and no one has ever
restored one on the real system to check it works. If that one machine is lost — disk failure, ransomware, a
mistake — the data and the backups go together, and nobody knows whether a restore would even succeed. This plan:
copy each backup **off** that machine, **encrypt** it, keep one copy **offline/immutable** that a hacked server
cannot delete, back up the **documents** on the NAS too, and **test a restore every quarter** so we know it works
and how long it takes.

Simple example: keep a spare house key at a relative's house (off-site), in a locked box (encrypted), and actually
try the spare in the lock once in a while (restore test) — not only when you are already locked out.

---

## 1. What must be backed up

| Data | Where it lives | How it is backed up today | Gap |
|---|---|---|---|
| Database `ckassetmanagement` (asset register, people, audit trail, ERP copy) | 10.0.0.205 PostgreSQL 18 | nightly `pg_dump` to `E:\DB BACKUP\...` on the same server | not off-server, not encrypted, not restore-tested |
| Documents (uploads) | NAS 10.0.0.25 `CKASSETMANAGEMENT_DATA` | **none evidenced** | no backup at all |
| Config/secrets `shared\.env`, `nas.pw`, launcher | 10.0.1.98 | — | not a data backup; keep a sealed copy in the password manager (EXT-23), rotate on exposure. Do **not** put secrets in the data backups |

The **audit trail is part of the database** (`audit_log`, kept forever by design) — so the nightly DB dump already
captures it. Protecting the dump protects the audit trail.

---

## 2. Off-server encrypted database backup

**Tool and encryption choice (recommendation):**

- Keep the existing nightly `pg_dump` (custom format, `.dump`) — it is proven and version-matched to PostgreSQL 18.
- Add a step that **encrypts** each new dump and **copies it off 10.0.0.205**. Two acceptable approaches:
  1. **Age or GnuPG (asymmetric) + copy.** Encrypt the dump to a public key whose private key is held only in the
     password manager (EXT-23) and offline. The server can encrypt but **cannot decrypt** its own backups, so a
     compromised server cannot read old backups. Then copy the `.age`/`.gpg` file to the off-server target.
     **Recommended** — asymmetric keys mean the server never holds the decryption secret.
  2. **A backup tool with built-in encryption** (e.g. Restic/Kopia to an off-server repository, or 7-Zip AES-256
     archives) where the repository/password is held off the server. Restic/Kopia also give deduplication,
     retention and integrity check in one tool.
- **Recommendation: Restic (or Kopia) to an off-server repository, with the repository password in the password
  manager (EXT-23)** — it covers encryption, off-server transport, retention and an integrity `check` in one tool;
  or, if a simpler path is wanted, `age`-encrypt the nightly dump to an offline public key and copy it off.

**Key custody:** the decryption key / repository password lives in the company password manager (EXT-23) with
access for two named people and a sealed break-glass copy. It is **not** stored on 10.0.0.205, 10.0.1.98 or the NAS.
Losing this key means losing the ability to restore — treat it as critical.

**Off-server target:** a location that is **not** 10.0.0.205 and ideally not even in the same rack — a different
server, a NAS volume dedicated to backups, or company cloud/object storage. Confirm capacity (section 5).

**Do not** put any secret (`.env`, `nas.pw`, JWT secret) inside the data backup; restores must not resurrect old
exposed secrets.

---

## 3. NAS document backup

- Back up `\\10.0.0.25\ckapplications_data\CKASSETMANAGEMENT_DATA` on the **same nightly schedule** as the database,
  so documents and the rows that reference them stay roughly in step.
- Prefer the NAS's own **snapshot** feature (fast, space-efficient, and a read-only snapshot resists ransomware) if
  available, **plus** a periodic copy of the snapshot off the NAS. If snapshots are not available, a nightly
  `robocopy /E /COPY:DAT /MIR`-style mirror to the off-server backup target — but a plain mirror is dangerous
  against ransomware (it would copy encrypted/deleted files over good ones), so keep **versioned** copies (Restic/
  Kopia, or dated folders) rather than a single overwriting mirror.
- Encrypt the off-NAS copy the same way as the database (section 2) if it leaves the trusted network.
- Touch only CKAM's own NAS folder, never Spinwheel's or Citykart Desk's.

---

## 4. Immutable / offline copy (ransomware)

At least one copy must be **unchangeable by a compromised server account**:

- Object storage with **object-lock / WORM** (write-once) and a retention period, or
- A backup repository with an **append-only / immutable** mode (Restic REST server in append-only mode, or a
  provider that enforces immutability), or
- An **offline** rotation (a drive that is disconnected between writes).

Why: ransomware (or a stolen admin credential) typically deletes or encrypts every reachable backup first. An
immutable/offline copy is the one that survives. The **3-2-1 rule** is the target: **3** copies (live + on-server +
off-server), on **2** media types, with **1** off-site and immutable/offline.

---

## 5. Retention

| Tier | Keep | Where |
|---|---|---|
| Daily | 30 days (matches today's on-server retention) | on-server + off-server encrypted |
| Weekly | 12 weeks | off-server encrypted |
| Monthly | 12 months | off-server encrypted + at least one immutable/offline |
| (Optional) Yearly | per legal retention for fixed-asset/purchase records (confirm via EXT-31) | immutable/offline |

Note the **audit-trail / personal-data retention question** (EXT-31, DPDP Act 2023): the audit trail is inside the
database and kept forever by the app; whether backups may also keep personal data indefinitely is a legal question
— align backup retention with the EXT-31 decision once it exists. Capacity: size the off-server target for the
monthly tier plus growth; re-estimate from real data volume (the current production database is near-empty, so
today's sizes do not represent production — do not plan capacity from them).

---

## 6. RPO / RTO proposals (for the owner to confirm — EXT-29)

- **RPO (how much data loss is acceptable):** proposed **24 hours** — the nightly backup means a full loss of
  10.0.0.205 could lose up to one day of changes. If the business needs less, move to more frequent dumps (e.g.
  every few hours) or WAL archiving / point-in-time recovery; that is a larger change and a separate decision.
- **RTO (how long to be back):** proposed **4 hours** for the database restore + document restore + redeploy,
  measured and refined by the quarterly drill (section 7). There is no standby server today (accepted risk, A.8.14,
  EXT-29) — so RTO includes provisioning/choosing a target to restore onto.

These are **proposals**, not commitments, until the owner agrees them in the BCP/DR plan (EXT-29).

---

## 7. Restore testing — quarterly — with evidence

**Rule:** never restore over the live `ckassetmanagement`. Always restore into a **throw-away, uniquely-named**
database on a **non-production** server (or a disposable container), as the release runbook §12 already requires.

**Procedure (each quarter):**

1. Take the latest off-server encrypted database backup and **decrypt it** with the key from the password manager
   (proves the key custody works, not just the backup).
2. Restore it into a fresh throw-away database on a non-production host (`pg_restore`, or the tool's restore).
3. **Compare row counts** of the key tables against what the source had at backup time: `company`, `asset_user`,
   `asset`, `asset_event`, `asset_field_change`, `audit_log`, `purchase_order` (and any new tables the closure
   migrations add). They must match the source at that time.
4. **Check the Alembic version** of the restored database matches the release that produced the backup
   (`SELECT version_num FROM alembic_version;`).
5. **Restore a sample of documents** from the NAS backup and **open a few** to confirm they are intact and match the
   asset rows that reference them.
6. **Time the whole thing** end to end — this measured duration is the real RTO; record it.
7. Drop the throw-away database and delete the restored sample.

**Evidence checklist / template (keep each quarter):**

```
CKAM RESTORE DRILL — Quarter: ______   Date: ______   Run by: ______
Backup file used: ____________________  (date/time of backup: ______)
[ ] Decryption with password-manager key succeeded
[ ] Restored into throw-away DB: ______________ on host: ______ (NON-production)
Row counts (restored vs expected-at-backup):
    company ____/____  asset_user ____/____  asset ____/____  asset_event ____/____
    asset_field_change ____/____  audit_log ____/____  purchase_order ____/____
[ ] Alembic version matches release: ______ (expected ______)
[ ] Document sample restored and N files opened OK (N=____)
End-to-end duration (measured RTO): ______    (target RTO: 4h — met? Y/N)
[ ] Throw-away DB dropped; restored samples deleted
Issues found / follow-ups: ____________________________________________
Signed: ______________
```

Store each completed drill under `docs/security/evidence/closure/backup/` (or the owner's evidence store) and copy
it off-server.

---

## 8. Monitoring of backup success

- An **alert** if a night's backup does not produce a new, non-empty file, or the job exits non-zero, or the
  off-server copy fails, or the integrity `check` fails (ties to EXT-22 alerting). Today there is **no** automated
  alert — an operator must check `backup.log` and `GET /api/admin/diagnostics/health` manually; the alert replaces
  that gap.
- A **weekly** human check: confirm a `Backup complete` line exists for every expected night, the off-server copy
  landed, and the immutable copy is advancing (EXT-22 weekly review).
- Record the off-server copy and the integrity check in the same log store as the app logs, with retention and an
  off-server copy (EXT-21).

---

## 9. Who owns what

| Task | Owner |
|---|---|
| Nightly DB dump + encryption + off-server copy runs and is monitored | Infra |
| Off-server target and immutable/offline copy provisioned and capacity-managed | Infra |
| NAS document backup / snapshots | Infra (with the NAS admin) |
| Decryption key / repository password custody (two named people + break-glass) | IT + Management (password manager, EXT-23) |
| Quarterly restore drill run and evidence filed | Infra (a named operator), reviewed by Security |
| RPO/RTO agreed; standby-server risk accepted | Management (BCP/DR, EXT-29) |
| Retention aligned with legal/personal-data rules | Management (Legal, EXT-31) |
| Backup-failure alert and weekly review | IT + Management (EXT-22) |

---

## 10. Sequencing

- EXT-08 is a **30-day** item. It can proceed in parallel with the urgent IF-01 work but **after** the urgent
  deploy window (don't add moving parts to that window). The very first off-server encrypted copy should be taken
  as soon as the target and key exist, because today there is **no** off-server copy at all.
- The decryption key belongs in the password manager (EXT-23); set that up together.
- The quarterly restore drill is the evidence that the whole chain works — schedule the first one within the first
  quarter after setup, and after any change to PostgreSQL version, the dump format, or the migration chain.

---

**Reminder:** nothing here has been built. Until an off-server encrypted copy, an immutable/offline copy, a NAS
document backup, and one completed restore drill exist on the real infrastructure, IF-08 remains open.
