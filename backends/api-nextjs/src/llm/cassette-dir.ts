// Where this backend's cassettes live (CLAUDE.md §2; WU-08 plan D8). Resolved here, not in
// config.ts, because config.ts is also compiled for the Edge runtime and must avoid Node APIs.
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** How the workspace root is found; injected so tests don't depend on the real layout. */
export interface Workspace {
  cwd: string;
  exists: (path: string) => boolean;
}

export const CASSETTE_SUBDIR = join('.llm-cassettes', 'api-nextjs');

const processWorkspace = (): Workspace => ({ cwd: process.cwd(), exists: existsSync });

/** The nearest ancestor of `cwd`, itself included, that holds `pnpm-workspace.yaml`. */
export function findWorkspaceRoot({ cwd, exists }: Workspace): string | undefined {
  let dir = resolve(cwd);
  for (;;) {
    if (exists(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * `LLM_CASSETTE_DIR` resolved against the working directory, or else
 * `<workspace root>/.llm-cassettes/api-nextjs`. Throws when neither can be found.
 */
export function resolveCassetteDir(
  configured: string | undefined,
  workspace: Workspace = processWorkspace(),
): string {
  if (configured !== undefined) return resolve(workspace.cwd, configured);
  const root = findWorkspaceRoot(workspace);
  if (root === undefined) {
    throw new Error(
      'No cassette directory: set LLM_CASSETTE_DIR, or run from inside the pnpm workspace.',
    );
  }
  return join(root, CASSETTE_SUBDIR);
}
