---
name: start-wu
description: Run the branch → plan → plan review → approve → build → verify → unit review → commit walk-through (stage → present → approve → commit, per commit) → push → close → pull request workflow for one work unit from docs/work-breakdown.md. Invoke as /start-wu WU-xx.
argument-hint: WU-xx
disable-model-invocation: true
---

# Start work unit $ARGUMENTS

Follow these phases in order. The unit is built in one stretch after the plan is approved. Then the user reviews it **one commit at a time**: each commit is staged on its own and presented with the review findings for that slice only. So the user reviews small change sets without waiting on the build between them.

**Hard stops:** the end of Phase 1 (plan), and each commit in Phase 3's walk-through. At each one, do not continue until the user explicitly approves. Between them, stop only for a material deviation (Phase 2).

## Phase 0 — Preconditions
- Read the $ARGUMENTS entry in `docs/work-breakdown.md`.
- Confirm `git status` is clean. If it isn't, stop and show the user what's there.
- Update `main`: `git switch main && git pull --ff-only`. A unit is `done` only once its pull request is merged, so dependency status must be read from an up-to-date `main`.
- Confirm every unit in its Depends-on is `done` on `main`. If not, stop and say which are not.
- Create the unit's branch from `main`: `git switch -c wu/$ARGUMENTS-<slug>`, where `<slug>` is the unit's title in kebab-case (e.g. `wu/WU-02-quality-gates`). All of the unit's work happens on this branch; never commit to `main` directly.
- If another Claude Code session is already using this checkout, work in a separate `git worktree` instead. Two sessions on one checkout fight over the branch, and token usage gets attributed to the wrong unit (see Phase 4).
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
7. **Expected commits**: the likely commit series as Conventional Commit messages, each with the tasks it covers. This is a guide, not a commitment: the final boundaries are chosen once the work is done (Phase 3). Note any split that is required rather than just likely, e.g. a breaking contract change in its own commit (CLAUDE.md §10). The first commit is always the plan (`docs(repo): add $ARGUMENTS plan`) and the last is always the close commit (`docs(repo): close $ARGUMENTS`).
8. **Review tier**: `sonnet`, `opus` or `skip` for the plan review and the unit review (`skip` skips only the plan review), with a one-line reason (rules below).

**Delegation rules for the task list:**
- **Sonnet** (`wu-implementer`): self-contained tasks fully specified by the plan, touching a known set of files, mostly mechanical (scaffolding, config, tests from listed ACs, components to spec).
- **Opus** (keep it): contract and schema design, anything touching `CLAUDE.md`, spikes, debugging failures that cross layers, and integrating task outputs.
- **Small tasks stay with Opus.** A subagent starts with no context and must read `CLAUDE.md` and the plan first, so delegating a few-minute task costs more tokens than doing it directly.

**Review tier rules.** Reviews draw on the user's usage allowance, and Opus draws on it roughly twice as fast as Sonnet.
- **`sonnet`** is the default.
- **`opus`** only where a missed design flaw would spread into later units: WU-04 (contract schemas), WU-05 (rules), WU-08 (`LlmClient` and cassettes). Any other unit only if it changes the contract, the rule catalog or the `LlmClient` interface. Say why in the plan.
- **`skip`** for small, low-risk units (e.g. docs-only), with the reason. It skips only the plan review. The unit review always runs, on Sonnet when the tier is `skip`, because it is the last check before the user sees the code.
- The user can change the tier when approving the plan.

### Plan review (before presenting)
Unless the tier is `skip`, run the reviewer once:
- Call the Agent tool with `subagent_type: "wu-reviewer"`. Add `model: "opus"` only when the tier is `opus`; the agent's default is Sonnet.
- Prompt: `mode: plan`, the unit ID and the plan path. Don't paste the plan in.
- **Do not change the plan in response to the review yet.** The user decides first.
- Triage every concern it raises, using the format under **Triaging a review** below.

Then present a short summary of the plan, its expected commits and the triaged review in chat, and **STOP. Wait for the user's approval or changes.** Revise the plan file only as the user directs. Do not run a second review unless the user asks for one.

### After the plan is approved: the plan commit and the draft PR
- Record the approval and the user's decisions at the top of the plan.
- Commit the plan file and the `in-progress` status as `docs(repo): add $ARGUMENTS plan`. The user's approval of the plan covers this commit; say so when asking for it.
- Push the branch (`git push -u origin HEAD`) and open a **draft** pull request: `gh pr create --draft --base main`.
  - **Title:** `$ARGUMENTS: <unit title>`.
  - **Body:** a link to `docs/plans/$ARGUMENTS.md` and the session's PR attribution line.

### Triaging a review
For each concern the reviewer raised, give:

| # | Concern (one line) | Level | My view | Recommendation |
|---|---|---|---|---|

- **Level:** the reviewer's rating, P0–P2 (defined in `.claude/agents/wu-reviewer.md`). If you think a rating is wrong, say so under "My view" rather than changing it.
- **My view:** **agree**, **partly agree** or **disagree**, with a one-line reason grounded in the code, the plan or CLAUDE.md.
- **Recommendation:** fix now (in this commit), fix in a later commit or unit (name it), or no change. Defaults:
  - **P0:** fix now.
  - **P1:** fix now, unless you explain why a later commit or unit is the right place.
  - **P2:** the user's call; usually defer or no change.

Then add the reviewer's "not checked" line, and the subagent's reported token usage. Never act on a concern before the user decides. Never loop review → fix → review on your own.

## Phase 2 — Build (no stops)
Implement the whole unit, task by task, without stopping for approval.
- Do Opus tasks yourself.
- For each Sonnet task, call the Agent tool with `subagent_type: "wu-implementer"`. The prompt gives the plan path and task ID, plus anything learned since the plan was written; do not paste the plan in. Launch independent tasks in parallel in one message.
- Review every subagent result: read the changed files, not just the report. Fix small issues yourself; re-delegate with specific feedback for larger ones.
- Run each task's proof command as it completes. Fix or re-delegate failures. Never weaken a test, threshold or lint rule to get to green.
- Leave everything **uncommitted**. Nothing is committed until the walk-through in Phase 3.

**Throughout the build:**
- **Material deviation** from the approved plan (new files, a changed approach, a new risk, a required commit split that no longer holds) means pausing and telling the user before continuing. This is the only reason to stop mid-build.
- **Keep a deviation log.** Record every deviation, material or not, in a final `## Deviations during implementation` section of the plan file. Each entry gives what was planned, what happened, and why. Leave the approved plan above that section unedited.
- **Effects on other units.** When a finding affects a later WU, draft its Notes entry for `docs/work-breakdown.md`, linked to the ADR or doc section, and hold it for the close commit (Phase 4). Propose a Definition-of-done change only for a hard requirement, and flag it for explicit approval. Never rewrite another unit's scope.

### Verify and unit review (end of build)
- Run `pnpm verify` yourself, and check the unit's Definition of done item by item.
- **Choose the commit boundaries** now that the work is done, starting from the plan's expected commits:
  - each file lands in **exactly one** commit, so each commit is staged with `git add <files>` and no hunk splitting;
  - tests go in the same commit as the behaviour they cover, and regenerated `spec/generated/`, cassettes and pacts go with the change that caused them (CLAUDE.md §10);
  - each commit is one logical change a reader can understand in one sitting, and any required split from the plan holds;
  - order the commits so each builds on the ones before it.

  If the plan's expected commits no longer fit, record that as a deviation (not material unless a required split is lost).
- **Unit review** (always, whatever the tier):
  - Write the unit's changes to a scratchpad file: `git diff HEAD -- . ':!pnpm-lock.yaml' ':!spec/generated' ':!.llm-cassettes' ':!contracts/pacts'`, plus the output of `git ls-files --others --exclude-standard`, so the reviewer can see new files.
  - Call the Agent tool with `subagent_type: "wu-reviewer"`, adding `model: "opus"` if the tier is `opus`.
  - Prompt: `mode: implementation`, the unit ID, the plan path, the diff file path, and the proposed commits with each one's files.
  - Triage the result, and assign each concern to the commit whose files it concerns. A concern that spans commits goes to the first commit it touches; a concern about the unit as a whole goes to the close commit.

## Phase 3 — Commit walk-through (one hard stop per commit)
Go through the commits in order. For each one:

1. **Stage** exactly its files: `git add <files>`. Everything for later commits stays unstaged, so VS Code's Source Control view shows this commit under **Staged Changes**.
2. **STOP (hard stop).** Present:
   - **Summary:** what this commit does, and which tasks and ACs it covers.
   - **Review:** the triage table for the concerns assigned to this commit, or "no findings for this commit".
   - **Files:** a `git status --short` style list of the staged files with a one-line purpose per file. Flag generated and lock files (`pnpm-lock.yaml`, `spec/generated/`, cassettes, pacts) separately.
   - **Deviations:** any that concern this commit, pointing to the plan's deviations section.
   - **Proposed commit:** the message.
   - **Progress:** `commit n of m`, and the remaining commits by message.

   Do **not** paste the full diff unless the user asks for it. On the first stop, also give the unit's verification result (`pnpm verify`) and a short **unit summary**: what the unit built as a whole, the main design choices, and how the commits fit together.
3. **After approval:** apply the fixes the user chose for this commit.
   - A fix that touches this commit's files is staged into it. A fix that belongs to a later commit's files is left unstaged and lands with that commit; say so when presenting it.
   - A fix to a commit already made is fixed forward: a new `fix(...)` commit, added to the end of the series and presented like any other. Never amend or rebase an approved commit.
   - After any fix, re-run the affected tests and `pnpm typecheck` on the full tree, and record any resulting deviation. A second review runs only if the user asks.

   Then commit with the session's attribution trailer. Do not push yet.

If the user changes a boundary during the walk-through (moves a file, merges or splits commits not yet made), redo the staging for the current commit and re-present it.

## Phase 4 — Push & close
- Push all the unit's commits at once: `git push`. The `pre-push` hook runs the full `pnpm verify`. If it fails, report it and fix it forward with a new commit, presented like any other.
- Run `node .claude/scripts/wu-usage.mjs $ARGUMENTS`. It reads Claude Code's local transcripts and spends no tokens.
- Present the **close commit** (one more hard stop, like any other commit): the `docs(repo): close $ARGUMENTS` changes, which hold the plan's deviations section, the approved Notes for other units, and the unit's entry in `docs/work-breakdown.md`:
  - status `done`;
  - **Commits:** the PR link (commit hashes can change if the branch is rebased; the PR link can't);
  - **Notes:** anything learned, and a **Usage** line with requests and output tokens per agent and model from the script, e.g. `Usage: main/Opus 73 req, 75k out; wu-reviewer/Sonnet 2 req, 4k out`.

  Also give the Definition of done with each item's status, and any concerns assigned to the close commit.
- After approval, commit and push it. Update the PR body with the commit list, the Definition of done and its statuses, verification results, the review outcomes, deviations, effects on other units and the usage line. Mark the PR ready: `gh pr ready`.
- Report the PR URL, the branch's `git log --oneline main..HEAD`, and the usage table.

## Phase 5 — Merge (the user merges)
History on `main` follows GitLab's **merge commit with semi-linear history** (CLAUDE.md §10). Every PR lands as a merge commit, and only when its branch already contains the tip of `main`. GitHub enforces it: only merge commits are allowed, and branch protection requires the `verify` check to pass on a branch that is up to date with `main`.
- Before telling the user the PR is ready to merge, confirm the `verify` check passed: `gh pr checks --watch`. If it failed, fix it on the branch; never ask the user to bypass protection.
- **The user merges the PR** with "Create a merge commit". Never merge it yourself unless asked.
- If `main` has moved since the branch was created, rebase the branch instead of merging `main` into it: `git fetch origin && git rebase origin/main`, re-run `pnpm verify`, then `git push --force-with-lease`. Ask the user before force-pushing. Never use GitHub's "Update branch" merge, which breaks the linear segment. If the rebase brings in a change that affects this unit (for example a new Note on it), show the user before adding any commit for it.
- After the merge: `git switch main && git pull --ff-only && git branch -d wu/$ARGUMENTS-<slug>`. GitHub deletes the remote branch automatically.
