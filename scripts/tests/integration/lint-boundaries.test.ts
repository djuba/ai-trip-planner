// Proves the import-boundary lint rules still fire (CLAUDE.md §4.2, §6.6, §9), plus the rule
// that keeps Node APIs out of the browser-bundled contract source (WU-04 plan A9).
// Lints virtual files with the real eslint.config.js; type-aware rules are disabled so the
// probe files need not exist on disk.
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { beforeAll, describe, expect, it } from 'vitest';

const RULE = 'no-restricted-imports';

const cases: { file: string; code: string; blocked: boolean; rule?: string }[] = [
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
  { file: 'tests/journeys/src/probe.ts', code: "import '@vp/domain-schema/wire';", blocked: true },
  {
    file: 'tests/journeys/src/probe.ts',
    code: "import '../../../apps/web-nextjs/src/index.ts';",
    blocked: true,
  },
  { file: 'tests/journeys/src/probe.ts', code: "import '@playwright/test';", blocked: false },
  {
    file: 'backends/api-nextjs/src/probe.ts',
    code: "import '@vp/domain-schema/rules';",
    blocked: false,
  },
  {
    file: 'backends/api-nextjs/src/usecases/probe.ts',
    code: "import 'next/server';",
    blocked: true,
  },
  { file: 'backends/api-nextjs/src/usecases/probe.ts', code: "import 'ai';", blocked: true },
  {
    file: 'backends/api-nextjs/src/usecases/probe.ts',
    code: "import '@ai-sdk/anthropic';",
    blocked: true,
  },
  {
    file: 'backends/api-nextjs/src/usecases/probe.ts',
    code: "import '../llm/anthropic.ts';",
    blocked: true,
  },
  {
    file: 'backends/api-nextjs/src/usecases/probe.ts',
    code: "import '@vp/domain-schema/rules';",
    blocked: false,
  },
  { file: 'backends/api-nextjs/src/usecases/probe.test.ts', code: "import 'ai';", blocked: false },
  { file: 'backends/api-nextjs/src/llm/probe.ts', code: "import 'ai';", blocked: false },
  {
    file: 'packages/domain-schema/src/wire/probe.ts',
    code: "import 'node:fs';",
    blocked: true,
  },
  { file: 'packages/domain-schema/src/wire/probe.ts', code: "import 'fs';", blocked: true },
  {
    file: 'packages/domain-schema/src/wire/probe.ts',
    code: "import 'fs/promises';",
    blocked: true,
  },
  {
    file: 'packages/domain-schema/src/wire/probe.ts',
    code: 'export const env = process.env;',
    blocked: true,
    rule: 'no-restricted-globals',
  },
  { file: 'packages/domain-schema/src/wire/probe.ts', code: "import 'zod';", blocked: false },
  { file: 'packages/domain-schema/gen/probe.ts', code: "import 'node:fs';", blocked: false },
];

const eslint = new ESLint({
  overrideConfig: [{ files: ['**/*.ts'], ...tseslint.configs.disableTypeChecked }],
});

describe('import boundaries (eslint no-restricted-imports / -globals)', () => {
  // The first lint loads eslint.config.js and every plugin; do it once, outside the per-case
  // timeout, so each case measures only its own lint.
  beforeAll(async () => {
    await eslint.lintText('export {};', { filePath: 'apps/web-nextjs/src/warmup.ts' });
  }, 60_000);

  it.each(cases)(
    '$file: $code → blocked=$blocked',
    async ({ file, code, blocked, rule = RULE }) => {
      const [result] = await eslint.lintText(code, { filePath: file });
      const hits = (result?.messages ?? []).filter((m) => m.ruleId === rule);
      expect(hits.length > 0).toBe(blocked);
    },
  );
});
