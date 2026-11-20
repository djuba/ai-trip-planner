// The logic of `pnpm invite:usage`: joins the invite entries in infra/terraform.tfvars with the
// gate's usage counters in Firestore (infra/README.md, "Usage counts in Firestore"), so each code
// shows what it has used against its limits. Pure apart from the injected fetch, so it can be
// unit-tested. It reads; it never writes a counter.
import {
  loadAccessConfig,
  type AccessConfig,
  type InviteEntry,
  type TripEndpoint,
} from '../../backends/api-nextjs/src/http/access-config.ts';
import { FIRESTORE_API } from '../../backends/api-nextjs/src/http/firestore-usage-store.ts';

const ENDPOINTS: readonly TripEndpoint[] = ['extract', 'recommend', 'present'];
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** The service-wide limits infra/service.tf sets, by the variable the gate reads. */
const LIMIT_VARIABLES = [
  'QUOTA_EXTRACT',
  'QUOTA_RECOMMEND',
  'QUOTA_PRESENT',
  'RATE_LIMIT_PER_HOUR',
  'RATE_LIMIT_GLOBAL_PER_DAY',
] as const;

export class UsageReportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageReportError';
  }
}

// --- Reading the Terraform files (text only: no Terraform needed) --------------------------------

/** The quoted strings of a list variable in a .tfvars file, skipping commented-out lines. */
export function tfvarsList(text: string, name: string): string[] {
  const match = new RegExp(`^\\s*${name}\\s*=\\s*\\[([^\\]]*)\\]`, 'm').exec(text);
  if (match === null) return [];
  return (match[1] ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => !line.startsWith('#'))
    .flatMap((line) => [...line.matchAll(/"([^"]*)"/g)].map(([, value = '']) => value));
}

/** A quoted string variable in a .tfvars file, if set. */
export function tfvarsString(text: string, name: string): string | undefined {
  return new RegExp(`^\\s*${name}\\s*=\\s*"([^"]*)"`, 'm').exec(text)?.[1];
}

/** The service-wide limits from infra/service.tf's `env { name value }` blocks. */
export function serviceLimitEnv(hcl: string): Record<string, string> {
  const env: Record<string, string> = {};
  const block = /env\s*\{\s*name\s*=\s*"([^"]+)"\s*value\s*=\s*(?:"([^"]*)"|([^\s}]+))\s*\}/g;
  for (const [, name = '', quoted, expression] of hcl.matchAll(block)) {
    if ((LIMIT_VARIABLES as readonly string[]).includes(name)) {
      env[name] = quoted ?? expression ?? '';
    }
  }
  return env;
}

/**
 * The gate's configuration as the hosted service sees it: entries from terraform.tfvars, limits
 * from service.tf, parsed by the server's own loader so the two can't disagree.
 */
export function hostedAccessConfig(tfvars: string, serviceTf: string): AccessConfig {
  const limits = serviceLimitEnv(serviceTf);
  const missing = LIMIT_VARIABLES.filter((name) => limits[name] === undefined);
  if (missing.length > 0) {
    throw new UsageReportError(`infra/service.tf sets no ${missing.join(', ')}`);
  }
  return loadAccessConfig(
    {
      ...limits,
      INVITE_CODES: tfvarsList(tfvars, 'invite_codes').join('\n'),
      REVOKED_INVITE_CODES: tfvarsList(tfvars, 'revoked_invite_codes').join('\n'),
    },
    'replay',
  );
}

// --- Reading the counters ------------------------------------------------------------------------

/** One counter document from the `usage` collection. */
export interface UsageDocument {
  /** The document ID, e.g. `quota:acme:extract`, `hour:acme` or `global:day`. */
  key: string;
  count: number;
  windowStart: number;
  /** When it was last written (epoch ms): the last allowed request that touched it. */
  updatedAt: number;
}

interface FirestoreDocument {
  name: string;
  fields?: Record<string, { integerValue?: string }>;
  updateTime: string;
}

/** Every document in the `usage` collection, through Firestore's REST API. */
export async function listUsage(
  fetchImpl: typeof fetch,
  projectId: string,
  token: string,
): Promise<UsageDocument[]> {
  const out: UsageDocument[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(
      `${FIRESTORE_API}/projects/${projectId}/databases/(default)/documents/usage`,
    );
    url.searchParams.set('pageSize', '300');
    if (pageToken !== undefined) url.searchParams.set('pageToken', pageToken);
    const response = await fetchImpl(url, { headers: { authorization: `Bearer ${token}` } });
    // The status only: an error body can name the project.
    if (!response.ok) throw new UsageReportError(`Firestore answered HTTP ${response.status}`);
    const body = (await response.json()) as {
      documents?: FirestoreDocument[];
      nextPageToken?: string;
    };
    for (const doc of body.documents ?? []) {
      out.push({
        key: doc.name.slice(doc.name.lastIndexOf('/') + 1),
        count: Number(doc.fields?.count?.integerValue ?? '0'),
        windowStart: Number(doc.fields?.windowStart?.integerValue ?? '0'),
        updatedAt: Date.parse(doc.updateTime),
      });
    }
    pageToken = body.nextPageToken;
  } while (pageToken !== undefined && pageToken !== '');
  return out;
}

// --- The report ----------------------------------------------------------------------------------

/** Used against a limit: `null` is no limit; `undefined` is unknown (the code has no entry). */
export interface Usage {
  used: number;
  limit: number | null | undefined;
}

export interface UsageRow {
  label: string;
  /** `unlisted`: counters exist for a label that has no entry in terraform.tfvars any more. */
  status: 'active' | 'expired' | 'revoked' | 'unlisted';
  quota: Record<TripEndpoint, Usage>;
  /** Requests in the code's current hourly window; 0 once the window has ended. */
  hour: Usage;
  /** Epoch ms of its last allowed request, or undefined if it has never made one. */
  lastUsed: number | undefined;
}

export interface UsageReport {
  rows: UsageRow[];
  /** Requests in the current daily window, across every code. */
  day: Usage;
}

/** A label's part of a counter key, or undefined for `global:day`. */
function labelOf(key: string): string | undefined {
  const [kind, label] = key.split(':');
  return kind === 'quota' || kind === 'hour' ? label : undefined;
}

const inWindow = (doc: UsageDocument | undefined, windowMs: number, now: number): number =>
  doc !== undefined && now < doc.windowStart + windowMs ? doc.count : 0;

export function usageReport(
  config: Pick<AccessConfig, 'codes' | 'revoked' | 'limits'>,
  documents: readonly UsageDocument[],
  now: number,
): UsageReport {
  const byKey = new Map(documents.map((doc) => [doc.key, doc]));
  const listed = new Set([...config.codes, ...config.revoked].map(({ label }) => label));

  const row = (label: string, status: UsageRow['status'], entry?: InviteEntry): UsageRow => {
    const options = entry?.options;
    const quotaLimit = (endpoint: TripEndpoint): number | null | undefined => {
      if (entry === undefined) return undefined;
      const own = options?.quota?.[endpoint];
      return own === undefined ? config.limits.quota[endpoint] : own;
    };
    const mine = documents.filter((doc) => labelOf(doc.key) === label);
    return {
      label,
      status,
      quota: Object.fromEntries(
        ENDPOINTS.map((endpoint) => [
          endpoint,
          {
            used: byKey.get(`quota:${label}:${endpoint}`)?.count ?? 0,
            limit: quotaLimit(endpoint),
          },
        ]),
      ) as Record<TripEndpoint, Usage>,
      hour: {
        used: inWindow(byKey.get(`hour:${label}`), HOUR_MS, now),
        limit: entry === undefined ? undefined : (options?.perHour ?? config.limits.perHour),
      },
      lastUsed: mine.length === 0 ? undefined : Math.max(...mine.map((doc) => doc.updatedAt)),
    };
  };

  const unlisted = [
    ...new Set(documents.map((doc) => labelOf(doc.key)).filter((label) => label !== undefined)),
  ]
    .filter((label) => !listed.has(label))
    .sort();

  return {
    rows: [
      ...config.codes.map((entry) =>
        row(
          entry.label,
          entry.options?.expiresAt !== undefined && now >= entry.options.expiresAt
            ? 'expired'
            : 'active',
          entry,
        ),
      ),
      ...config.revoked.map((entry) => row(entry.label, 'revoked', entry)),
      ...unlisted.map((label) => row(label, 'unlisted')),
    ],
    day: {
      used: inWindow(byKey.get('global:day'), DAY_MS, now),
      limit: config.limits.globalPerDay,
    },
  };
}

const usage = ({ used, limit }: Usage): string =>
  `${used}/${limit === undefined ? '?' : limit === null ? 'none' : limit}`;

/** `2026-11-20 14:05 UTC`, or `never`. */
const when = (ms: number | undefined): string =>
  ms === undefined ? 'never' : `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`;

/** The report as an aligned text table. */
export function formatUsageReport(report: UsageReport): string {
  const header = ['label', 'status', 'extract', 'recommend', 'present', 'this hour', 'last used'];
  const lines = report.rows.map((r) => [
    r.label,
    r.status,
    usage(r.quota.extract),
    usage(r.quota.recommend),
    usage(r.quota.present),
    usage(r.hour),
    when(r.lastUsed),
  ]);
  const table = [header, ...lines];
  const widths = header.map((_, column) =>
    Math.max(...table.map((cells) => (cells[column] ?? '').length)),
  );
  const text = table.map((cells) =>
    cells
      .map((cell, column) => cell.padEnd(widths[column] ?? 0))
      .join('  ')
      .trimEnd(),
  );
  const notes = [
    `All codes today: ${usage(report.day)}`,
    'Counts are used/limit. "none" is no lifetime quota; "?" is a label with no entry in terraform.tfvars.',
  ];
  return [...text, '', ...notes].join('\n');
}
