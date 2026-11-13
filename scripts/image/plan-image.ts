// The pure parts of `pnpm test:image` (scripts/test-image.ts; WU-20 plan D5): docker arguments and
// the image checks, kept here so they can be unit-tested without Docker.

export const DOCKERFILE = 'backends/api-nextjs/Dockerfile';
export const IMAGE_TAG = 'vp-api-nextjs:test';
export const PLATFORM = 'linux/amd64';
/** The port the image's server listens on (its PORT default). */
export const CONTAINER_PORT = 8080;

export function buildArgs(tag: string = IMAGE_TAG): string[] {
  return ['build', '--platform', PLATFORM, '-f', DOCKERFILE, '-t', tag, '.'];
}

export interface RunOptions {
  tag?: string;
  name: string;
  hostPort: number;
  env: Readonly<Record<string, string>>;
}

/** Detached, published on loopback only. No --rm, so `docker logs` still works after a crash. */
export function runArgs({ tag = IMAGE_TAG, name, hostPort, env }: RunOptions): string[] {
  const envArgs = Object.entries(env).flatMap(([key, value]) => ['-e', `${key}=${value}`]);
  return [
    'run',
    '--detach',
    '--name',
    name,
    '--publish',
    `127.0.0.1:${hostPort}:${CONTAINER_PORT}`,
    ...envArgs,
    tag,
  ];
}

/**
 * Runs inside the image as its default user, with `node -e`: prints the uid and every `.env*` file
 * under /app (or the directory given as its argument), skipping node_modules, which the build
 * context never carries.
 */
export const PROBE_SCRIPT = `
const fs = require('node:fs');
const path = require('node:path');
const envFiles = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.startsWith('.env')) envFiles.push(full);
  }
};
walk(process.argv[1] ?? '/app');
// getuid is POSIX-only; null elsewhere (the image is Linux, so it is always set there).
const uid = typeof process.getuid === 'function' ? process.getuid() : null;
console.log(JSON.stringify({ uid, envFiles }));
`;

export function probeArgs(tag: string = IMAGE_TAG): string[] {
  return ['run', '--rm', '--entrypoint', 'node', tag, '-e', PROBE_SCRIPT];
}

export function inspectEnvArgs(tag: string = IMAGE_TAG): string[] {
  return ['image', 'inspect', '--format', '{{json .Config.Env}}', tag];
}

const SECRET_NAME = /KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL/i;

/** Names of `NAME=value` entries that look like secrets. Values are never returned or printed. */
export function secretLikeEnvNames(env: readonly string[]): string[] {
  return env.map((entry) => entry.split('=', 1)[0] ?? '').filter((name) => SECRET_NAME.test(name));
}

export interface Probe {
  uid: number | null;
  envFiles: string[];
}

/** Every reason the image fails AC-IMAGE-02/03; empty when it passes. */
export function imageProblems(probe: Probe, configEnv: readonly string[]): string[] {
  const problems: string[] = [];
  if (probe.uid === null) problems.push("the image user's uid could not be read");
  if (probe.uid === 0) problems.push('the image runs as root (uid 0)');
  for (const file of probe.envFiles) problems.push(`the image contains ${file}`);
  for (const name of secretLikeEnvNames(configEnv)) {
    problems.push(`the image config sets ${name}, which looks like a secret`);
  }
  return problems;
}

/**
 * `NAME=value` pairs from Dockerfile `ENV` lines of the single-variable form (`ENV NAME=value`).
 * Multi-line ENV instructions are ignored; the Dockerfile writes its defaults one per line.
 */
export function dockerfileEnvDefaults(dockerfile: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of dockerfile.split(/\r?\n/)) {
    const match = /^ENV\s+([A-Za-z_][A-Za-z0-9_]*)=(\S+)\s*$/.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) result[match[1]] = match[2];
  }
  return result;
}

/** `NAME=value` lines of a dotenv file, skipping comments and blank lines. */
export function dotenvValues(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
    if (match?.[1] !== undefined && match[2] !== undefined) result[match[1]] = match[2].trim();
  }
  return result;
}
