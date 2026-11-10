// Route Handlers only (CLAUDE.md §9). Plain ESM because Next compiles next.config.ts to CommonJS,
// where import.meta.dirname isn't reliable.
import { existsSync } from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '../..');

// .env.local sits at the repo root, beside .env.example, but Next only reads its own directory.
// Variables already set win, so the test harness's explicit env can't be overridden from the file.
const rootEnvFile = path.join(repoRoot, '.env.local');
if (existsSync(rootEnvFile)) process.loadEnvFile(rootEnvFile);

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@vp/domain-schema'],
  poweredByHeader: false,
  // Stops `next dev` writing an AGENTS.md when it detects a coding agent; CLAUDE.md governs here.
  agentRules: false,
  outputFileTracingRoot: repoRoot,
  turbopack: { root: repoRoot },
  // `pnpm typecheck` is the gate; the build doesn't need to run it a second time.
  typescript: { ignoreBuildErrors: true },
};

export default nextConfig;
