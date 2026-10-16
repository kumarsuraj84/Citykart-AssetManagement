# 12 — CKAM Risk Management Procedure

| | |
|---|---|
| Document | CKAM-ISMS-12, version 0.1, 2026-10-16 |
| Status | **DRAFT — MANAGEMENT APPROVAL REQUIRED.** The risk register exists as a draft; it has no approved owner |
| Owner (proposed) | ISMS Lead (method and register); each risk has its own owner role |
| Approver | Management (method, register, every risk acceptance) |
| Review | Register: at least yearly, and after each trigger in §4. Method: yearly |
| Maps to | ISO/IEC 27001:2022 clauses 6.1.2, 6.1.3, 8.2, 8.3; A.5.8, A.5.31; SOC 2 CC3.1-CC3.4, CC9.1; EXT-36 |

## 1. The register

The single CKAM risk register is **`docs/security/CKAM_ISO27001_READINESS.md` section 9**: **33 risks, R-01 to
R-33** (3 Critical, 12 High, 14 Medium, 4 Low on 2026-10-15; scores describe production as it runs, release
`3b5e842`). This procedure does not copy it; it says how it is kept.

Note: `CKAM_SOC2_READINESS.md` (CC3) still says "31 risks"; R-32 (N2) and R-33 (NAT and the sign-in limit) were
added later. The ISO file is the master.

## 2. Method (as already used in the register)

* **Likelihood** 1 rare … 5 almost certain; **Impact** 1 negligible … 5 severe; **Risk = L × I**.
* Bands: 1-4 Low, 5-9 Medium, 10-16 High, 20-25 Critical.
* **Inherent** score = production today; **residual** score = after the listed treatment, including deployment.
* Every risk names: linked findings, existing controls (marked *code, not deployed* where true), treatment, owner
  role, residual.

## 3. Treatment and acceptance

| Option | When | Who decides |
|---|---|---|
| Reduce | Default for High and Critical | Owner proposes; Management funds |
| Avoid | Stop the activity (e.g. close the internet forward, SD-04) | Management |
| Transfer | Insurance or a supplier commitment | Management |
| Accept | Only Low, or Medium with a written reason and review date; never Critical | **Management in writing** in `docs/ai/DECISIONS.md`, recorded in the register |

Criteria (proposed): no Critical may stay without a dated treatment; High needs a treatment plan within 30 days;
residual target for all risks is Medium or below (the register's treatments reach a highest residual of 8).

## 4. Triggers for a review between yearly reviews

* A new or re-classified finding in `CKAM_SECURITY_CLOSURE_REGISTER.md` (for example IF-01 deployed → R-02, R-03
  inherent scores fall).
* A security-relevant change (doc 04 change type) or a new supplier (doc 09).
* An incident (doc 05) or an internal audit finding (doc 13).
* An owner decision in `CKAM_SECURITY_DECISIONS_REQUIRED.md` (SD-01 … SD-16).
* A change of hosting (new server, HTTPS, VPN).

## 5. Steps of a review

1. ISMS Lead takes the register, the closure register and the open decisions.
2. For each risk, the owner confirms or updates L, I, controls (only controls **running in production** lower the
   inherent score), treatment status and due date.
3. New risks are added with the next free id (R-34 …); closed risks are marked closed, never deleted.
4. Management approves the updated register (date and name) and any acceptance.
5. The Statement of Applicability working draft (doc 15) is re-checked against the changed risks.

## 6. Evidence this procedure would produce

Approved register versions with dates (git history of the readiness file or a dated copy), review minutes, risk
acceptance entries in `docs/ai/DECISIONS.md`, treatment actions with closure evidence.

## 7. What this does NOT yet prove

* The register has never been approved, no owner has accepted a risk, and no review has been held.
* Owner columns name roles, not people.
* The inherent scores are judgement by the engineering team, not yet challenged by Management or an independent
  reviewer.
