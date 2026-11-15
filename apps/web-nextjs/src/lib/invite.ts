// Where the invite code lives in the browser (plan D5): session storage, so it lasts for the tab's
// session and survives a reload, with a memory fallback when storage is blocked (private modes,
// some embedded browsers). It is asked for only after a 401 (WU-22 note).
export const INVITE_STORAGE_KEY = 'vp.inviteCode';

/** The query parameter an invite link carries (`?invite=<code>`). */
export const INVITE_PARAM = 'invite';

export interface InviteStore {
  get(): string | undefined;
  set(code: string): void;
}

function defaultStorage(): Storage | undefined {
  return globalThis.sessionStorage;
}

/**
 * A store over `storage()`. Every storage access is wrapped: reading `sessionStorage` itself can
 * throw (a `SecurityError`), and so can `getItem` and `setItem`. The memory copy holds the last
 * code set on this page and wins over storage, so a failed write can never leave an older stored
 * code in charge. After a reload memory is empty, and the stored code is read.
 */
export function createInviteStore(
  storage: () => Storage | undefined = defaultStorage,
): InviteStore {
  let memory: string | undefined;
  return {
    get() {
      if (memory !== undefined) return memory;
      try {
        const stored = storage()?.getItem(INVITE_STORAGE_KEY);
        if (stored) return stored;
      } catch {
        // Storage is unavailable; fall back to memory.
      }
      return memory;
    },
    set(code) {
      memory = code;
      try {
        storage()?.setItem(INVITE_STORAGE_KEY, code);
      } catch {
        // Storage is unavailable; the memory copy is enough for this page.
      }
    },
  };
}

interface LocationLike {
  href: string;
}
interface HistoryLike {
  readonly state: unknown;
  replaceState(data: unknown, unused: string, url?: string): void;
}

/**
 * Reads an invite link's code and removes it from the address bar, keeping every other query
 * parameter and the hash. Returns the trimmed code, or `undefined` when there is none or it is
 * blank (a blank `invite` parameter is removed too).
 */
export function takeInviteFromUrl(
  location: LocationLike,
  history: HistoryLike,
): string | undefined {
  const url = new URL(location.href);
  if (!url.searchParams.has(INVITE_PARAM)) return undefined;
  const code = url.searchParams.get(INVITE_PARAM)?.trim();
  url.searchParams.delete(INVITE_PARAM);
  // Keep the entry's existing state: Next's App Router stores its own data there.
  history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
  return code ? code : undefined;
}
