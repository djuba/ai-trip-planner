// An in-memory stand-in for the slice of Firestore's REST API the usage store uses (WU-23a plan
// D1), handed to the store as its `fetch`. It models the emulator: `batchGet` returns found or
// missing per document; `commit` applies every write or none, each checked against its
// precondition, and fails with HTTP 400 FAILED_PRECONDITION when one doesn't hold. The emulator
// test (tests/firestore/) is what proves this fake matches the real thing.

interface StoredDoc {
  fields: Record<string, unknown>;
  createTime: string;
  updateTime: string;
}

interface Write {
  update: { name: string; fields: Record<string, unknown> };
  currentDocument?: { exists?: boolean; updateTime?: string };
}

export interface RecordedCall {
  url: string;
  method: string | undefined;
  headers: Record<string, string>;
  body: unknown;
}

export class FakeFirestore {
  readonly #docs = new Map<string, StoredDoc>();
  #clock = 0;
  #failures: Array<{ http: number; status: string }> = [];
  #beforeCommit: Array<() => void> = [];
  #commitFailures: Array<{ http: number; status: string }> = [];
  readonly calls: RecordedCall[] = [];

  /** Use as the store's `fetch`. */
  readonly fetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    this.calls.push({ url, method: init?.method, headers, body });

    const failure = this.#failures.shift();
    if (failure) return Promise.resolve(errorResponse(failure.http, failure.status));
    // Yield, so calls from two stores interleave as they would over a network.
    return Promise.resolve().then(() => {
      if (url.endsWith('/documents:batchGet'))
        return this.#batchGet(body as { documents: string[] });
      if (url.endsWith('/documents:commit')) return this.#commit(body as { writes: Write[] });
      return errorResponse(404, 'NOT_FOUND');
    });
  };

  /** Fail the next call with this HTTP status and Google status. */
  failNext(http: number, status: string): void {
    this.#failures.push({ http, status });
  }

  /** Fail the next commit (after its read succeeded) with this HTTP status and Google status. */
  failNextCommit(http: number, status: string): void {
    this.#commitFailures.push({ http, status });
  }

  /** Run `hook` just before the next commit is checked, e.g. to write as a concurrent instance. */
  beforeNextCommit(hook: () => void): void {
    this.#beforeCommit.push(hook);
  }

  /** Write a document directly, as another writer would. */
  set(name: string, fields: Record<string, unknown>): void {
    const existing = this.#docs.get(name);
    const updateTime = this.#timestamp();
    this.#docs.set(name, { fields, createTime: existing?.createTime ?? updateTime, updateTime });
  }

  get(name: string): Record<string, unknown> | undefined {
    return this.#docs.get(name)?.fields;
  }

  get size(): number {
    return this.#docs.size;
  }

  /** Strictly increasing, with no wall clock. */
  #timestamp(): string {
    this.#clock += 1;
    return `2030-01-01T00:00:00.${String(this.#clock).padStart(9, '0')}Z`;
  }

  #batchGet({ documents }: { documents: string[] }): Response {
    const readTime = this.#timestamp();
    const items = documents.map((name) => {
      const doc = this.#docs.get(name);
      return doc === undefined
        ? { missing: name, readTime }
        : { found: { name, ...doc }, readTime };
    });
    return json(items);
  }

  #commit({ writes }: { writes: Write[] }): Response {
    this.#beforeCommit.shift()?.();
    const failure = this.#commitFailures.shift();
    if (failure) return errorResponse(failure.http, failure.status);
    for (const { update, currentDocument } of writes) {
      const existing = this.#docs.get(update.name);
      if (currentDocument?.exists === false && existing !== undefined) {
        return errorResponse(400, 'FAILED_PRECONDITION', `${update.name} already exists`);
      }
      if (
        currentDocument?.updateTime !== undefined &&
        existing?.updateTime !== currentDocument.updateTime
      ) {
        return errorResponse(400, 'FAILED_PRECONDITION', `${update.name} was changed`);
      }
    }
    const commitTime = this.#timestamp();
    for (const { update } of writes) this.set(update.name, update.fields);
    return json({ writeResults: writes.map(() => ({ updateTime: commitTime })), commitTime });
  }
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function errorResponse(http: number, status: string, message = 'fake failure'): Response {
  return new Response(JSON.stringify({ error: { code: http, status, message } }), {
    status: http,
    headers: { 'content-type': 'application/json' },
  });
}
