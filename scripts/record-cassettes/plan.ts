// Decides what `pnpm record:cassettes` runs, as a pure function so it can be unit-tested (WU-09 plan D8).

export const PROJECTS = ['integration', 'functional-api'] as const;
export type RecordProject = (typeof PROJECTS)[number];

export type RecordPlan =
  | { kind: 'vitest'; project: RecordProject; filters: string[] }
  | { kind: 'contract'; filters: string[] };

export class RecordPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecordPlanError';
  }
}

function isProject(value: string): value is RecordProject {
  return (PROJECTS as readonly string[]).includes(value);
}

export function planRecord(argv: readonly string[]): RecordPlan {
  let project: RecordProject = 'integration';
  let contract = false;
  const filters: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (arg === '--contract') {
      contract = true;
    } else if (arg === '--project' || arg.startsWith('--project=')) {
      const value = arg === '--project' ? argv[(i += 1)] : arg.slice('--project='.length);
      if (value === undefined || !isProject(value)) {
        throw new RecordPlanError(
          `--project must be one of ${PROJECTS.join(', ')} (got ${value ?? 'nothing'})`,
        );
      }
      project = value;
    } else {
      filters.push(arg);
    }
  }

  if (contract) return { kind: 'contract', filters };
  if (filters.length === 0) {
    throw new RecordPlanError('name the test files to re-record, e.g. llm-client.replay');
  }
  return { kind: 'vitest', project, filters };
}
