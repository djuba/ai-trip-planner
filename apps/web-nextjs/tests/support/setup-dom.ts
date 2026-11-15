// Vitest setup for the unit and integration projects. Web component tests opt into jsdom per file
// (`// @vitest-environment jsdom`); everything else runs in node, where this does nothing.
import { afterEach } from 'vitest';

if (typeof document !== 'undefined') {
  await import('@testing-library/jest-dom/vitest');
  const { cleanup } = await import('@testing-library/react');
  afterEach(() => {
    cleanup();
  });
}
