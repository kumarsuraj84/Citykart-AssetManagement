# 15 — Statement of Applicability: WORKING DRAFT

| | |
|---|---|
| Document | CKAM-ISMS-15, version 0.1 |
| Status | **DRAFT — MANAGEMENT APPROVAL REQUIRED.** Working draft only. This is **NOT the official Statement of Applicability** |
| Owner (proposed) | ISMS Lead (to be appointed, EXT-36) |
| Approver | Management |
| Review | After the risk assessment is approved (doc 12), then yearly and after every major change |
| Source | Generated on 2026-10-16 from `docs/security/CKAM_ISO27001_CONTROL_MATRIX.csv` (the master copy, written 2026-10-15 at HEAD `d04779a`) by a script; the rows were not typed by hand |

> **Not a certification document.** CKAM is not ISO/IEC 27001 certified. A Statement of Applicability (SoA) is an
> ISMS document that management approves **after** the risk assessment and risk treatment plan (ISO/IEC 27001:2022
> clause 6.1.3 d). Neither has been approved yet. Until then this table is a working draft to help write it.

## In plain words

ISO 27001 has a list of 93 controls (Annex A). For each one the SoA says: does it apply to CKAM, why, and how far
it is done. Think of it as a checklist that the auditor reads first. This draft copies the facts from the control
matrix and adds which document of this policy pack covers the "people and process" side.

## How to read the columns

* **Applicable:** Y = applies; Y (partly) = applies to part of CKAM only; N = does not apply (with the reason).
* **Justification:** the risk(s) from the register in `CKAM_ISO27001_READINESS.md` section 9 (R-01 … R-33) that the
  control treats. Doc 12 says how that register is owned and reviewed.
* **Implementation status** = overall readiness from the matrix (READY / PARTIAL / MISSING / NOT EVIDENCED / N/A) ·
  technical-component tag. **These statuses describe 2026-10-15.** The security closure programme (from 2026-10-16)
  may change some technical tags; the matrix CSV stays the master and this file must be regenerated from it.
* **Policy in this pack:** the DRAFT document number(s) in `docs/security/policies/`. A DRAFT policy is **not** an
  operating control: no status in this table was raised because a policy draft now exists.
* **Control owner:** proposed owner role from the matrix (no person is named; management assigns people).

## Totals (computed from the CSV)

* Controls: 93
* Applicable (matrix values): YES 89 · PARTIAL 3 · NO 1
* Overall status: MISSING 13 · PARTIAL 42 · NOT EVIDENCED 31 · READY IN CODE - NOT DEPLOYED 1 · READY 5 · N/A 1

## Annex A working table

| Control | Title | Applicable | Justification | Implementation status | Main gap | Policy in this pack | Control owner (proposed) |
|---|---|---|---|---|---|---|---|
| A.5.1 | Policies for information security | Y | Treats R-24 (High), R-31 (Medium) | **MISSING** · NO TECH COMPONENT | Policy set exists only as DRAFT (15 documents, 0 approved, 0 communicated, 0 records); only the engineering guardrails operate | 01 | Management (CKAM owner) with ISMS lead (to appoint) |
| A.5.2 | Information security roles and responsibilities | Y | Treats R-24 (High) | **PARTIAL** · NO TECH COMPONENT | Roles are described in a DRAFT only; no one is appointed; operational security roles unassigned | 01 | Management |
| A.5.3 | Segregation of duties | Y | Treats R-23 (High), R-24 (High) | **PARTIAL** · TECH READY | One person writes code, commits and (with owner approval) deploys; no independent code review (IF-17) | 02, 04 | Management; Dev lead |
| A.5.4 | Management responsibilities | Y | Treats R-24 (High) | **NOT EVIDENCED** · NO TECH COMPONENT | No evidence of management direction on information security | 01, 14 | Management |
| A.5.5 | Contact with authorities | Y | Treats R-31 (Medium) | **NOT EVIDENCED** · NO TECH COMPONENT | No authority contact list or reporting procedure | 05 | Management; Legal |
| A.5.6 | Contact with special interest groups | Y | Treats R-15 (Medium), R-17 (High) | **NOT EVIDENCED** · NO TECH COMPONENT | No subscriptions evidenced | 06 | IT/Infra |
| A.5.7 | Threat intelligence | Y | Treats R-15 (Medium) | **MISSING** · TECH PARTIAL | Only one-off scans (2026-10-15/16); the monthly advisory review exists only in DRAFT doc 06 and has never run | 06 | Dev lead; IT/Infra |
| A.5.8 | Information security in project management | Y | Treats R-23 (High) | **PARTIAL** · TECH PARTIAL | Security is applied by practice, not by a mandatory project step | 04, 12 | Dev lead |
| A.5.9 | Inventory of information and other associated assets | Y | Treats R-11 (Medium) | **PARTIAL** · TECH PARTIAL | No formal information-asset register with owners and classification | 01, 12 | ISMS lead; IT/Infra |
| A.5.10 | Acceptable use of information and other associated assets | Y | Treats R-30 (Medium), R-11 (Medium) | **NOT EVIDENCED** · NO TECH COMPONENT | No acceptable-use policy evidenced | 01, 10 | HR; Management |
| A.5.11 | Return of assets | Y | Treats R-09 (Medium) | **PARTIAL** · TECH READY | Leaver process linking HR and CKAM not evidenced | 03 | HR; IT |
| A.5.12 | Classification of information | Y | Treats R-11 (Medium) | **MISSING** · TECH PARTIAL | No classification scheme | 01 | ISMS lead |
| A.5.13 | Labelling of information | Y | Treats R-11 (Medium) | **MISSING** · TECH MISSING | Exports are unlabelled | 01 | Dev lead; ISMS lead |
| A.5.14 | Information transfer | Y | Treats R-01 (High), R-11 (Medium) | **PARTIAL** · TECH PARTIAL | Transfer over the internet is unencrypted; no transfer rules | 01 | IT; ISMS lead |
| A.5.15 | Access control | Y | Treats R-04 (High), R-10 (Medium) | **PARTIAL** · TECH READY | Access-control policy is DRAFT only; D6 open; AC-1, AC-2, IF-03 fixes not deployed (production 3b5e842) | 02 | Management; Dev lead |
| A.5.16 | Identity management | Y | Treats R-30 (Medium), R-16 (Medium) | **PARTIAL** · TECH PARTIAL | No JML procedure; store logins are shared identities | 02, 03 | HR; IT |
| A.5.17 | Authentication information | Y | Treats R-05 (High), R-01 (High), R-03 (Critical) | **PARTIAL** · TECH PARTIAL | Plaintext transport; server secrets handling not formalised; new policy not yet deployed | 02 | IT; Dev lead |
| A.5.18 | Access rights | Y | Treats R-04 (High), R-16 (Medium) | **PARTIAL** · TECH PARTIAL | No periodic access review; grants have no request/approval record | 02, 03, 11 | CKAM owner (head-office admin) |
| A.5.19 | Information security in supplier relationships | Y | Treats R-26 (Medium), R-08 (Medium) | **MISSING** · NO TECH COMPONENT | No operating supplier security process (DRAFT doc 09 only) | 09 | Management; IT |
| A.5.20 | Addressing information security within supplier agreements | Y | Treats R-26 (Medium) | **NOT EVIDENCED** · NO TECH COMPONENT | No agreements evidenced | 09 | Management; Legal |
| A.5.21 | Managing information security in the ICT supply chain | Y | Treats R-15 (Medium) | **PARTIAL** · TECH PARTIAL | Production deploy not yet wired to constraints.txt (the reference deploy script is, but has never run on 10.0.1.98: EXT-12, EXT-13); PyJWT migration open | 06, 09 | Dev lead |
| A.5.22 | Monitoring, review and change management of supplier services | Y | Treats R-08 (Medium) | **PARTIAL** · TECH PARTIAL | No scheduled review; grant-loss risk documented but not monitored | 09 | IT; ERP warehouse owner |
| A.5.23 | Information security for use of cloud services | Y (partly) | Partly applicable. Treats R-26 (Medium), R-29 (Low) | **NOT EVIDENCED** · NO TECH COMPONENT | Repository ownership, visibility and MFA not evidenced; no cloud-use rules | 09 | Management; Dev lead |
| A.5.24 | Information security incident management planning and preparation | Y | Treats R-27 (High), R-02 (Critical) | **MISSING** · TECH PARTIAL | Incident response plan exists only as DRAFT; never approved or exercised | 05 | ISMS lead; IT |
| A.5.25 | Assessment and decision on information security events | Y | Treats R-27 (High) | **MISSING** · TECH PARTIAL | Triage criteria exist only as DRAFT; no triage record | 05 | ISMS lead |
| A.5.26 | Response to information security incidents | Y | Treats R-02 (Critical), R-03 (Critical) | **MISSING** · NO TECH COMPONENT | IF-01 production exposure not contained (nothing deployed, no secret rotated, no compromise assessment, no incident record) | 05 | ISMS lead; IT |
| A.5.27 | Learning from information security incidents | Y | Treats R-23 (High) | **PARTIAL** · TECH PARTIAL | Lessons captured informally | 05 | ISMS lead; Dev lead |
| A.5.28 | Collection of evidence | Y | Treats R-12 (Medium) | **PARTIAL** · TECH PARTIAL | Evidence integrity not protected against the DB owner; no off-server copy | 05 | ISMS lead; IT |
| A.5.29 | Information security during disruption | Y | Treats R-13 (High) | **MISSING** · NO TECH COMPONENT | Addressed only in a DRAFT plan; not approved or tested | 08 | ISMS lead; IT |
| A.5.30 | ICT readiness for business continuity | Y | Treats R-13 (High), R-14 (High) | **PARTIAL** · TECH PARTIAL | No agreed recovery objectives; never restored in production | 08 | IT/Infra; Management |
| A.5.31 | Legal, statutory, regulatory and contractual requirements | Y | Treats R-31 (Medium) | **NOT EVIDENCED** · NO TECH COMPONENT | No legal register | 01, 12 | Legal; Management |
| A.5.32 | Intellectual property rights | Y | Treats R-15 (Medium) | **NOT EVIDENCED** · NO TECH COMPONENT | Licences not reviewed | 06, 09 | Dev lead |
| A.5.33 | Protection of records | Y | Treats R-12 (Medium), R-13 (High) | **PARTIAL** · TECH PARTIAL | Owner/superuser can still destroy records; backups not off-server | 07 | Management; DBA |
| A.5.34 | Privacy and protection of personal identifiable information (PII) | Y | Treats R-11 (Medium), R-31 (Medium) | **PARTIAL** · TECH PARTIAL | No privacy notice or PII retention rule | 01 | Legal; Management; Dev lead |
| A.5.35 | Independent review of information security | Y | Treats R-23 (High) | **MISSING** · NO TECH COMPONENT | No independent review | 13 | Management |
| A.5.36 | Compliance with policies, rules and standards for information security | Y | Treats R-23 (High) | **PARTIAL** · TECH PARTIAL | Policies to comply with do not exist yet | 13 | ISMS lead |
| A.5.37 | Documented operating procedures | Y | Treats R-23 (High) | **PARTIAL** · TECH PARTIAL | Live launcher not in git and not compared with the reference; runbooks prepared but never executed or confirmed by IT | 04, 07, 08 | IT/Infra; Dev lead |
| A.6.1 | Screening | Y | Treats R-04 (High) | **NOT EVIDENCED** · NO TECH COMPONENT | Not evidenced | 03 | HR |
| A.6.2 | Terms and conditions of employment | Y | Treats R-04 (High) | **NOT EVIDENCED** · NO TECH COMPONENT | Not evidenced | 03 | HR |
| A.6.3 | Information security awareness, education and training | Y | Treats R-05 (High), R-30 (Medium) | **NOT EVIDENCED** · NO TECH COMPONENT | Not evidenced | 10 | HR; ISMS lead |
| A.6.4 | Disciplinary process | Y | Treats R-09 (Medium) | **NOT EVIDENCED** · NO TECH COMPONENT | Not evidenced | 03 | HR |
| A.6.5 | Responsibilities after termination or change of employment | Y | Treats R-16 (Medium), R-19 (Medium) | **PARTIAL** · TECH READY | No HR trigger to CKAM | 03 | HR; CKAM owner |
| A.6.6 | Confidentiality or non-disclosure agreements | Y | Treats R-11 (Medium) | **NOT EVIDENCED** · NO TECH COMPONENT | Not evidenced | 03 | HR; Legal |
| A.6.7 | Remote working | Y | Treats R-18 (Critical), R-01 (High) | **MISSING** · TECH MISSING | Remote access is open and unencrypted | 02 | IT/Infra; Management |
| A.6.8 | Information security event reporting | Y | Treats R-27 (High) | **PARTIAL** · TECH READY | Channel for security events not communicated | 05, 10 | ISMS lead; HR |
| A.7.1 | Physical security perimeters | Y | Treats R-28 (High) | **NOT EVIDENCED** · NO TECH COMPONENT | Not evidenced | 08 (inherited) | Facilities; IT/Infra |
| A.7.2 | Physical entry | Y | Treats R-28 (High) | **NOT EVIDENCED** · NO TECH COMPONENT | Not evidenced | 08 (inherited) | Facilities |
| A.7.3 | Securing offices, rooms and facilities | Y | Treats R-28 (High) | **NOT EVIDENCED** · NO TECH COMPONENT | Not evidenced | 08 (inherited) | Facilities |
| A.7.4 | Physical security monitoring | Y | Treats R-28 (High) | **NOT EVIDENCED** · NO TECH COMPONENT | Not evidenced | 08 (inherited) | Facilities |
| A.7.5 | Protecting against physical and environmental threats | Y | Treats R-28 (High) | **NOT EVIDENCED** · NO TECH COMPONENT | Not evidenced | 08 (inherited) | Facilities |
| A.7.6 | Working in secure areas | Y | Treats R-28 (High) | **NOT EVIDENCED** · NO TECH COMPONENT | Not evidenced | 08 (inherited) | Facilities; IT |
| A.7.7 | Clear desk and clear screen | Y | Treats R-30 (Medium) | **NOT EVIDENCED** · TECH PARTIAL | Endpoint screen-lock not evidenced | 10 | HR; IT |
| A.7.8 | Equipment siting and protection | Y | Treats R-28 (High) | **NOT EVIDENCED** · NO TECH COMPONENT | Not evidenced | 08 (inherited) | Facilities; IT |
| A.7.9 | Security of assets off-premises | Y | Treats R-25 (Medium) | **NOT EVIDENCED** · TECH PARTIAL | Device protection rules not evidenced | 01 | IT; HR |
| A.7.10 | Storage media | Y | Treats R-13 (High), R-25 (Medium) | **MISSING** · TECH MISSING | Unencrypted backup media; dev dumps on dev PC | 07 | IT/Infra |
| A.7.11 | Supporting utilities | Y | Treats R-28 (High) | **NOT EVIDENCED** · NO TECH COMPONENT | Not evidenced | 08 (inherited) | Facilities; IT |
| A.7.12 | Cabling security | Y | Treats R-28 (High) | **NOT EVIDENCED** · NO TECH COMPONENT | Not evidenced | 08 (inherited) | Facilities |
| A.7.13 | Equipment maintenance | Y | Treats R-28 (High) | **NOT EVIDENCED** · TECH PARTIAL | Not evidenced for CKAM servers | 08 | IT/Infra |
| A.7.14 | Secure disposal or re-use of equipment | Y | Treats R-11 (Medium) | **NOT EVIDENCED** · TECH PARTIAL | Wiping not evidenced | 01 | IT; Facilities |
| A.8.1 | User end point devices | Y | Treats R-25 (Medium) | **NOT EVIDENCED** · TECH NOT EVIDENCED | Endpoints not evidenced; dev PC ACL gap | 01 | IT |
| A.8.2 | Privileged access rights | Y | Treats R-04 (High), R-07 (High), R-12 (Medium) | **PARTIAL** · TECH PARTIAL | Privileged paths not minimised in production: role split not run on 10.0.0.205 (EXT-07, EXT-45), service still SYSTEM (EXT-06), no MFA, D6 open | 02, 11 | CKAM owner; IT/Infra; DBA |
| A.8.3 | Information access restriction | Y | Treats R-10 (Medium) | **READY IN CODE - NOT DEPLOYED** · TECH READY | Only deployment is missing: production 3b5e842 still has AC-1, AC-2 and IF-03 (counted PARTIAL for production readiness) | 02 | Dev lead |
| A.8.4 | Access to source code | Y | Treats R-26 (Medium) | **NOT EVIDENCED** · TECH NOT EVIDENCED | Repository control not evidenced | 02, 04 | Management; Dev lead |
| A.8.5 | Secure authentication | Y | Treats R-05 (High), R-01 (High), R-19 (Medium) | **PARTIAL** · TECH PARTIAL | Plain HTTP; no MFA; no absolute session lifetime decision; fixes not deployed | 02 | Dev lead; IT |
| A.8.6 | Capacity management | Y | Treats R-21 (Medium) | **PARTIAL** · TECH PARTIAL | No capacity monitoring | 08 | IT/Infra |
| A.8.7 | Protection against malware | Y | Treats R-14 (High), R-22 (Low) | **PARTIAL** · TECH PARTIAL | Server and NAS malware protection not evidenced | 06 | IT/Infra |
| A.8.8 | Management of technical vulnerabilities | Y | Treats R-02 (Critical), R-17 (High), R-15 (Medium) | **PARTIAL** · TECH PARTIAL | CRITICAL IF-01 still exposed in production until deploy + secret rotation; no scheduled scanning; SLAs only in DRAFT doc 06 | 06 | Dev lead; IT/Infra |
| A.8.9 | Configuration management | Y | Treats R-23 (High), R-20 (Medium) | **PARTIAL** · TECH PARTIAL | Server configuration not baselined | 04 | IT/Infra; Dev lead |
| A.8.10 | Information deletion | Y | Treats R-31 (Medium), R-11 (Medium) | **PARTIAL** · TECH PARTIAL | No retention schedule for business data or audit | 01, 07 | Management; Legal |
| A.8.11 | Data masking | Y (partly) | Partly applicable. Treats R-03 (Critical) | **READY** · TECH READY | None for secret masking | 01 | Dev lead |
| A.8.12 | Data leakage prevention | Y | Treats R-11 (Medium), R-01 (High) | **PARTIAL** · TECH PARTIAL | No DLP; transport not encrypted | 01 | ISMS lead |
| A.8.13 | Information backup | Y | Treats R-13 (High), R-14 (High) | **PARTIAL** · TECH PARTIAL | Single-location unencrypted backups | 07 | IT/Infra |
| A.8.14 | Redundancy of information processing facilities | Y | Treats R-13 (High) | **MISSING** · TECH MISSING | No redundancy and no documented acceptance | 08 | Management; IT/Infra |
| A.8.15 | Logging | Y | Treats R-12 (Medium), R-27 (High) | **PARTIAL** · TECH PARTIAL | Logs not protected or shipped off-server; 180-day retention of error/system/client rows; nothing of the closure deployed | 05 | Dev lead; IT/Infra |
| A.8.16 | Monitoring activities | Y | Treats R-27 (High) | **PARTIAL** · TECH PARTIAL | No active monitoring | 05 | IT; CKAM owner |
| A.8.17 | Clock synchronization | Y | Treats R-12 (Medium) | **NOT EVIDENCED** · TECH NOT EVIDENCED | Not evidenced | 06 | IT/Infra |
| A.8.18 | Use of privileged utility programs | Y | Treats R-12 (Medium), R-06 (High) | **NOT EVIDENCED** · TECH NOT EVIDENCED | Not evidenced | 02 | IT/Infra; DBA |
| A.8.19 | Installation of software on operational systems | Y | Treats R-15 (Medium) | **PARTIAL** · TECH PARTIAL | Unpinned Python installs | 04, 06 | Dev lead; IT |
| A.8.20 | Networks security | Y | Treats R-18 (Critical), R-01 (High), R-08 (Medium) | **PARTIAL** · TECH PARTIAL | Internet exposure without TLS | 01, 02 | IT/Infra |
| A.8.21 | Security of network services | Y | Treats R-01 (High), R-08 (Medium) | **PARTIAL** · TECH PARTIAL | No TLS on any production link; production launcher flag (N2) not applied; no service hardening record | 01, 02 | IT/Infra |
| A.8.22 | Segregation of networks | Y | Treats R-06 (High), R-18 (Critical) | **NOT EVIDENCED** · TECH NOT EVIDENCED | Not evidenced; shared hosts | 01 | IT/Infra |
| A.8.23 | Web filtering | N | Not applicable to the CKAM application: outbound web filtering is a CityKart corporate network control outside this scope | **N/A** · NO TECH COMPONENT | N/A | — | IT (corporate) |
| A.8.24 | Use of cryptography | Y | Treats R-01 (High), R-03 (Critical), R-13 (High) | **PARTIAL** · TECH PARTIAL | No encryption in transit; no key management | 01 | IT/Infra; Dev lead |
| A.8.25 | Secure development life cycle | Y | Treats R-23 (High) | **PARTIAL** · TECH PARTIAL | Rules depend on discipline, not automation | 04 | Dev lead |
| A.8.26 | Application security requirements | Y | Treats R-23 (High) | **PARTIAL** · TECH PARTIAL | Baseline not yet approved | 04 | Dev lead; Management |
| A.8.27 | Secure system architecture and engineering principles | Y | Treats R-07 (High), R-01 (High) | **PARTIAL** · TECH PARTIAL | Runtime privilege and transport design weak | 04 | Dev lead |
| A.8.28 | Secure coding | Y | Treats R-02 (Critical), R-21 (Medium) | **READY** · TECH READY | Production still runs code without these fixes (tracked under A.8.8 / EXT-01) | 04, 06 | Dev lead |
| A.8.29 | Security testing in development and acceptance | Y | Treats R-23 (High) | **READY** · TECH READY | No schedule yet for repeating the battery | 04, 06 | Dev lead |
| A.8.30 | Outsourced development | Y (partly) | Partly applicable. Treats R-23 (High), R-03 (Critical) | **PARTIAL** · TECH PARTIAL | No written rule for AI-assisted development | 04, 09 | Management; Dev lead |
| A.8.31 | Separation of development, test and production environments | Y | Treats R-03 (Critical) | **READY** · TECH READY | Independence of production secrets not re-verified | 04 | Dev lead; IT |
| A.8.32 | Change management | Y | Treats R-23 (High) | **PARTIAL** · TECH PARTIAL | Approvals and results not recorded as evidence | 04 | Dev lead; CKAM owner |
| A.8.33 | Test information | Y | Treats R-25 (Medium) | **PARTIAL** · TECH PARTIAL | Real ERP data on the dev PC | 04 | Dev lead; ISMS lead |
| A.8.34 | Protection of information systems during audit testing | Y | Supporting control (no risk link in the matrix; it keeps security testing from harming production) | **READY** · TECH READY | None | 13 | CKAM owner |

## What this does NOT yet prove

* It does not prove any control operates. 0 of the policies it points to are approved; none has produced a record.
* Applicability is the matrix author's proposal; management has not accepted it, and it rests on a risk register that
  has no approved owner (doc 12).
* Physical (A.7) and HR (A.6) controls are marked NOT EVIDENCED because they are CityKart-wide controls that were not
  seen, not because they are known to be missing.
* Nothing here reflects production changes: on 2026-10-16 production still runs release `3b5e842` with the CRITICAL
  IF-01 exposure (see `CKAM_SECURITY_CLOSURE_REGISTER.md`).

## To turn this into the real SoA

1. Management appoints the ISMS Lead and approves the scope (`CKAM_ISO27001_READINESS.md` section 2.1).
2. The risk register is approved with owners (doc 12); every "Treats R-xx" link is re-checked.
3. Each N or Y (partly) is confirmed in writing by management.
4. Implementation status is re-taken from the then-current matrix and the closure register.
5. The approved SoA gets a version number, date and signature; this working draft is kept as history.
