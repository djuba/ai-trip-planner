// A real HTTP server that streams `/present` bodies chunk by chunk (WU-14 plan D9). `page.route`
// can only fulfil a body in one piece, so `mockApi`'s `{ continueTo }` answer hands the request on to
// this server with `route.continue`. It runs in the Playwright test process on a random port.
//
// A script lists the chunks to write. It can stop after `pauseAfter` chunks until the test calls
// `release()`, so a test can look at the page mid-stream. It ends cleanly (`close`) or by
// destroying the socket (`destroy`), so the body never closes its JSON and the browser's read
// fails, as the real server does when the model fails partway (CLAUDE.md §5, AC-PRESENT-08).
import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { corsHeaders } from './mock-api.ts';

export interface StreamScript {
  chunks: string[];
  /** Write this many chunks, then wait for `release()`. Omit to write them all at once. */
  pauseAfter?: number;
  /** How the body ends. Defaults to `close`. */
  end?: 'close' | 'destroy';
}

export interface StreamServer {
  /** Base URL, e.g. `http://127.0.0.1:54321`. Any path is answered with the current script. */
  url: string;
  /** Sets the script the next request is answered with. */
  serve(script: StreamScript): void;
  /** Lets a paused stream continue. Safe to call when nothing is paused. */
  release(): void;
  close(): Promise<void>;
}

/** Splits a text into chunks of `size` characters (by code point, so no surrogate is split). */
export function chunkText(text: string, size: number): string[] {
  const chars = Array.from(text);
  const chunks: string[] = [];
  for (let i = 0; i < chars.length; i += size) chunks.push(chars.slice(i, i + size).join(''));
  return chunks;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

export async function startStreamServer(): Promise<StreamServer> {
  let script: StreamScript = { chunks: [] };
  let releasers: Array<() => void> = [];
  let released = false;

  async function write(res: ServerResponse, current: StreamScript): Promise<void> {
    for (const [index, chunk] of current.chunks.entries()) {
      if (current.pauseAfter !== undefined && index === current.pauseAfter && !released) {
        await new Promise<void>((resolve) => releasers.push(resolve));
      }
      res.write(chunk);
      await tick(); // separate writes, so the browser sees separate chunks
    }
    if (current.end === 'destroy') res.socket?.destroy();
    else res.end();
  }

  const server: Server = createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders).end();
      return;
    }
    req.resume(); // drain the body
    const current = script;
    res.writeHead(200, { ...corsHeaders, 'content-type': 'text/plain; charset=utf-8' });
    res.flushHeaders();
    void write(res, current);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    serve(next) {
      script = next;
      released = false;
    },
    release() {
      released = true;
      for (const resolve of releasers) resolve();
      releasers = [];
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        released = true;
        for (const resolve of releasers) resolve();
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
