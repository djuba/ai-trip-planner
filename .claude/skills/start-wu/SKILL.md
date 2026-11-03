---
name: start-wu
description: Run the branch → plan → plan review → approve → orchestrate → verify → implementation review → approve → commit → pull request workflow for one work unit from docs/work-breakdown.md. Invoke as /start-wu WU-xx.
argument-hint: WU-xx
disable-model-invocation: true
---

# Start work unit $ARGUMENTS

Follow these phases in order. **Phases 1 and 4 end with a hard stop:** do not continue until the user explicitly approves.

## Phase 0 — Preconditions
- Read the $ARGUMENTS entry in `docs/work-breakdown.md`.
- Confirm `git status` is clean. If it isn't, stop and show the user what's there.
- Update `main`: `git switch main && git pull --ff-only`. A unit is `done` only once its pull request is merged, so dependency status must be read from an up-to-date `main`.
- Confirm every unit in its Depends-on is `done` on `main`. If not, stop and say which are not.
- Create the unit's branch from `main`: `git switch -c wu/$ARGUMENTS-<slug>`, where `<slug>` is the unit's title in kebab-case (e.g. `wu/WU-02-quality-gates`). All of the unit's work happens on this branch; never commit to `main` directly.
- If another Claude Code session is already using this checkout, work in a separate `git worktree` instead. Two sessions on one checkout fight over the branch, and token usage gets attributed to the wrong unit (see Phase 5).
- Set the unit's status to `in-progress`.

## Phase 1 — Plan (Opus, main agent)
Write `docs/plans/$ARGUMENTS.md` containing:
1. **Goal & scope**, restated from the work breakdown, including what's out of scope.
2. **Approach**, with key design decisions and the alternatives rejected. Link the `CLAUDE.md` sections each decision follows.
3. **File-by-file changes**: create/modify/delete, with a purpose for each.
4. **Acceptance criteria → tests**: each AC ID mapped to its test file and layer (CLAUDE.md §6.2–6.3).
5. **Task list**: numbered tasks (`T1`, `T2`, …). Each task has:
   - Owner: **Opus** or **Sonnet**, with a one-line reason
   - The exact files the task touches
   - What "done" means for the task, and the command that proves it
   - Dependencies on other tasks
   - Which tasks can run in parallel (only when they touch different files)
6. **Risks & open questions** for the user.
7. **Expected commit series**, as Conventional Commit messages.
8. **Review tier**: `sonnet`, `opus` or `skip`, with a one-line reason (rules below).

**Delegation rules for the task list:**
- **Sonnet** (`wu-implementer`): self-contained tasks fully specified by the plan, touching a known set of files, mostly mechanical (scaffolding, config, tests from listed ACs, components to spec).
- **Opus** (keep it): contract and schema design, anything touching `CLAUDE.md`, spikes, debugging failures that cross layers, and integrating task outputs.
- **Small tasks stay with Opus.** A subagent starts with no context and must read `CLAUDE.md` and the plan first, so delegating a few-minute task costs more tokens than doing it directly.

**Review tier rules.** Reviews draw on the user's usage allowance, and Opus draws on it roughly twice as fast as Sonnet.
- **`sonnet`** is the default.
- **`opus`** only where a missed design flaw would spread into later units: WU-04 (contract schemas), WU-05 (rules), WU-08 (`LlmClient` and cassettes). Any other unit only if it changes the contract, the rule catalog or the `LlmClient` interface. Say why in the plan.
- **`skip`** for small, low-risk units (e.g. docs-only), with the reason.
- The tier applies to both reviews. The user can change it when approving the plan.

### Plan review (before presenting)
Unless the tier is `skip`, run the reviewer once:
- Call the Agent tool with `subagent_type: "wu-reviewer"`. Add `model: "opus"` only when the tier is `opus`; the agent's default is Sonnet.
- Prompt: `mode: plan`, the unit ID and the plan path. Don't paste the plan in.
- **Do not change the plan in response to the review yet.** The user decides first.
- Triage every concern it raises, using the format under **Triaging a review** below.

Then present a short summary of the plan plus the triaged review in chat, and **STOP. Wait for the user's approval or changes.** Revise the plan file only as the user directs. Do not run a second review unless the user asks for one.

### Triaging a review
For each concern the reviewer raised, give:

| # | Concern (one line) | Level | My view | Recommendation |
|---|---|---|---|---|

- **Level:** the reviewer's rating, P0–P2 (defined in `.claude/agents/wu-reviewer.md`). If you think a rating is wrong, say so under "My view" rather than changing it.
- **My view:** **agree**, **partly agree** or **disagree**, with a one-line reason grounded in the code, the plan or CLAUDE.md.
- **Recommendation:** fix now, fix in a later unit (name it), or no change. Defaults:
  - **P0:** fix now.
  - **P1:** fix now, unless you explain why a later unit is the right place.
  - **P2:** the user's call; usually defer or no change.

Then add the reviewer's "not checked" line, and the subagent's reported token usage. Never act on a concern before the user decides. Never loop review → fix → review on your own.

## Phase 2 — Orchestrate
- Do Opus tasks yourself.
- For each Sonnet task, call the Agent tool with `subagent_type: "wu-implementer"`. The prompt gives the plan path and task ID, plus anything learned since the plan was written; do not paste the plan in. Launch independent tasks in parallel in one message.
- Review every subagent result: read the changed files, not just the report. Fix small issues yourself; re-delegate with specific feedback for larger ones.
- If reality diverges from the plan materially (new files, a changed approach, new risks), pause and tell the user before continuing.
- **Keep a deviation log as you go.** Record every deviation from the approved plan, material or not, in a final `## Deviations during implementation` section of the plan file. Each entry gives what was planned, what happened, and why. Leave the approved plan above that section unedited.
- **Note effects on other units as you find them.** Track findings or changes that affect later WUs, and propose the notes for them in Phase 4.

## Phase 3 — Verify
- Run `pnpm verify` (or the subset that exists at this stage of the build) yourself.
- Check the unit's Definition of done item by item.
- Fix or re-delegate failures. Never weaken a test, threshold or lint rule to get to green.

### Implementation review (after verify, before presenting)
Unless the approved tier is `skip`, run the reviewer once:
- Write the changes to a scratchpad file:
  - `git diff main -- . ':!pnpm-lock.yaml' ':!packages/domain-schema/generated' ':!.llm-cassettes' ':!contracts/pacts'`
  - plus the output of `git ls-files --others --exclude-standard`, so the reviewer can see new files.
- Call the Agent tool with `subagent_type: "wu-reviewer"`, adding `model: "opus"` if the tier is `opus`.
- Prompt: `mode: implementation`, the unit ID, the plan path and the diff file path.
- Triage the result as in Phase 1. Don't fix anything from it yet; the user decides at the Phase 4 stop.

## Phase 4 — Review (hard stop)
Leave all changes **uncommitted** so the user can review them in VS Code's Source Control view. Present:
- **Summary:** what was built, with each Definition of done item and its status.
- **Verification:** the commands run, with results. Report failures honestly.
- **Implementation review:** the triage table from Phase 3, or "skipped (tier: skip)".
- **Changes:** a `git status --short` style file list grouped by area, with a one-line purpose per file. Flag generated and lock files (`pnpm-lock.yaml`, `generated/`, cassettes, pacts) separately.
- **Deviations from the plan:** a short summary pointing to the plan's deviations section.
- **Effects on other units:** for each later WU that this unit's findings or changes affect, the Notes entry you propose for it in `docs/work-breakdown.md`, linked to the ADR or doc section. Propose a Definition-of-done change only for a hard requirement, and flag it for explicit approval. Never rewrite another unit's scope.
- **Proposed commits:** the Conventional Commit messages and which files go in each.

Do **not** paste the full diff unless the user asks for it.

**STOP. Do not commit until the user explicitly approves.** Apply the review fixes and other changes the user chooses, record any resulting deviations, re-verify, and re-present. A second review runs only if the user asks.

## Phase 5 — Commit, push & open the pull request (only after approval)
- Create the approved commits in order on the unit's branch, each ending with the session's attribution trailer.
  - The plan's deviations section and the approved notes for other units go in the unit's main docs commit, alongside any ADR.
- Push the branch (`git push -u origin HEAD`) and open the pull request with `gh pr create --base main`:
  - **Title:** `$ARGUMENTS: <unit title>`.
  - **Body:** the Phase 4 summary (Definition of done with statuses, verification results, review triage outcomes, deviations, effects on other units), a link to `docs/plans/$ARGUMENTS.md`, and the session's PR attribution line.
- Run `node .claude/scripts/wu-usage.mjs $ARGUMENTS`. It reads Claude Code's local transcripts and spends no tokens.
- Update `docs/work-breakdown.md`:
  - status `done`;
  - **Commits:** the PR link (commit hashes can change if the branch is rebased; the PR link can't);
  - **Notes:** anything learned, and a **Usage** line with requests and output tokens per agent and model from the script, e.g. `Usage: main/Opus 73 req, 75k out; wu-reviewer/Sonnet 2 req, 4k out`.

  Commit that as a final `docs(repo): close $ARGUMENTS` commit and push it. This commit is part of the approved series; the status becomes true on `main` when the PR merges.
- Report the PR URL, the branch's `git log --oneline main..HEAD`, and the usage table.

## Phase 6 — Merge (the user merges)
History on `main` follows GitLab's **merge commit with semi-linear history** (CLAUDE.md §10). Every PR lands as a merge commit, and only when its branch already contains the tip of `main`. GitHub enforces it: only merge commits are allowed, and branch protection requires the `verify` check to pass on a branch that is up to date with `main`.
- Before telling the user the PR is ready to merge, confirm the `verify` check passed: `gh pr checks --watch`. If it failed, fix it on the branch; never ask the user to bypass protection.
- **The user merges the PR** with "Create a merge commit". Never merge it yourself unless asked.
- If `main` has moved since the branch was created, rebase the branch instead of merging `main` into it: `git fetch origin && git rebase origin/main`, re-run `pnpm verify`, then `git push --force-with-lease`. Ask the user before force-pushing. Never use GitHub's "Update branch" merge, which breaks the linear segment.
- After the merge: `git switch main && git pull --ff-only && git branch -d wu/$ARGUMENTS-<slug>`. GitHub deletes the remote branch automatically.
