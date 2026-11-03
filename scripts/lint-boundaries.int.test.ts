// Proves the import-boundary lint rules still fire (CLAUDE.md §4.2, §6.6, §9).
// Lints virtual files with the real eslint.config.js; type-aware rules are disabled so the
// probe files need not exist on disk.
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { beforeAll, describe, expect, it } from 'vitest';

const RULE = 'no-restricted-imports';

const cases: { file: string; code: string; blocked: boolean }[] = [
  {
    file: 'apps/web-nextjs/src/probe.ts',
    code: "import '@vp/domain-schema/rules';",
    blocked: true,
  },
  {
    file: 'apps/web-nextjs/src/probe.ts',
    code: "import type { X } from '@vp/domain-schema/rules/x';\nexport type Y = X;",
    blocked: true,
  },
  {
    file: 'apps/web-nextjs/src/probe.ts',
    code: "export * from '@vp/domain-schema/rules';",
    blocked: true,
  },
  { file: 'apps/web-nextjs/src/probe.ts', code: "import '@vp/api-nextjs';", blocked: true },
  {
    file: 'apps/web-nextjs/src/probe.ts',
    code: "import '../../../backends/api-nextjs/src/index.ts';",
    blocked: true,
  },
  {
    file: 'apps/web-nextjs/src/probe.ts',
    code: "import type { X } from '@vp/domain-schema/wire';\nexport type Y = X;",
    blocked: false,
  },
  { file: 'journeys/src/probe.ts', code: "import '@vp/domain-schema/wire';", blocked: true },
  {
    file: 'journeys/src/probe.ts',
    code: "import '../../apps/web-nextjs/src/index.ts';",
    blocked: true,
  },
  { file: 'journeys/src/probe.ts', code: "import '@playwright/test';", blocked: false },
  {
    file: 'backends/api-nextjs/src/probe.ts',
    code: "import '@vp/domain-schema/rules';",
    blocked: false,
  },
];

const eslint = new ESLint({
  overrideConfig: [{ files: ['**/*.ts'], ...tseslint.configs.disableTypeChecked }],
});

describe('import boundaries (eslint no-restricted-imports)', () => {
  // The first lint loads eslint.config.js and every plugin; do it once, outside the per-case
  // timeout, so each case measures only its own lint.
  beforeAll(async () => {
    await eslint.lintText('export {};', { filePath: 'apps/web-nextjs/src/warmup.ts' });
  }, 60_000);

  it.each(cases)('$file: $code → blocked=$blocked', async ({ file, code, blocked }) => {
    const [result] = await eslint.lintText(code, { filePath: file });
    const hits = (result?.messages ?? []).filter((m) => m.ruleId === RULE);
    expect(hits.length > 0).toBe(blocked);
  });
});
