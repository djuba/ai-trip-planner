// Usage counters in Firestore, through its REST API (WU-23a plan D1). A take is one read and, when
// allowed, one atomic commit whose writes each carry a precondition, so a counter can never pass
// its limit even when two instances race: the loser's commit fails, and it reads again. Takes from
// this instance are queued, so it never races itself. A refused request writes nothing.
import {
  decide,
  type Counter,
  type Slot,
  type TakeResult,
  type UsageStore,
} from './usage-store.ts';

export const FIRESTORE_API = 'https://firestore.googleapis.com/v1';
const METADATA = 'http://metadata.google.internal/computeMetadata/v1';
const REQUEST_TIMEOUT_MS = 5_000;
const MAX_ATTEMPTS = 8;
/** Statuses that mean another writer changed a document between our read and our commit. */
const CONFLICTS = new Set(['FAILED_PRECONDITION', 'ALREADY_EXISTS', 'ABORTED']);

type Fetch = typeof fetch;

/** A Firestore call failed. Holds statuses only: a response body may name documents. */
export class FirestoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FirestoreError';
  }
}

export interface FirestoreUsageStoreOptions {
  fetch: Fetch;
  /** `FIRESTORE_API`, or `http://<host>/v1` for the emulator. */
  endpoint: string;
  projectId: () => Promise<string>;
  /** An OAuth access token for the request. */
  token: () => Promise<string>;
  collection?: string;
  /** Pause before retry n (1-based); injectable so tests don't wait. */
  backoff?: (attempt: number) => Promise<void>;
  /** The default backoff's jitter source, in [0, 1). */
  random?: () => number;
}

interface Value {
  integerValue?: string;
}
interface Document {
  name: string;
  fields?: Record<string, Value>;
  updateTime: string;
}
type BatchGetItem = { found: Document } | { missing: string };
type Precondition = { exists: false } | { updateTime: string };

const integer = (value: Value | undefined): number => Number(value?.integerValue ?? '0');

/**
 * Exponential backoff with jitter: about 50, 100, 200 … ms, each scaled by 0.5–1.5. Without the
 * jitter, two instances that collide once retry in lockstep and the same one loses every time.
 */
const pause = (random: () => number) => (attempt: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, 25 * 2 ** attempt * (0.5 + random())));

export class FirestoreUsageStore implements UsageStore {
  readonly #options: Required<Omit<FirestoreUsageStoreOptions, 'backoff' | 'random'>> &
    Pick<FirestoreUsageStoreOptions, 'backoff'>;
  readonly #backoff: (attempt: number) => Promise<void>;
  #queue: Promise<unknown> = Promise.resolve();

  constructor(options: FirestoreUsageStoreOptions) {
    this.#options = { collection: 'usage', ...options };
    this.#backoff = options.backoff ?? pause(options.random ?? Math.random);
  }

  take(counters: readonly Counter[], now: number): Promise<TakeResult> {
    const run = this.#queue.then(() => this.#take(counters, now));
    // The queue continues after a failure; the caller still sees it.
    this.#queue = run.catch(() => undefined);
    return run;
  }

  async #take(counters: readonly Counter[], now: number): Promise<TakeResult> {
    const database = `projects/${await this.#options.projectId()}/databases/(default)`;
    const names = counters.map(
      ({ key }) => `${database}/documents/${this.#options.collection}/${key}`,
    );
    for (let attempt = 1; ; attempt += 1) {
      const documents = await this.#read(database, names);
      const slots: Array<Slot | undefined> = names.map((name) => {
        const doc = documents.get(name);
        return doc === undefined
          ? undefined
          : { count: integer(doc.fields?.count), windowStart: integer(doc.fields?.windowStart) };
      });
      const { result, next } = decide(counters, slots, now);
      if (!result.allowed) return result;

      const writes = names.map((name, index) => {
        const slot = next[index] as Slot;
        const existing = documents.get(name);
        const currentDocument: Precondition =
          existing === undefined ? { exists: false } : { updateTime: existing.updateTime };
        return {
          update: {
            name,
            fields: {
              count: { integerValue: String(slot.count) },
              windowStart: { integerValue: String(slot.windowStart) },
            },
          },
          currentDocument,
        };
      });
      if (await this.#commit(database, writes)) return result;
      if (attempt >= MAX_ATTEMPTS) {
        throw new FirestoreError(`usage counters still contended after ${MAX_ATTEMPTS} attempts`);
      }
      await this.#backoff(attempt);
    }
  }

  async #read(database: string, names: string[]): Promise<Map<string, Document>> {
    const response = await this.#call(`${database}/documents:batchGet`, { documents: names });
    if (!response.ok) throw await this.#error('batchGet', response);
    const items = (await response.json()) as BatchGetItem[];
    const found = new Map<string, Document>();
    for (const item of items) if ('found' in item) found.set(item.found.name, item.found);
    return found;
  }

  /** True when committed; false when a precondition failed (a concurrent writer). */
  async #commit(database: string, writes: unknown[]): Promise<boolean> {
    const response = await this.#call(`${database}/documents:commit`, { writes });
    if (response.ok) return true;
    const status = await errorStatus(response);
    if (CONFLICTS.has(status)) return false;
    throw new FirestoreError(`commit failed: HTTP ${response.status} ${status}`);
  }

  async #call(path: string, body: unknown): Promise<Response> {
    return this.#options.fetch(`${this.#options.endpoint}/${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${await this.#options.token()}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  }

  async #error(call: string, response: Response): Promise<FirestoreError> {
    return new FirestoreError(
      `${call} failed: HTTP ${response.status} ${await errorStatus(response)}`,
    );
  }
}

/** The canonical status (e.g. `FAILED_PRECONDITION`) of a Google API error body, if any. */
async function errorStatus(response: Response): Promise<string> {
  try {
    const body = await response.json();
    const first = Array.isArray(body) ? (body[0] as unknown) : body;
    const status = (first as { error?: { status?: unknown } } | undefined)?.error?.status;
    return typeof status === 'string' ? status : 'UNKNOWN';
  } catch {
    return 'UNKNOWN';
  }
}

/**
 * Access tokens from Cloud Run's metadata server, for the service's own account. Cached until a
 * minute before they expire; `now` is injected for tests.
 */
export function metadataToken(fetchImpl: Fetch, now: () => number): () => Promise<string> {
  let cached: { token: string; expiresAt: number } | undefined;
  return async () => {
    if (cached !== undefined && now() < cached.expiresAt) return cached.token;
    const response = await fetchImpl(`${METADATA}/instance/service-accounts/default/token`, {
      headers: { 'metadata-flavor': 'Google' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new FirestoreError(`metadata token: HTTP ${response.status}`);
    const { access_token, expires_in } = (await response.json()) as {
      access_token: string;
      expires_in: number;
    };
    cached = { token: access_token, expiresAt: now() + (expires_in - 60) * 1000 };
    return access_token;
  };
}

/** The project ID: `GOOGLE_CLOUD_PROJECT` if set, else from the metadata server (once). */
export function projectId(
  fetchImpl: Fetch,
  env: Record<string, string | undefined>,
): () => Promise<string> {
  let cached: Promise<string> | undefined;
  return () => {
    const configured = env.GOOGLE_CLOUD_PROJECT?.trim();
    if (configured) return Promise.resolve(configured);
    cached ??= (async () => {
      const response = await fetchImpl(`${METADATA}/project/project-id`, {
        headers: { 'metadata-flavor': 'Google' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) throw new FirestoreError(`metadata project: HTTP ${response.status}`);
      return (await response.text()).trim();
    })();
    // A failed lookup is retried on the next request.
    cached.catch(() => {
      cached = undefined;
    });
    return cached;
  };
}

/**
 * The store for this environment: the emulator when FIRESTORE_EMULATOR_HOST is set (it accepts
 * the fixed token `owner`), else Firestore with the metadata server's credentials.
 */
export function firestoreUsageStoreFromEnv(
  env: Record<string, string | undefined>,
  fetchImpl: Fetch = fetch,
  now: () => number = () => Date.now(),
): FirestoreUsageStore {
  const emulator = env.FIRESTORE_EMULATOR_HOST?.trim();
  return new FirestoreUsageStore({
    fetch: fetchImpl,
    endpoint: emulator ? `http://${emulator}/v1` : FIRESTORE_API,
    projectId: projectId(fetchImpl, env),
    token: emulator ? () => Promise.resolve('owner') : metadataToken(fetchImpl, now),
  });
}
