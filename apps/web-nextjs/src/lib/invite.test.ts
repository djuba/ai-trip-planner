// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInviteStore, INVITE_STORAGE_KEY, takeInviteFromUrl } from './invite';

afterEach(() => {
  sessionStorage.clear();
});

function throwingStorage(): Storage {
  return {
    length: 0,
    clear: () => undefined,
    key: () => null,
    removeItem: () => undefined,
    getItem: () => {
      throw new DOMException('blocked', 'SecurityError');
    },
    setItem: () => {
      throw new DOMException('blocked', 'QuotaExceededError');
    },
  };
}

describe('createInviteStore', () => {
  it('AC-CONV-13: has no code until one is set', () => {
    expect(createInviteStore().get()).toBeUndefined();
  });

  it('AC-CONV-13: keeps the code in session storage, so a new page load in the tab sees it', () => {
    createInviteStore().set('abc-123');
    expect(sessionStorage.getItem(INVITE_STORAGE_KEY)).toBe('abc-123');
    expect(createInviteStore().get()).toBe('abc-123');
  });

  it('AC-CONV-13: falls back to memory when storage throws', () => {
    const store = createInviteStore(throwingStorage);
    expect(store.get()).toBeUndefined();
    store.set('abc-123');
    expect(store.get()).toBe('abc-123');
  });

  it('AC-CONV-13: falls back to memory when reading sessionStorage itself throws', () => {
    const store = createInviteStore(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    store.set('abc-123');
    expect(store.get()).toBe('abc-123');
  });

  it('AC-CONV-13: the code set on this page wins over an older stored one', () => {
    sessionStorage.setItem(INVITE_STORAGE_KEY, 'old-code');
    const failingWrite: Storage = {
      ...sessionStorage,
      getItem: (key: string) => sessionStorage.getItem(key),
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError');
      },
    };
    const store = createInviteStore(() => failingWrite);
    expect(store.get()).toBe('old-code');
    store.set('new-code');
    expect(store.get()).toBe('new-code');
  });

  it('AC-CONV-13: falls back to memory when there is no storage at all', () => {
    const store = createInviteStore(() => undefined);
    store.set('abc-123');
    expect(store.get()).toBe('abc-123');
  });
});

describe('takeInviteFromUrl', () => {
  const ROUTER_STATE = { __NA: true, tree: ['router data'] };
  const history = () => ({
    state: ROUTER_STATE as unknown,
    replaceState: vi.fn<(d: unknown, u: string, url?: string) => void>(),
  });

  it('AC-CONV-11: returns the code and removes it, keeping other parameters and the hash', () => {
    const h = history();
    const code = takeInviteFromUrl(
      { href: 'http://localhost:3000/?a=1&invite=%20abc-123%20&b=2#top' },
      h,
    );
    expect(code).toBe('abc-123');
    expect(h.replaceState).toHaveBeenCalledWith(ROUTER_STATE, '', '/?a=1&b=2#top');
  });

  it('AC-CONV-11: leaves a clean address when the code was the only parameter', () => {
    const h = history();
    expect(takeInviteFromUrl({ href: 'http://localhost:3000/?invite=abc' }, h)).toBe('abc');
    expect(h.replaceState).toHaveBeenCalledWith(ROUTER_STATE, '', '/');
  });

  it('AC-CONV-11: does nothing without an invite parameter', () => {
    const h = history();
    expect(takeInviteFromUrl({ href: 'http://localhost:3000/?a=1' }, h)).toBeUndefined();
    expect(h.replaceState).not.toHaveBeenCalled();
  });

  it('AC-CONV-11: removes a blank invite parameter and returns no code', () => {
    const h = history();
    expect(takeInviteFromUrl({ href: 'http://localhost:3000/?invite=%20' }, h)).toBeUndefined();
    expect(h.replaceState).toHaveBeenCalledWith(ROUTER_STATE, '', '/');
  });
});
