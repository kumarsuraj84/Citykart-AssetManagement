# CKAM — The GitHub repository is PUBLIC: push options for the owner

| | |
|---|---|
| Status | **PREPARED — OWNER DECISION PENDING.** Nothing here has been done. No visibility has been changed and nothing has been pushed. Every command is `NOT EXECUTED` |
| Date | 2026-10-17 |
| Repository | `kumarsuraj84/Citykart-AssetManagement` on GitHub, default branch `claude/brave-euler-07879a` (no branch is literally called `main`). **Visibility: PUBLIC** (verified 2026-10-16: the unauthenticated GitHub API and the web page both answered HTTP 200) |
| Local state | Branch `worktree-ckam-build`, **23 local commits** ahead of `origin` (`c66378d`) at the time of writing, plus the rebuild commit(s) that produce `<RELEASE-SHA>` (count `TO BE FILLED BY LEAD`). They contain the IF-01 fix **and** the security evidence (`docs/security/evidence/**`, working attack examples against the live layout, internal addresses and paths) |
| Production | 10.0.1.98 still runs `3b5e842` with **IF-01 open**. A push does not deploy anything; the deploy is a local package (`CKAM_URGENT_PRODUCTION_SECURITY_RUNBOOK.md`) |
| Rules that apply to every option | **No force-push. No rebase. No history rewriting.** "Commit and push to git and main" means push only, to `origin`, for that change only (`CLAUDE.md`). Never add the untracked `docs/ai/CKAM_DEMO_WALKTHROUGH.md` / `docs/ai/demo-screens/` (they contain a demo password). Nothing already public can be made secret again by rewriting history |

## 1. In plain words

Anyone on the internet can read this repository. If we push now, the internet gets a written description of the hole
in the live server, with examples, **while the live server still has the hole**. So the question is not *whether* to
push, but *in which order*.

Example: you would not pin the note "the back door lock is broken, here is how to open it" on the street notice
board before the lock is fixed.

What is **already** public stays public: the code up to `c66378d` (which contains the IF-01 bug itself, though not
the explanation). Copies, forks, caches and search-engine snapshots of what was public cannot be called back.
Making the repository private, or rewriting history, does not remove copies that already exist.

## 2. The three options

### Option A — RECOMMENDED: deploy → verify → rotate → compromise check → push

| | |
|---|---|
| What | Follow the runbook: deploy `<RELEASE-SHA>` (steps A–G), verify (H), rotate the four secrets (I, J), start the compromise check (K) with the evidence preserved, **then** push all local commits unchanged (step N) |
| Risk | Lowest. When the details become public, the live server no longer has the hole and the old secrets no longer work. Remaining risk: the published detail helps attack **other** unpatched copies (none known) and shows the internal layout (addresses, paths) — a lasting but lower-grade exposure |
| Benefit | No special handling, no second repository, no awkward branch. The pushed history is the real, reviewed history. The evidence is published only after it is harmless to production |
| Operational consequence | The code stays only on the dev PC until the deploy is verified (single copy: IF-09 / EXT-10 risk on that PC). Back it up locally in the meantime (e.g. a `git bundle` to an encrypted, admin-only drive) — no push needed |
| Effort | None beyond the runbook. The push itself is one command (`NOT EXECUTED`): `git push origin worktree-ckam-build:claude/brave-euler-07879a` |

### Option B — make the repository private first → push → deploy

| | |
|---|---|
| What | The owner changes visibility on GitHub, then pushes, then deploys as in the runbook |
| How (owner, on github.com; `NOT EXECUTED`) | Repository → **Settings** → **General** → scroll to **Danger Zone** → **Change visibility** → **Make private** → confirm by typing the repository name. Only an owner/admin of the repository can do it |
| What private DOES | New visitors and the anonymous API can no longer read the repository or anything pushed afterwards. Stars and watchers of people without access are removed |
| What private does NOT do | It does not remove copies already made: existing **clones**, downloaded zips, mirrors, search-engine and archive caches of the public pages stay out there. **Public forks**: when a public repository is made private, existing public forks are detached and **stay public** (they hold the history as it was when forked — the bug, not the new evidence). Anything pushed **before** the switch is as exposed as in option A-before-deploy |
| Pages / Actions | The repository has no `.github/` folder (no workflows) and no GitHub Pages site is documented, so nothing is known to break. If GitHub Pages were enabled, on a free personal account it stops for a private repository; private Actions use paid minutes. Confirm in Settings → Pages / Actions (`OWNER / INFRA CONFIRMATION REQUIRED`) |
| Risk | Low for the new commits, **provided the visibility change is done and checked before the push** (check from a signed-out browser: the repository page must answer 404). Residual: anyone who already has access (collaborators) sees the evidence; forks/caches of the old public state remain |
| Benefit | The code is safely off the dev PC before the deploy; the order of deploy and push no longer matters for the new commits |
| Operational consequence | Anyone who used the public repository (scripts, people without an account) loses access; collaborators must be invited. Making it public again later is a fresh decision (and makes everything visible at once) |
| Effort | A few minutes for the owner on GitHub, plus a signed-out check. Then the normal push |

### Option C — push the code only, keep the sensitive security evidence out until production is fixed

| | |
|---|---|
| What to keep out | `docs/security/evidence/**` (attack scripts, probe lists, raw outputs, layout details); the attack-detail sections of the registers, the master handover, the VAPT report, the complete report and the final closure report (the IF-01 payload descriptions and the live layout); the gate rehearsal evidence. **Fine to push:** the code (`backend/`, `frontend/`), `ops/` scripts, tests, and non-sensitive docs |
| The honest problem | The **23 existing local commits already contain the evidence**, mixed with the code in the same commits. Pushing "the code commits" means pushing those commits, evidence included. Without rewriting history (not allowed) the only way is to build a **new** branch whose commits are new: e.g. a branch started from `origin` (`c66378d`) with one new commit that adds the code/tree state of `<RELEASE-SHA>` minus the sensitive paths, pushed instead of the real branch |
| Practical ways (no history rewrite, no force-push) | **C1:** a second, **private** repository for the evidence (and later the real history), while the public one gets the new code-only branch. **C2:** a separate code-only branch/commit series on the public repository, built from `c66378d` by copying the files (not by rebasing). Later, after the deploy, the real branch is pushed as well, normally merged into the default branch with a merge commit; from then on both histories exist side by side in the repository |
| What it costs | The public history no longer matches the reviewed local history (commit ids differ; reviews, evidence and the change record refer to `<RELEASE-SHA>`, which would not be on GitHub). Two histories to reconcile later (merge commit or a second branch). A manual, error-prone selection of paths: one missed file publishes the detail anyway. The test evidence for the published code is not where the code is. The code itself still shows the fix, and a fix diff is a strong hint of the bug, so the protection is partial |
| Risk | Medium: the fix in the code is a pointer to the hole for a skilled reader, and the path selection can be wrong |
| Benefit | The code is backed up on GitHub before the deploy without publishing the ready-made attack examples |
| Effort | Highest: building and checking the code-only tree, a second repository or branch, later reconciliation, and documentation that explains the two histories |

## 3. Comparison

| | A (recommended) | B (private first) | C (code only) |
|---|---|---|---|
| Exposure of the attack detail while production is open | none | none for new commits (if checked before the push) | partial (the fix diff hints at the bug) |
| Copies already public | stay | stay (incl. public forks) | stay |
| History rewritten | no | no | no (a new branch, not a rewrite) |
| Matches the reviewed history | yes | yes | **no** |
| Code off the dev PC before the deploy | no (local backup only) | yes | yes |
| Effort | lowest | low | high |

## 4. Recommendation and the decision needed

**Option A.** The deploy does not need a push, so waiting costs nothing for production. Make a local, encrypted
backup of the repository on the day (no push). If the owner wants the code on GitHub before the deploy, **Option B**
is better than C (simpler, and it keeps one honest history), provided the private setting is checked from a
signed-out browser before the push.

The owner answers, for example: "Push option: A". The push itself still needs the push phrase for that change.
This document does not change visibility and does not push.

**Status: PREPARED — OWNER DECISION PENDING. Nothing executed.**
