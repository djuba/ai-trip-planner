import { describe, expect, it } from 'vitest';
import { FakeFirestore } from '../../tests/support/fake-firestore.ts';
import { describeUsageStore } from '../../tests/support/usage-store-suite.ts';
import {
  FIRESTORE_API,
  FirestoreError,
  FirestoreUsageStore,
  firestoreUsageStoreFromEnv,
  metadataToken,
  projectId,
} from './firestore-usage-store.ts';
import type { Counter } from './usage-store.ts';

const DB = 'projects/p/databases/(default)/documents';
const counter = (key: string, limit = 5): Counter => ({ key, limit, windowMs: null });

function storeOn(
  fake: FakeFirestore,
  collection?: string,
  backoff: (attempt: number) => Promise<void> = () => Promise.resolve(),
): FirestoreUsageStore {
  return new FirestoreUsageStore({
    fetch: fake.fetch,
    endpoint: FIRESTORE_API,
    projectId: () => Promise.resolve('p'),
    token: () => Promise.resolve('tok'),
    backoff,
    ...(collection ? { collection } : {}),
  });
}

describeUsageStore('FirestoreUsageStore on the fake', () => {
  const fake = new FakeFirestore();
  // Real backoff is slower and unequal between instances; with none, two lockstep instances
  // would starve one another. A short, different pause per instance models that.
  const pause = (ms: number) => (attempt: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms * attempt));
  return [storeOn(fake, undefined, pause(1)), storeOn(fake, undefined, pause(3))];
});

describe('FirestoreUsageStore requests', () => {
  it('reads, then commits with preconditions, using the endpoint, project and token', async () => {
    const fake = new FakeFirestore();
    const store = storeOn(fake);
    expect(await store.take([counter('a')], 7)).toEqual({ allowed: true });
    const [read, commit] = fake.calls;
    expect(read?.url).toBe(`${FIRESTORE_API}/projects/p/databases/(default)/documents:batchGet`);
    expect(read?.method).toBe('POST');
    expect(read?.headers.authorization).toBe('Bearer tok');
    expect(read?.body).toEqual({ documents: [`${DB}/usage/a`] });
    expect(commit?.url).toBe(`${FIRESTORE_API}/projects/p/databases/(default)/documents:commit`);
    expect(commit?.body).toEqual({
      writes: [
        {
          update: {
            name: `${DB}/usage/a`,
            fields: { count: { integerValue: '1' }, windowStart: { integerValue: '7' } },
          },
          currentDocument: { exists: false },
        },
      ],
    });
    // The next take carries the document's updateTime as its precondition.
    await store.take([counter('a')], 8);
    const second = fake.calls[3]?.body as { writes: Array<{ currentDocument: object }> };
    expect(second.writes[0]?.currentDocument).toEqual({
      updateTime: expect.stringMatching(/^2030-/) as string,
    });
  });

  it('uses the configured collection', async () => {
    const fake = new FakeFirestore();
    await storeOn(fake, 'other').take([counter('a')], 0);
    expect(fake.get(`${DB}/other/a`)).toBeDefined();
  });

  it('a refused take writes nothing', async () => {
    const fake = new FakeFirestore();
    const store = storeOn(fake);
    await store.take([counter('a', 1)], 0);
    const calls = fake.calls.length;
    expect(await store.take([counter('a', 1)], 0)).toMatchObject({ allowed: false });
    expect(fake.calls).toHaveLength(calls + 1); // the read only
  });

  it('retries after a concurrent write, then succeeds on the fresh count', async () => {
    const fake = new FakeFirestore();
    const store = storeOn(fake);
    await store.take([counter('a')], 0);
    fake.beforeNextCommit(() =>
      fake.set(`${DB}/usage/a`, {
        count: { integerValue: '4' },
        windowStart: { integerValue: '0' },
      }),
    );
    expect(await store.take([counter('a')], 0)).toEqual({ allowed: true });
    expect(fake.get(`${DB}/usage/a`)).toMatchObject({ count: { integerValue: '5' } });
  });

  it('re-reads on a conflict and can then refuse', async () => {
    const fake = new FakeFirestore();
    const store = storeOn(fake);
    await store.take([counter('a')], 0);
    fake.beforeNextCommit(() =>
      fake.set(`${DB}/usage/a`, {
        count: { integerValue: '5' },
        windowStart: { integerValue: '0' },
      }),
    );
    expect(await store.take([counter('a')], 0)).toEqual({
      allowed: false,
      key: 'a',
      resetAt: null,
    });
  });

  it('gives up after 8 attempts with a FirestoreError', async () => {
    const fake = new FakeFirestore();
    const store = storeOn(fake);
    for (let i = 0; i < 8; i += 1) fake.beforeNextCommit(() => fake.set(`${DB}/usage/a`, {}));
    await expect(store.take([counter('a')], 0)).rejects.toThrow(FirestoreError);
    expect(fake.calls.filter((c) => c.url.endsWith(':commit'))).toHaveLength(8);
  });

  it('by default backs off with jitter before a retry, then succeeds', async () => {
    const fake = new FakeFirestore();
    const store = new FirestoreUsageStore({
      fetch: fake.fetch,
      endpoint: FIRESTORE_API,
      projectId: () => Promise.resolve('p'),
      token: () => Promise.resolve('t'),
      random: () => 0,
    });
    fake.beforeNextCommit(() => fake.set(`${DB}/usage/a`, {}));
    expect(await store.take([counter('a')], 0)).toEqual({ allowed: true });
    expect(fake.calls.filter((c) => c.url.endsWith(':commit'))).toHaveLength(2);
  });

  it.each(['ALREADY_EXISTS', 'ABORTED'])('treats %s as a conflict', async (status) => {
    const fake = new FakeFirestore();
    const store = storeOn(fake);
    // Let the read through, fail the commit.
    fake.failNextCommit(409, status);
    expect(await store.take([counter('a')], 0)).toEqual({ allowed: true });
  });

  it('a non-conflict commit error throws FirestoreError without document names', async () => {
    const fake = new FakeFirestore();
    const store = storeOn(fake);
    fake.failNextCommit(503, 'UNAVAILABLE');
    const error = await store.take([counter('secret-key')], 0).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FirestoreError);
    expect((error as Error).message).toBe('commit failed: HTTP 503 UNAVAILABLE');
    expect((error as Error).message).not.toContain('secret-key');
  });

  it('a batchGet failure throws FirestoreError', async () => {
    const fake = new FakeFirestore();
    fake.failNext(500, 'INTERNAL');
    await expect(storeOn(fake).take([counter('a')], 0)).rejects.toThrow(
      'batchGet failed: HTTP 500 INTERNAL',
    );
  });

  it('an error body that is not JSON reports status UNKNOWN', async () => {
    const store = new FirestoreUsageStore({
      fetch: () => Promise.resolve(new Response('<html>', { status: 502 })),
      endpoint: FIRESTORE_API,
      projectId: () => Promise.resolve('p'),
      token: () => Promise.resolve('t'),
    });
    await expect(store.take([counter('a')], 0)).rejects.toThrow('HTTP 502 UNKNOWN');
  });

  it('reads the status from an array-shaped error body', async () => {
    const store = new FirestoreUsageStore({
      fetch: () =>
        Promise.resolve(
          new Response(JSON.stringify([{ error: { status: 'PERMISSION_DENIED' } }]), {
            status: 403,
          }),
        ),
      endpoint: FIRESTORE_API,
      projectId: () => Promise.resolve('p'),
      token: () => Promise.resolve('t'),
    });
    await expect(store.take([counter('a')], 0)).rejects.toThrow('PERMISSION_DENIED');
  });

  it('a failed take does not jam the queue', async () => {
    const fake = new FakeFirestore();
    const store = storeOn(fake);
    fake.failNext(500, 'INTERNAL');
    const first = store.take([counter('a')], 0);
    const second = store.take([counter('a')], 0);
    await expect(first).rejects.toThrow(FirestoreError);
    expect(await second).toEqual({ allowed: true });
  });
});

describe('metadataToken', () => {
  function metadata(expiresIn: number) {
    let n = 0;
    const calls: Array<{ url: string; headers: unknown }> = [];
    const fetchImpl = ((url: string, init?: RequestInit) => {
      n += 1;
      calls.push({ url, headers: init?.headers });
      return Promise.resolve(
        Response.json({ access_token: `token-${String(n)}`, expires_in: expiresIn }),
      );
    }) as typeof fetch;
    return { fetchImpl, calls };
  }

  it('fetches with the metadata-flavor header and caches until a minute before expiry', async () => {
    let now = 0;
    const { fetchImpl, calls } = metadata(3600);
    const token = metadataToken(fetchImpl, () => now);
    expect(await token()).toBe('token-1');
    expect(calls[0]).toEqual({
      url: 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
      headers: { 'metadata-flavor': 'Google' },
    });
    now = 3539_999;
    expect(await token()).toBe('token-1');
    expect(calls).toHaveLength(1);
    now = 3540_000;
    expect(await token()).toBe('token-2');
  });

  it('throws FirestoreError on a failed response', async () => {
    const token = metadataToken(
      () => Promise.resolve(new Response('', { status: 500 })),
      () => 0,
    );
    await expect(token()).rejects.toThrow('metadata token: HTTP 500');
  });
});

describe('projectId', () => {
  it('uses GOOGLE_CLOUD_PROJECT when set, without asking the metadata server', async () => {
    const fetchImpl = (() => {
      throw new Error('unexpected');
    }) as unknown as typeof fetch;
    expect(await projectId(fetchImpl, { GOOGLE_CLOUD_PROJECT: ' proj ' })()).toBe('proj');
  });

  it('otherwise asks the metadata server once and caches it', async () => {
    let calls = 0;
    const fetchImpl = ((url: string, init?: RequestInit) => {
      calls += 1;
      expect(url).toBe('http://metadata.google.internal/computeMetadata/v1/project/project-id');
      expect(init?.headers).toEqual({ 'metadata-flavor': 'Google' });
      return Promise.resolve(new Response(' meta-proj\n'));
    }) as typeof fetch;
    const get = projectId(fetchImpl, {});
    expect(await get()).toBe('meta-proj');
    expect(await get()).toBe('meta-proj');
    expect(calls).toBe(1);
  });

  it('retries after a failed lookup', async () => {
    let calls = 0;
    const fetchImpl = (() => {
      calls += 1;
      return Promise.resolve(calls === 1 ? new Response('', { status: 503 }) : new Response('ok'));
    }) as typeof fetch;
    const get = projectId(fetchImpl, {});
    await expect(get()).rejects.toThrow('metadata project: HTTP 503');
    // Let the rejection handler clear the cache.
    await Promise.resolve();
    expect(await get()).toBe('ok');
  });
});

describe('firestoreUsageStoreFromEnv', () => {
  it('uses the emulator endpoint and the token "owner" when FIRESTORE_EMULATOR_HOST is set', async () => {
    const fake = new FakeFirestore();
    const store = firestoreUsageStoreFromEnv(
      { FIRESTORE_EMULATOR_HOST: 'localhost:8080', GOOGLE_CLOUD_PROJECT: 'p' },
      fake.fetch,
    );
    await store.take([counter('a')], 0);
    expect(fake.calls[0]?.url).toBe(
      'http://localhost:8080/v1/projects/p/databases/(default)/documents:batchGet',
    );
    expect(fake.calls[0]?.headers.authorization).toBe('Bearer owner');
  });

  it('uses Firestore and a metadata token otherwise', async () => {
    const fake = new FakeFirestore();
    const urls: string[] = [];
    const fetchImpl = ((url: string, init?: RequestInit) => {
      urls.push(url);
      if (url.includes('metadata.google.internal')) {
        return Promise.resolve(Response.json({ access_token: 'meta', expires_in: 3600 }));
      }
      return fake.fetch(url, init);
    }) as typeof fetch;
    const store = firestoreUsageStoreFromEnv({ GOOGLE_CLOUD_PROJECT: 'p' }, fetchImpl, () => 0);
    await store.take([counter('a')], 0);
    expect(urls[0]).toContain('service-accounts/default/token');
    expect(urls[1]?.startsWith(FIRESTORE_API)).toBe(true);
    expect(fake.calls[0]?.headers.authorization).toBe('Bearer meta');
  });
});
