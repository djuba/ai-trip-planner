// The README and the decision records index are the reviewer's way in (WU-16 plan D5). Later
// units edit them, and a renamed file or heading breaks a relative link silently, so this checks
// every relative link resolves, including a `#heading` anchor into a Markdown file, and that every
// ADR is indexed. Files only; no network.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));
const DOCS = ['README.md', 'docs/decisions/README.md'];
const DECISIONS = 'docs/decisions';

/** Markdown without fenced code blocks, whether or not the fence is indented. */
function withoutFences(markdown: string): string {
  return markdown.replace(/^[ \t]*```[\s\S]*?^[ \t]*```/gm, '');
}

/** Relative link targets in Markdown, outside fenced code blocks and inline code. */
function relativeLinks(markdown: string): string[] {
  const prose = withoutFences(markdown).replace(/`[^`\n]*`/g, '');
  const targets = [...prose.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map((m) => m[1] ?? '');
  return targets.filter((t) => t !== '' && !/^[a-z][a-z0-9+.-]*:/i.test(t));
}

/** The anchors GitHub gives a file's headings: lowercased, punctuation dropped, spaces to `-`. */
function headingAnchors(markdown: string): Set<string> {
  const anchors = new Set<string>();
  const seen = new Map<string, number>();
  for (const [, text = ''] of withoutFences(markdown).matchAll(/^#{1,6}[ \t]+(.+?)[ \t#]*$/gm)) {
    const slug = text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\p{M} _-]/gu, '')
      .replace(/ /g, '-');
    const count = seen.get(slug) ?? 0;
    seen.set(slug, count + 1);
    anchors.add(count === 0 ? slug : `${slug}-${count}`);
  }
  return anchors;
}

/** Why `link`, found in `doc`, does not resolve; undefined when it does. */
function brokenReason(doc: string, link: string): string | undefined {
  const [pathPart = '', anchor] = link.replace(/\?.*$/, '').split('#');
  const target =
    pathPart === ''
      ? resolve(root, doc)
      : resolve(root, dirname(doc), decodeURIComponent(pathPart));
  if (!existsSync(target)) return 'missing file';
  if (anchor === undefined || anchor === '' || !target.endsWith('.md')) return undefined;
  const anchors = headingAnchors(readFileSync(target, 'utf8'));
  return anchors.has(decodeURIComponent(anchor))
    ? undefined
    : `no heading #${anchor} in ${relative(root, target)}`;
}

describe('documentation links', () => {
  it.each(DOCS)('AC-DOCS-01: every relative link in %s resolves', (doc) => {
    const links = relativeLinks(readFileSync(resolve(root, doc), 'utf8'));
    expect(links.length).toBeGreaterThan(0);
    const broken = links.flatMap((link) => {
      const reason = brokenReason(doc, link);
      return reason === undefined ? [] : [`${link}: ${reason}`];
    });
    expect(broken).toEqual([]);
  });

  it('AC-DOCS-01: anchors follow GitHub heading slugs, and indented fences hold no links', () => {
    const sample = [
      '## 10. Commits & history',
      '## How it works',
      '## How it works',
      '- a list item',
      '  ```md',
      '  [not a link](nowhere.md)',
      '  ```',
    ].join('\n');
    expect([...headingAnchors(sample)]).toEqual([
      '10-commits--history',
      'how-it-works',
      'how-it-works-1',
    ]);
    expect(relativeLinks(sample)).toEqual([]);
  });

  it('AC-DOCS-02: every ADR is listed in the decision records index', () => {
    const index = relativeLinks(readFileSync(resolve(root, DECISIONS, 'README.md'), 'utf8'));
    const adrs = readdirSync(resolve(root, DECISIONS)).filter((f) => /^\d{4}-.+\.md$/.test(f));
    expect(adrs.length).toBeGreaterThan(0);
    expect(adrs.filter((adr) => !index.includes(adr))).toEqual([]);
  });
});
