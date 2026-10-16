# 14 — CKAM Management Review Agenda

| | |
|---|---|
| Document | CKAM-ISMS-14, version 0.1, 2026-10-16 |
| Status | **DRAFT — MANAGEMENT APPROVAL REQUIRED.** No management review has been held |
| Owner (proposed) | ISMS Lead (prepares the pack and minutes); Management (chairs and decides) |
| Frequency | Yearly (first within 12 months, EXT-36); an extra short review after a SEV1 incident |
| Duration | About 90 minutes |
| Maps to | ISO/IEC 27001:2022 clause 9.3, clause 5.1, A.5.4; SOC 2 CC1.2, CC2.2, CC4.2, CC5.3 |

## 1. Attendees

Management (chair), CKAM System Owner, ISMS Lead, Dev Lead, IT / Infra lead; Legal and HR when their items are on the
agenda; the internal auditor for item 5.

## 2. Pack sent one week before (ISMS Lead)

Closure register status page, open decisions (`CKAM_SECURITY_DECISIONS_REQUIRED.md`), risk register changes,
internal audit report, incident list, access-review records, restore-drill records, vulnerability figures, supplier
review status, training figures, last year's minutes and actions.

## 3. Agenda

| # | Item | Input | Decision wanted |
|---|---|---|---|
| 1 | Actions from the last review | Action list | Close / re-plan each |
| 2 | Changes affecting CKAM's security | New companies (CKVPL), new features, hosting changes (HTTPS, VPN, service account), law (DPDP Act, CERT-In) | Note; update scope if needed |
| 3 | **Production exposure** | Closure register: anything OPEN — EXTERNAL; IF-01 status; HTTPS; internet forward | Approve deploys / funding |
| 4 | Open owner decisions | SD-01 … SD-16 still open, with recommendation | Decide or set a date |
| 5 | Internal audit results | Doc 13 report: NC / OBS | Accept actions |
| 6 | Incidents and nonconformities | Incident records, post-incident actions | Accept lessons |
| 7 | Monitoring results | Weekly log-review notes; LOCKED / RATE_LIMITED / PERMISSION_DENIED counts; Report-a-problem counts; uptime | Note trends |
| 8 | Access control | Four quarterly reviews; head-office admin count; leaver timeliness | Accept or act |
| 9 | Backup and continuity | Restore drill times vs RTO; off-server copy; reboot test | Accept "no standby" or fund one |
| 10 | Vulnerabilities and testing | Items vs deadlines (doc 06); external VAPT (SD-10) | Budget |
| 11 | Risk register and SoA | Changes since last review; risks above Medium; acceptances due | Approve register version; approve SoA changes |
| 12 | Suppliers | Supplier review results (doc 09) | Act on Critical / High gaps |
| 13 | People | Training completion; ISMS roles still filled; key-person dependency (R-24) | Name deputies |
| 14 | Resources and improvements | Effort and money needed for the next 12 months | Approve |
| 15 | Certification goal | ISO 27001 / SOC 2 ambition (SD-16) | Confirm or change |

## 4. Minutes template

| | |
|---|---|
| Date, place | |
| Attendees | |
| Decisions (numbered, each with owner and due date) | |
| Risk acceptances made (copied to `docs/ai/DECISIONS.md`) | |
| Changes to policies approved (document, version) | |
| Next review date | |
| Signed (chair) | |

## 5. What this does NOT yet prove

No review has been held; there are no minutes, decisions or approved resources. Holding the meeting will show that
management directs the ISMS; it will not show that the controls work (that needs the records from docs 03-11).
