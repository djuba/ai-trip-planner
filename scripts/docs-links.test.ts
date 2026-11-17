// The README and the decision records index are the reviewer's way in (WU-16 plan D5). Later
// units edit them, and a renamed file breaks a relative link silently, so this checks every
// relative link resolves and every ADR is indexed. Files only; no network.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));
const DOCS = ['README.md', 'docs/decisions/README.md'];
const DECISIONS = 'docs/decisions';

/** Relative link targets in Markdown, outside fenced code blocks and inline code. */
function relativeLinks(markdown: string): string[] {
  const prose = markdown.replace(/^```[\s\S]*?^```/gm, '').replace(/`[^`\n]*`/g, '');
  const targets = [...prose.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map((m) => m[1] ?? '');
  return targets.filter((t) => t !== '' && !/^([a-z][a-z0-9+.-]*:|#)/i.test(t));
}

describe('documentation links', () => {
  it.each(DOCS)('AC-DOCS-01: every relative link in %s resolves', (doc) => {
    const links = relativeLinks(readFileSync(resolve(root, doc), 'utf8'));
    expect(links.length).toBeGreaterThan(0);
    const missing = links.filter((link) => {
      const path = decodeURIComponent(link.replace(/[#?].*$/, ''));
      return !existsSync(resolve(root, dirname(doc), path));
    });
    expect(missing).toEqual([]);
  });

  it('AC-DOCS-02: every ADR is listed in the decision records index', () => {
    const index = relativeLinks(readFileSync(resolve(root, DECISIONS, 'README.md'), 'utf8'));
    const adrs = readdirSync(resolve(root, DECISIONS)).filter((f) => /^\d{4}-.+\.md$/.test(f));
    expect(adrs.length).toBeGreaterThan(0);
    expect(adrs.filter((adr) => !index.includes(adr))).toEqual([]);
  });
});
