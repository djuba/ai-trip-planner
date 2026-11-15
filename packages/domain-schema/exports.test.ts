import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('package.json exports (CLAUDE.md §4.2)', () => {
  it('exposes exactly ./wire, ./rules, ./testing and ./messages', () => {
    const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
      exports: unknown;
    };
    expect(pkg.exports).toEqual({
      './wire': './src/wire/index.ts',
      './rules': './src/rules/index.ts',
      './testing': './tests/support/build-fixture.ts',
      './messages': './src/messages/index.ts',
    });
  });
});

describe('./messages (WU-13, AC-MSG-05)', () => {
  it('AC-MSG-05: loads the English catalog, checked against MessageCatalog', async () => {
    const { EN_MESSAGES, MessageCatalog } = await import('./src/messages/index.ts');
    expect(EN_MESSAGES.locale).toBe('en');
    expect(MessageCatalog.safeParse(EN_MESSAGES).success).toBe(true);
  });
});
