#!/usr/bin/env node
// Token usage per work unit, read from Claude Code's local session transcripts.
// Workflow tooling (CLAUDE.md §12), not product code. Spends no tokens.
//
//   node .claude/scripts/wu-usage.mjs            # every WU found
//   node .claude/scripts/wu-usage.mjs WU-03      # one unit
//   node .claude/scripts/wu-usage.mjs --json     # machine-readable
//
// How it attributes usage: every assistant message in a transcript records the git branch of
// the session's working directory. Messages on `wu/WU-xx-*` branches count toward WU-xx.
// Caveats (approximate by design):
// - Two sessions sharing one checkout are attributed to whatever branch it has checked out at
//   the time. Run concurrent sessions in separate worktrees.
// - Work done on `main` (e.g. Phase 0 before the branch exists) is not counted.
// - The transcript format is Claude Code's internal format and may change; unknown lines are
//   skipped rather than failing.
// - Tokens are not the same as subscription allowance. Opus draws on the allowance faster than
//   Sonnet; report the models separately and don't collapse them into one number.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const only = args.find((a) => /^WU-\d+[a-z]?$/i.test(a))?.toUpperCase();
const root = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'projects');

const BRANCH = /^wu\/(WU-\d+[a-z]?)-/i;

/** @param {string} dir @returns {string[]} */
function jsonlFiles(dir) {
  /** @type {string[]} */
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...jsonlFiles(p));
    else if (name.endsWith('.jsonl')) out.push(p);
  }
  return out;
}

/**
 * Subagent transcripts sit next to `<agent>.meta.json`, which names the agent type.
 * @param {string} file
 */
function agentTypeOf(file) {
  const meta = join(dirname(file), basename(file, '.jsonl') + '.meta.json');
  if (!existsSync(meta)) return 'subagent';
  try {
    return JSON.parse(readFileSync(meta, 'utf8')).agentType ?? 'subagent';
  } catch {
    return 'subagent';
  }
}

if (!existsSync(root)) {
  console.error(`No Claude Code transcripts found at ${root}`);
  process.exit(1);
}

/** @typedef {{ requests: number, input: number, cacheWrite: number, cacheRead: number, output: number }} Totals */
/** @type {Map<string, Map<string, Totals>>} unit -> "agent · model" -> totals */
const units = new Map();
const seen = new Set();

for (const file of jsonlFiles(root)) {
  const agent = file.split(/[\\/]/).includes('subagents') ? agentTypeOf(file) : 'main';
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    const msg = rec?.message;
    if (rec?.type !== 'assistant' || !msg?.usage || !msg.id) continue;
    // One API response is written as several lines (one per content block) with identical usage.
    if (seen.has(msg.id)) continue;
    seen.add(msg.id);
    const unit = BRANCH.exec(rec.gitBranch ?? '')?.[1]?.toUpperCase();
    if (!unit || (only && unit !== only)) continue;
    const key = `${agent} · ${msg.model ?? 'unknown'}`;
    const byKey = units.get(unit) ?? new Map();
    units.set(unit, byKey);
    const t = byKey.get(key) ?? { requests: 0, input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
    byKey.set(key, t);
    const u = msg.usage;
    t.requests += 1;
    t.input += u.input_tokens ?? 0;
    t.cacheWrite += u.cache_creation_input_tokens ?? 0;
    t.cacheRead += u.cache_read_input_tokens ?? 0;
    t.output += u.output_tokens ?? 0;
  }
}

const sorted = [...units.entries()].sort(([a], [b]) =>
  a.localeCompare(b, undefined, { numeric: true }),
);

if (asJson) {
  console.log(
    JSON.stringify(
      Object.fromEntries(sorted.map(([u, m]) => [u, Object.fromEntries(m)])),
      null,
      2,
    ),
  );
  process.exit(0);
}

if (sorted.length === 0) {
  console.log(only ? `No usage found for ${only}.` : 'No usage found on wu/WU-xx-* branches.');
  process.exit(0);
}

/** @param {number} n */
const k = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));

for (const [unit, byKey] of sorted) {
  console.log(`\n${unit}`);
  console.log('| agent · model | requests | input | cache write | cache read | output |');
  console.log('|---|---:|---:|---:|---:|---:|');
  for (const [key, t] of [...byKey.entries()].sort()) {
    console.log(
      `| ${key} | ${t.requests} | ${k(t.input)} | ${k(t.cacheWrite)} | ${k(t.cacheRead)} | ${k(t.output)} |`,
    );
  }
}
