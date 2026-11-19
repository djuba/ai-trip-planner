// `pnpm record:demo`: records the README's demo GIF (docs/assets/demo.gif). It runs the integrated
// stack in replay mode through scripts/run-journeys.ts, with tests/journeys/demo.config.ts, so
// no model is called and nothing costs money. Then ffmpeg turns Playwright's video into a GIF.
// Not a test and in no gate (scripts/record-demo-not-gated.test.ts); needs ffmpeg on PATH.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const resultsDir = join(root, 'tests/journeys/demo-results');
const output = join(root, 'docs/assets/demo.gif');

/** The frames before the first page load are blank; cut them. */
const TRIM_START_SECONDS = '0.8';
// A scroll changes every frame, so these keep the GIF near 5 MB: 12 fps, 720 px, 64 colours, no
// dithering (the UI is flat colour, and dither noise costs bytes on every frame).
const WIDTH = 720;
const FPS = 12;
const COLOURS = 64;

function run(command: string, args: string[]): number {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function findVideo(dir: string): string | undefined {
  const videos: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.webm')) videos.push(path);
    }
  };
  walk(dir);
  return videos.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}

function main(): number {
  if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status !== 0) {
    console.error('record:demo: ffmpeg is not on PATH (macOS: brew install ffmpeg).');
    return 1;
  }
  rmSync(resultsDir, { recursive: true, force: true });

  const recorded = run(process.execPath, ['scripts/run-journeys.ts', '--config', 'demo.config.ts']);
  if (recorded !== 0) return recorded;

  const video = findVideo(resultsDir);
  if (video === undefined) {
    console.error(`record:demo: no video in ${resultsDir}`);
    return 1;
  }

  mkdirSync(join(root, 'docs/assets'), { recursive: true });
  // One pass: a palette made from this video, then dithered onto it, keeps the GIF small and clean.
  const filter = `fps=${FPS},scale=${WIDTH}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=${COLOURS}:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle`;
  const converted = run('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-ss',
    TRIM_START_SECONDS,
    '-i',
    video,
    '-vf',
    filter,
    '-loop',
    '0',
    output,
  ]);
  if (converted !== 0) return converted;

  const sizeMb = (statSync(output).size / 1024 / 1024).toFixed(1);
  console.log(`record:demo: wrote docs/assets/demo.gif (${sizeMb} MB)`);
  return 0;
}

process.exitCode = main();
