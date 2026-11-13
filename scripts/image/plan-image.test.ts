import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CONTAINER_PORT,
  DOCKERFILE,
  PROBE_SCRIPT,
  buildArgs,
  dockerfileEnvDefaults,
  dotenvValues,
  imageProblems,
  probeArgs,
  runArgs,
  secretLikeEnvNames,
} from './plan-image.ts';

const ROOT = new URL('../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), 'utf8');

describe('docker arguments', () => {
  it('AC-IMAGE-01: builds the backend Dockerfile from the repo root for linux/amd64', () => {
    expect(buildArgs('t:1')).toEqual([
      'build',
      '--platform',
      'linux/amd64',
      '-f',
      DOCKERFILE,
      '-t',
      't:1',
      '.',
    ]);
  });

  it('AC-IMAGE-04: runs detached on loopback only, passing each variable', () => {
    const args = runArgs({
      tag: 't:1',
      name: 'c1',
      hostPort: 4123,
      env: { LLM_MODE: 'replay', WEB_ORIGIN: 'http://localhost:3000' },
    });
    expect(args).toEqual([
      'run',
      '--detach',
      '--name',
      'c1',
      '--publish',
      `127.0.0.1:4123:${CONTAINER_PORT}`,
      '-e',
      'LLM_MODE=replay',
      '-e',
      'WEB_ORIGIN=http://localhost:3000',
      't:1',
    ]);
  });

  it('AC-IMAGE-02: probes as the image default user, overriding only the entrypoint', () => {
    const args = probeArgs('t:1');
    expect(args).not.toContain('--user');
    expect(args.slice(0, 5)).toEqual(['run', '--rm', '--entrypoint', 'node', 't:1']);
  });
});

describe('image checks', () => {
  it('AC-IMAGE-02: a root or unknown uid is a problem', () => {
    expect(imageProblems({ uid: 0, envFiles: [] }, [])).toEqual(['the image runs as root (uid 0)']);
    expect(imageProblems({ uid: null, envFiles: [] }, [])).toEqual([
      "the image user's uid could not be read",
    ]);
    expect(imageProblems({ uid: 1000, envFiles: [] }, ['PATH=/usr/bin'])).toEqual([]);
  });

  it('AC-IMAGE-03: an .env file in the image is a problem', () => {
    expect(imageProblems({ uid: 1000, envFiles: ['/app/.env.local'] }, [])).toEqual([
      'the image contains /app/.env.local',
    ]);
  });

  it('AC-IMAGE-03: secret-looking config variables are named, never their values', () => {
    const env = ['PATH=/usr/bin', 'ANTHROPIC_API_KEY=sk-real', 'GH_TOKEN=x', 'LLM_MODE=replay'];
    expect(secretLikeEnvNames(env)).toEqual(['ANTHROPIC_API_KEY', 'GH_TOKEN']);
    const problems = imageProblems({ uid: 1000, envFiles: [] }, env).join('\n');
    expect(problems).toContain('ANTHROPIC_API_KEY');
    expect(problems).not.toContain('sk-real');
  });

  describe('the probe script', () => {
    let dir: string | undefined;
    afterEach(() => {
      if (dir) rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    });

    it('AC-IMAGE-03: finds .env files at any depth, outside node_modules', () => {
      dir = mkdtempSync(join(tmpdir(), 'probe-'));
      mkdirSync(join(dir, 'backends', 'api'), { recursive: true });
      mkdirSync(join(dir, 'node_modules', 'pkg'), { recursive: true });
      writeFileSync(join(dir, 'backends', 'api', '.env.local'), 'X=1');
      writeFileSync(join(dir, 'node_modules', 'pkg', '.env'), 'X=1');
      writeFileSync(join(dir, 'server.js'), '');

      const result = spawnSync(process.execPath, ['-e', PROBE_SCRIPT, dir], { encoding: 'utf8' });
      expect(result.status).toBe(0);
      const probe = JSON.parse(result.stdout) as { envFiles: string[] };
      expect(probe.envFiles).toEqual([join(dir, 'backends', 'api', '.env.local')]);
    });
  });
});

describe('the Dockerfile', () => {
  const defaults = dockerfileEnvDefaults(read(DOCKERFILE));

  it('AC-IMAGE-04: defaults to replay mode, with cassettes at the baked-in path', () => {
    expect(defaults.LLM_MODE).toBe('replay');
    expect(read(DOCKERFILE)).toContain('LLM_CASSETTE_DIR=/app/.llm-cassettes/api-nextjs');
  });

  it('AC-IMAGE-04: its model ID defaults equal .env.example (CLAUDE.md §8.1)', () => {
    const example = dotenvValues(read('.env.example'));
    for (const name of ['MODEL_FAST', 'MODEL_REASONING', 'MODEL_CRITIC']) {
      expect(defaults[name], name).toBeDefined();
      expect(defaults[name], name).toBe(example[name]);
    }
  });

  it('AC-IMAGE-02: runs as the node user', () => {
    expect(read(DOCKERFILE)).toMatch(/^USER node$/m);
  });

  it('AC-IMAGE-03: sets no secret-looking variable', () => {
    const names = Object.keys(defaults).map((name) => `${name}=`);
    expect(secretLikeEnvNames(names)).toEqual([]);
    expect(read(DOCKERFILE)).not.toMatch(/^ARG\s+\S*(KEY|SECRET|TOKEN)/im);
  });
});

describe('parsers', () => {
  it('reads single-variable ENV lines and skips the multi-line form', () => {
    expect(dockerfileEnvDefaults('ENV A=1\nENV B=two \\\n    C=3\nRUN x\nENV D=4\r\n')).toEqual({
      A: '1',
      D: '4',
    });
  });

  it('reads dotenv lines, skipping comments and blanks', () => {
    expect(dotenvValues('# c\n\nA=1\nB=\n  C = x\nD=two words \n')).toEqual({
      A: '1',
      B: '',
      D: 'two words',
    });
  });
});
