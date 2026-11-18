import { describe, expect, it } from 'vitest';
import { findInBundle, scriptPaths } from './web-bundle.ts';

const page = (...srcs: string[]) =>
  `<html><head>${srcs.map((src) => `<script src="${src}" async=""></script>`).join('')}</head></html>`;

function fakeFetch(files: Record<string, { status?: number; body: string }>) {
  const requested: string[] = [];
  const fn = (url: string): Promise<Response> => {
    requested.push(url);
    const file = files[url];
    return Promise.resolve(
      new Response(file?.body ?? '', { status: file?.status ?? (file ? 200 : 404) }),
    );
  };
  return { fn, requested };
}

describe('scriptPaths', () => {
  it('AC-IMAGE-07: lists unique same-origin _next/static scripts, ignoring external ones', () => {
    const html = page(
      '/_next/static/chunks/a.js',
      '/_next/static/chunks/a.js',
      'https://cdn.example.com/_next/static/x.js',
      '//cdn.example.com/_next/static/y.js',
      '/other/z.js',
      '/_next/static/chunks/b.js?v=1',
    );
    expect(scriptPaths(html)).toEqual(['/_next/static/chunks/a.js', '/_next/static/chunks/b.js']);
  });
});

describe('findInBundle', () => {
  const base = 'http://h';

  it('AC-IMAGE-07: returns the first script containing the needle', async () => {
    const { fn, requested } = fakeFetch({
      'http://h/': { body: page('/_next/static/a.js', '/_next/static/b.js', '/_next/static/c.js') },
      'http://h/_next/static/a.js': { body: 'nothing' },
      'http://h/_next/static/b.js': { body: 'x=https://api.test;' },
      'http://h/_next/static/c.js': { body: 'https://api.test' },
    });
    expect(await findInBundle(base, 'https://api.test', fn)).toBe('/_next/static/b.js');
    expect(requested).not.toContain('http://h/_next/static/c.js');
  });

  it('AC-IMAGE-07: returns null when no script contains it', async () => {
    const { fn } = fakeFetch({
      'http://h/': { body: page('/_next/static/a.js') },
      'http://h/_next/static/a.js': { body: 'nothing' },
    });
    expect(await findInBundle(base, 'https://api.test', fn)).toBeNull();
  });

  it('AC-IMAGE-07: fetches a duplicated script once', async () => {
    const { fn, requested } = fakeFetch({
      'http://h/': { body: page('/_next/static/a.js', '/_next/static/a.js') },
      'http://h/_next/static/a.js': { body: 'nothing' },
    });
    await findInBundle(base, 'needle', fn);
    expect(requested.filter((url) => url.endsWith('a.js'))).toHaveLength(1);
  });

  it('AC-IMAGE-07: a page or script that is not 200 throws, never reads as not found', async () => {
    const down = fakeFetch({ 'http://h/': { status: 500, body: '' } });
    await expect(findInBundle(base, 'n', down.fn)).rejects.toThrow('returned 500');
    const missing = fakeFetch({ 'http://h/': { body: page('/_next/static/a.js') } });
    await expect(findInBundle(base, 'n', missing.fn)).rejects.toThrow('returned 404');
  });
});
