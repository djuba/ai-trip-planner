// Decides what `pnpm record:cassettes` runs, as a pure function so it can be unit-tested (WU-09 plan D8).

export const PROJECTS = ['integration', 'functional-api'] as const;
export type RecordProject = (typeof PROJECTS)[number];

export type RecordPlan =
  | { kind: 'vitest'; project: RecordProject; filters: string[] }
  | { kind: 'contract'; filters: string[] }
  | { kind: 'journeys'; filters: string[] }
  | { kind: 'prune' };

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
  let journeys = false;
  let prune = false;
  let projectGiven = false;
  const filters: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (arg === '--contract') {
      contract = true;
    } else if (arg === '--journeys') {
      journeys = true;
    } else if (arg === '--prune') {
      prune = true;
    } else if (arg === '--project' || arg.startsWith('--project=')) {
      const value = arg === '--project' ? argv[(i += 1)] : arg.slice('--project='.length);
      if (value === undefined || !isProject(value)) {
        throw new RecordPlanError(
          `--project must be one of ${PROJECTS.join(', ')} (got ${value ?? 'nothing'})`,
        );
      }
      project = value;
      projectGiven = true;
    } else {
      filters.push(arg);
    }
  }

  if ([contract, journeys, prune, projectGiven].filter(Boolean).length > 1) {
    throw new RecordPlanError('--journeys, --prune, --contract and --project exclude each other');
  }
  if (prune) {
    if (filters.length > 0) throw new RecordPlanError('--prune takes no filters');
    return { kind: 'prune' };
  }
  if (journeys) return { kind: 'journeys', filters };
  if (contract) return { kind: 'contract', filters };
  if (filters.length === 0) {
    throw new RecordPlanError('name the test files to re-record, e.g. llm-client.replay');
  }
  return { kind: 'vitest', project, filters };
}
