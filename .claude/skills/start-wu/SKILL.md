---
name: start-wu
description: Run the branch → plan → plan review → approve → checkpoint loop (implement → verify → review → approve → commit → push) → unit review → close → pull request workflow for one work unit from docs/work-breakdown.md. Invoke as /start-wu WU-xx.
argument-hint: WU-xx
disable-model-invocation: true
---

# Start work unit $ARGUMENTS

Follow these phases in order. The unit is built as a series of **checkpoints**, each one reviewed and committed before the next begins, so the user reviews small change sets instead of one large one at the end.

**Hard stops:** the end of Phase 1 (plan), every code checkpoint in Phase 2 (granularity `fine` only), and the end of Phase 3 (unit review). At each one, do not continue until the user explicitly approves.

## Phase 0 — Preconditions
- Read the $ARGUMENTS entry in `docs/work-breakdown.md`.
- Confirm `git status` is clean. If it isn't, stop and show the user what's there.
- Update `main`: `git switch main && git pull --ff-only`. A unit is `done` only once its pull request is merged, so dependency status must be read from an up-to-date `main`.
- Confirm every unit in its Depends-on is `done` on `main`. If not, stop and say which are not.
- Create the unit's branch from `main`: `git switch -c wu/$ARGUMENTS-<slug>`, where `<slug>` is the unit's title in kebab-case (e.g. `wu/WU-02-quality-gates`). All of the unit's work happens on this branch; never commit to `main` directly.
- If another Claude Code session is already using this checkout, work in a separate `git worktree` instead. Two sessions on one checkout fight over the branch, and token usage gets attributed to the wrong unit (see Phase 3).
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
7. **Checkpoints**: the commit series, in order. Each checkpoint is one commit and has:
   - its Conventional Commit message;
   - the tasks it completes and the files it touches;
   - its **gate**: the command that must pass before review, e.g. `pnpm typecheck && pnpm lint` plus the Vitest files for that slice;
   - its **review**: `sonnet` (default for code), `opus` or `skip` (docs-only).

   `CP0` is always the plan commit (`docs(repo): add $ARGUMENTS plan`). The last checkpoint is always the close commit (`docs(repo): close $ARGUMENTS`). In between, each checkpoint must be a coherent, reviewable slice: its tests go in the same commit as the behaviour (CLAUDE.md §10), and the tree passes its gate when committed. Aim for slices a reader can understand in one sitting, and split any that would not be.
8. **Unit review tier**: `sonnet`, `opus` or `skip` for the plan review and the final unit review (`skip` skips only the plan review), with a one-line reason (rules below).
9. **Granularity**: `fine` or `single`, with a one-line reason. The user confirms or changes it when approving the plan.
   - **`fine`**: several code checkpoints, each reviewed, committed and pushed at its own stop, then the unit review across them in Phase 3. Recommend it for large or risky units, and for any unit that changes the contract, the rule catalog or the `LlmClient` interface.
   - **`single`**: exactly one code checkpoint (`CP1`) between the plan and the close commit, holding all of the unit's code. It has no checkpoint review or stop of its own: after its gate passes, go to Phase 3 with its changes still uncommitted, so the unit review sees them before they are committed and there is one stop for the whole unit. Recommend it for small or low-risk units.
   - Changing granularity mid-unit is a material deviation (Phase 2).

**Delegation rules for the task list:**
- **Sonnet** (`wu-implementer`): self-contained tasks fully specified by the plan, touching a known set of files, mostly mechanical (scaffolding, config, tests from listed ACs, components to spec).
- **Opus** (keep it): contract and schema design, anything touching `CLAUDE.md`, spikes, debugging failures that cross layers, and integrating task outputs.
- **Small tasks stay with Opus.** A subagent starts with no context and must read `CLAUDE.md` and the plan first, so delegating a few-minute task costs more tokens than doing it directly.

**Review tier rules.** Reviews draw on the user's usage allowance, and Opus draws on it roughly twice as fast as Sonnet.
- **Unit tier** (plan review and final unit review):
  - **`sonnet`** is the default.
  - **`opus`** only where a missed design flaw would spread into later units: WU-04 (contract schemas), WU-05 (rules), WU-08 (`LlmClient` and cassettes). Any other unit only if it changes the contract, the rule catalog or the `LlmClient` interface. Say why in the plan.
  - **`skip`** for small, low-risk units (e.g. docs-only), with the reason. It skips only the plan review. The unit review always runs, on Sonnet when the tier is `skip`, because it is the last check before the user merges.
- **Checkpoint reviews** apply only with granularity `fine`. They are `sonnet` by default and `skip` for docs-only checkpoints. Mark a checkpoint `opus` only when that slice is the one carrying the contract, rule-catalog or `LlmClient` change.
- The user can change any tier when approving the plan.

### Plan review (before presenting)
Unless the unit tier is `skip`, run the reviewer once:
- Call the Agent tool with `subagent_type: "wu-reviewer"`. Add `model: "opus"` only when the tier is `opus`; the agent's default is Sonnet.
- Prompt: `mode: plan`, the unit ID and the plan path. Don't paste the plan in.
- **Do not change the plan in response to the review yet.** The user decides first.
- Triage every concern it raises, using the format under **Triaging a review** below.

Then present a short summary of the plan, its granularity and checkpoint list, and the triaged review in chat, and **STOP. Wait for the user's approval or changes.** Revise the plan file only as the user directs. Do not run a second review unless the user asks for one.

### After the plan is approved: CP0 and the draft PR
- Record the approval and the user's decisions at the top of the plan.
- Commit `CP0`: the plan file and the `in-progress` status. The user's approval of the plan covers this commit; say so when asking for it.
- Push the branch (`git push -u origin HEAD`) and open a **draft** pull request: `gh pr create --draft --base main`.
  - **Title:** `$ARGUMENTS: <unit title>`.
  - **Body:** a link to `docs/plans/$ARGUMENTS.md`, the checkpoint list as a task list (`- [ ] CP1 …`), and the session's PR attribution line. Tick each checkpoint as it lands.

### Triaging a review
For each concern the reviewer raised, give:

| # | Concern (one line) | Level | My view | Recommendation |
|---|---|---|---|---|

- **Level:** the reviewer's rating, P0–P2 (defined in `.claude/agents/wu-reviewer.md`). If you think a rating is wrong, say so under "My view" rather than changing it.
- **My view:** **agree**, **partly agree** or **disagree**, with a one-line reason grounded in the code, the plan or CLAUDE.md.
- **Recommendation:** fix now (in this checkpoint), fix in a later checkpoint or unit (name it), or no change. Defaults:
  - **P0:** fix now.
  - **P1:** fix now, unless you explain why a later checkpoint or unit is the right place.
  - **P2:** the user's call; usually defer or no change.

Then add the reviewer's "not checked" line, and the subagent's reported token usage. Never act on a concern before the user decides. Never loop review → fix → review on your own.

## Phase 2 — Checkpoints (one hard stop each)
Work through the plan's checkpoints in order. For each one, follow the steps below. **With granularity `single`,** `CP1` runs steps 1 and 2 only, then goes straight to Phase 3 with its changes uncommitted.

1. **Implement** its tasks.
   - Do Opus tasks yourself.
   - For each Sonnet task, call the Agent tool with `subagent_type: "wu-implementer"`. The prompt gives the plan path and task ID, plus anything learned since the plan was written; do not paste the plan in. Launch independent tasks in parallel in one message.
   - Review every subagent result: read the changed files, not just the report. Fix small issues yourself; re-delegate with specific feedback for larger ones.
   - Touch only this checkpoint's files. Work that belongs to a later checkpoint waits for it.
2. **Gate:** run the checkpoint's gate command yourself. Fix or re-delegate failures. Never weaken a test, threshold or lint rule to get to green.
3. **Checkpoint review** (unless the checkpoint's review is `skip`):
   - Write the changes to a scratchpad file: `git diff HEAD -- . ':!pnpm-lock.yaml' ':!spec/generated' ':!.llm-cassettes' ':!contracts/pacts'`, plus the output of `git ls-files --others --exclude-standard`, so the reviewer can see new files.
   - Call the Agent tool with `subagent_type: "wu-reviewer"`, adding `model: "opus"` if the checkpoint's review is `opus`.
   - Prompt: `mode: checkpoint`, the unit ID, the checkpoint ID, the plan path and the diff file path.
   - Triage the result. Don't fix anything from it yet.
4. **STOP (hard stop).** Leave the checkpoint's changes **uncommitted** so the user can review them in VS Code's Source Control view. Present:
   - **Summary:** what this checkpoint built, and which tasks and ACs it covers.
   - **Gate:** the command run and its result. Report failures honestly.
   - **Checkpoint review:** the triage table, or "skipped (docs-only)".
   - **Changes:** a `git status --short` style file list with a one-line purpose per file. Flag generated and lock files (`pnpm-lock.yaml`, `spec/generated/`, cassettes, pacts) separately.
   - **Deviations:** any recorded in this checkpoint, pointing to the plan's deviations section.
   - **Effects on other units:** any Notes this checkpoint's findings call for (see below).
   - **Proposed commit:** the message, and the files it includes.

   Do **not** paste the full diff unless the user asks for it.
5. **After approval:** apply the fixes the user chose, re-run the gate, and record any resulting deviation. A second review runs only if the user asks. Then commit with the session's attribution trailer, push (the `pre-push` hook runs the full `pnpm verify`), and tick the checkpoint in the draft PR body. If the push's verify fails, report it and fix it as described under **Fix forward**.

**Throughout the checkpoints:**
- **Fix forward.** Never amend, squash or rebase a commit the user has approved, except when rebasing the branch onto `main` (Phase 4). A problem found in an earlier checkpoint is fixed with a new `fix(...)` commit, either inside the current checkpoint or as its own checkpoint, presented like any other.
- **Material deviation** from the approved plan (new files, a changed approach, a new risk, a checkpoint that must be split or merged) means pausing and telling the user before continuing.
- **Keep a deviation log.** Record every deviation, material or not, in a final `## Deviations during implementation` section of the plan file, and commit each entry with the checkpoint where it happened. Each entry gives what was planned, what happened, and why. Leave the approved plan above that section unedited.
- **Effects on other units.** When a finding affects a later WU, propose its Notes entry in `docs/work-breakdown.md` at that checkpoint's stop, linked to the ADR or doc section. Once approved, it goes in that checkpoint's commit. Propose a Definition-of-done change only for a hard requirement, and flag it for explicit approval. Never rewrite another unit's scope.

## Phase 3 — Unit review & close (hard stop)
This phase starts after the last code checkpoint is committed (`fine`), or after `CP1`'s gate passes with its changes still uncommitted (`single`).
- Run `pnpm verify` yourself, and check the unit's Definition of done item by item.
- **Unit review** (always, whatever the tier):
  - Write the unit's changes to a scratchpad file, excluding `':!pnpm-lock.yaml' ':!spec/generated' ':!.llm-cassettes' ':!contracts/pacts'`:
    - `fine`: `git diff main...HEAD -- . <exclusions>`;
    - `single`: `git diff HEAD -- . <exclusions>`, plus the output of `git ls-files --others --exclude-standard`.
  - Call the Agent tool with `subagent_type: "wu-reviewer"`, adding `model: "opus"` if the unit tier is `opus`.
  - Prompt: `mode: implementation`, the unit ID, the plan path, the diff file path and the granularity. For `fine`, say that each checkpoint was already reviewed, so this review looks across them. For `single`, say that this is the unit's only code review and the changes are uncommitted.
  - Triage the result.
- Run `node .claude/scripts/wu-usage.mjs $ARGUMENTS`. It reads Claude Code's local transcripts and spends no tokens.
- **STOP (hard stop).** Present:
  - **Definition of done:** each item and its status.
  - **Verification:** the commands run, with results.
  - **Unit summary:** what the unit built as a whole: the main design choices, how the pieces fit together, and anything the user should know before merging. For `fine`, write it for someone who saw each checkpoint separately and now wants the overall picture.
  - **Unit review:** the triage table.
  - **`single` only:** the `CP1` changes and proposed commit, as in Phase 2 step 4 (a file list with one line per file, generated and lock files flagged, and the commit message).
  - **Deviations:** a short summary pointing to the plan's deviations section.
  - **Effects on other units:** Notes not yet proposed at a checkpoint.
  - **Close commit:** the `docs(repo): close $ARGUMENTS` changes to `docs/work-breakdown.md`:
    - status `done`;
    - **Commits:** the PR link (commit hashes can change if the branch is rebased; the PR link can't);
    - **Notes:** anything learned, and a **Usage** line with requests and output tokens per agent and model from the script, e.g. `Usage: main/Opus 73 req, 75k out; wu-reviewer/Sonnet 6 req, 12k out`.
- **After approval:**
  - `fine`: each fix the user chose from the unit review is its own `fix(...)` commit, shown to the user before it is committed.
  - `single`: apply the chosen fixes to the uncommitted `CP1` changes, re-run the gate, record any resulting deviation, then commit `CP1` and push. A second review runs only if the user asks.

  Then commit the close commit and push. Update the PR body with the Definition of done and its statuses, verification results, the review outcomes, deviations, effects on other units and the usage line. Mark the PR ready: `gh pr ready`.
- Report the PR URL, the branch's `git log --oneline main..HEAD`, and the usage table.

## Phase 4 — Merge (the user merges)
History on `main` follows GitLab's **merge commit with semi-linear history** (CLAUDE.md §10). Every PR lands as a merge commit, and only when its branch already contains the tip of `main`. GitHub enforces it: only merge commits are allowed, and branch protection requires the `verify` check to pass on a branch that is up to date with `main`.
- Before telling the user the PR is ready to merge, confirm the `verify` check passed: `gh pr checks --watch`. If it failed, fix it on the branch; never ask the user to bypass protection.
- **The user merges the PR** with "Create a merge commit". Never merge it yourself unless asked.
- If `main` has moved since the branch was created, rebase the branch instead of merging `main` into it: `git fetch origin && git rebase origin/main`, re-run `pnpm verify`, then `git push --force-with-lease`. Ask the user before force-pushing. Never use GitHub's "Update branch" merge, which breaks the linear segment. If the rebase brings in a change that affects this unit (for example a new Note on it), show the user before adding any commit for it.
- After the merge: `git switch main && git pull --ff-only && git branch -d wu/$ARGUMENTS-<slug>`. GitHub deletes the remote branch automatically.
