// Finding a string in the JavaScript a web page loads (WU-23b plan D2). Pure apart from the injected
// fetch, so `pnpm test:image` and a later release smoke check can share it.

type FetchFn = (url: string) => Promise<Response>;

const SCRIPT_SRC = /<script\b[^>]*?\bsrc=(["'])(.*?)\1/gi;

/** Unique same-origin `/_next/static/...js` script paths in the HTML, in document order. */
export function scriptPaths(html: string): string[] {
  const paths = new Set<string>();
  for (const match of html.matchAll(SCRIPT_SRC)) {
    const src = match[2] ?? '';
    // Same-origin only: a root-relative path, not protocol-relative or absolute. Drop any query.
    if (!src.startsWith('/') || src.startsWith('//')) continue;
    const path = src.split(/[?#]/, 1)[0] ?? '';
    if (path.startsWith('/_next/static/') && path.endsWith('.js')) paths.add(path);
  }
  return [...paths];
}

/**
 * GETs `/`, then each script it references, and returns the first script path containing `needle`,
 * or null when none does. Throws when `/` or a script is not a 200, so a broken page is never
 * mistaken for "not found".
 */
export async function findInBundle(
  baseUrl: string,
  needle: string,
  fetchFn: FetchFn = fetch,
): Promise<string | null> {
  const page = await fetchFn(`${baseUrl}/`);
  if (page.status !== 200) throw new Error(`GET ${baseUrl}/ returned ${page.status}`);
  for (const path of scriptPaths(await page.text())) {
    const script = await fetchFn(`${baseUrl}${path}`);
    if (script.status !== 200) throw new Error(`GET ${baseUrl}${path} returned ${script.status}`);
    if ((await script.text()).includes(needle)) return path;
  }
  return null;
}
