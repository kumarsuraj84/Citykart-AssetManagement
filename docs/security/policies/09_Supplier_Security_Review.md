# 09 — CKAM Supplier Security Review

| | |
|---|---|
| Document | CKAM-ISMS-09, version 0.1, 2026-10-16 |
| Status | **DRAFT — MANAGEMENT APPROVAL REQUIRED.** The register below is a first list; no supplier has been reviewed |
| Owner (proposed) | ISMS Lead (register); IT / Infra and Dev Lead (technical checks) |
| Approver | Management |
| Review | Yearly per supplier; and before adding a new supplier or a new kind of data shared |
| Maps to | ISO A.5.19-5.23, A.5.32, A.8.30; SOC 2 CC9.2, CC3.4; EXT-25, EXT-28, EXT-34 |

## 1. Purpose

Know every outside party (or other internal team) that CKAM depends on or shares data with, how bad it would be if
they failed or were breached, and what we checked.

## 2. Register (first list)

| Supplier / party | What they provide | CKAM data they hold or see | Criticality | Key security questions | Evidence to collect | Today |
|---|---|---|---|---|---|---|
| **ERP warehouse owner** (internal team; 10.0.1.69, role `ckpost`) | PO, vendor, item, receipt and PI data (read-only) | None of CKAM's; they hold the source data CKAM copies | High (data source) | Is `ckpost` SELECT-only on the views? Read-only set on the role? TLS (`hostssl`)? Who changes the views and how are we told? | Grant listing, role settings, `pg_stat_ssl` (EXT-25); a named contact | Not evidenced; CKAM enforces read-only on its own connection |
| **CityKart IT / Infra** (hosting: 10.0.1.98, 10.0.0.205, NAS 10.0.0.25, router) | Servers, database, file share, network, backups | Everything | Critical | Patching, antivirus/EDR, admin accounts, physical room, backup copies, shared-server separation from Spinwheel and Citykart Desk | Patch reports, EDR console, account list, server-room checklist (EXT-09, EXT-24, EXT-29, EXT-37) | Internal, not evidenced |
| **NAS vendor / support** | NAS hardware and firmware | Documents (if support has remote access) | Medium | Remote support access? Firmware updates? Snapshot / antivirus features? | Support contract terms; firmware level | Not evidenced |
| **Internet provider / router** | Public address, port forward of 3211 | Traffic (plain HTTP today) | Medium | Who can change the router? Config backup? | Router config export (EXT-05) | Not evidenced |
| **GitHub** | Source code hosting (`origin`) | All source code and history (no secrets found in 282 scanned commits) | High | Repository owned by a CityKart organisation? Private? MFA for all members? Branch protection? Who has access? | Settings screenshot (EXT-28) | Personal account; not evidenced |
| **Package registries** (PyPI for Python, npm for the frontend) | Third-party code that runs inside CKAM | None directly; their code runs with CKAM's rights | High | Pinned versions (`backend/constraints.txt`, `frontend/package-lock.json`); monthly audits (doc 06); licence check | Audit outputs, `pip freeze` per release | Pins exist; production install not yet pinned (EXT-12); licences not reviewed |
| **Google Fonts** | Two web fonts | Every user's IP address on each page load | Low | Remove by self-hosting (FONTS, EXT-11) | Browser network check shows no Google request | Open (code-fixable) |
| **AI coding assistant provider** (Anthropic; commits carry a `Co-Authored-By: Claude …` trailer) | Help writing and testing code on the dev PC | Source code and whatever is shown in the session (dev data; must never include production data or secrets) | Medium | Data-use and retention terms for the plan in use; account owner; rule "no production data or secrets in prompts" (doc 01 §6); human review of every change | Plan / terms record; the rule acknowledged by the developer | Not evidenced |
| **Certificate authority** (after SD-05) | HTTPS certificate | Domain name only | Medium | Renewal method; who holds the account | Renewal calendar | Not started |
| **External VAPT firm** (after SD-10) | Independent test | Test accounts, possibly production data seen during the test | Medium | NDA, scope, data handling, CERT-In empanelment | Signed scope, NDA, report | Not started |

## 3. Review steps (per supplier, yearly)

1. Confirm the contact and what CKAM data they hold or see.
2. Rate criticality (Critical / High / Medium / Low) and data sensitivity (doc 01 §5).
3. Ask or check the key questions; collect the evidence listed.
4. Note gaps and actions with owners and dates; send the critical ones to the risk register (doc 12).
5. For a new supplier: do steps 1-4 **before** sharing data; Management approves Critical / High suppliers.

## 4. Evidence this procedure would produce

The register with a review date per row, collected evidence files, contract / terms references, actions.

## 5. What this does NOT yet prove

* No supplier has been reviewed; no contract or terms have been read for security clauses.
* The internal teams (IT, ERP warehouse) have no written agreement with CKAM about what they provide.
* The list may be incomplete (for example antivirus vendor, e-mail, the password manager once chosen).
