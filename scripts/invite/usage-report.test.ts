import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hashInviteCode } from '../../backends/api-nextjs/src/http/invite-code.ts';
import {
  UsageReportError,
  formatUsageReport,
  hostedAccessConfig,
  listUsage,
  serviceLimitEnv,
  tfvarsList,
  tfvarsString,
  usageReport,
  type UsageDocument,
} from './usage-report.ts';

const hash = (code: string) => hashInviteCode(code);
const NOW = Date.UTC(2026, 10, 20, 12, 0);
const HOUR = 60 * 60 * 1000;

const TFVARS = `
project_id = "demo-project"
invite_codes = [
  # "example:<hash>",
  "owner:${hash('o')};extract=none;recommend=none;present=none;hour=30",
  "acme:${hash('a')};recommend=2",
  "old:${hash('x')};expires=2026-11-01", "fresh:${hash('f')}",
]
revoked_invite_codes = [
  "gone:${hash('g')}",
]
`;

const SERVICE_TF = `
  env {
    name  = "QUOTA_EXTRACT"
    value = "40"
  }
  env {
    name  = "QUOTA_RECOMMEND"
    value = "5"
  }
  env {
    name  = "QUOTA_PRESENT"
    value = "5"
  }
  env {
    name  = "RATE_LIMIT_PER_HOUR"
    value = "30"
  }
  env {
    name  = "RATE_LIMIT_GLOBAL_PER_DAY"
    value = "60"
  }
  env {
    name  = "GOOGLE_CLOUD_PROJECT"
    value = var.project_id
  }
`;

const doc = (
  key: string,
  count: number,
  windowStart = 0,
  updatedAt = NOW - HOUR,
): UsageDocument => ({
  key,
  count,
  windowStart,
  updatedAt,
});

describe('reading the Terraform files', () => {
  it('AC-GATE-31: takes the quoted entries of a list, skipping commented-out lines', () => {
    expect(tfvarsList(TFVARS, 'invite_codes').map((entry) => entry.split(':')[0])).toEqual([
      'owner',
      'acme',
      'old',
      'fresh',
    ]);
    expect(tfvarsList(TFVARS, 'revoked_invite_codes')).toHaveLength(1);
    expect(tfvarsList('', 'invite_codes')).toEqual([]);
    expect(tfvarsString(TFVARS, 'project_id')).toBe('demo-project');
  });

  it('AC-GATE-31: reads every service-wide limit from the real infra/service.tf', () => {
    const env = serviceLimitEnv(
      readFileSync(new URL('../../infra/service.tf', import.meta.url), 'utf8'),
    );
    expect(Object.keys(env).sort()).toEqual([
      'QUOTA_EXTRACT',
      'QUOTA_PRESENT',
      'QUOTA_RECOMMEND',
      'RATE_LIMIT_GLOBAL_PER_DAY',
      'RATE_LIMIT_PER_HOUR',
    ]);
    for (const value of Object.values(env)) expect(value).toMatch(/^[1-9][0-9]*$/);
  });

  it('AC-GATE-31: refuses a service.tf that leaves a limit out', () => {
    expect(() => hostedAccessConfig(TFVARS, '')).toThrow(UsageReportError);
  });
});

describe('usageReport', () => {
  const config = hostedAccessConfig(TFVARS, SERVICE_TF);

  it('AC-GATE-31: shows each code’s counts against its own limits, in entry order', () => {
    const report = usageReport(
      config,
      [
        doc('quota:acme:extract', 12, 0, NOW - 3 * HOUR),
        doc('quota:acme:recommend', 2, 0, NOW - 2 * HOUR),
        doc('hour:acme', 3, NOW - 30 * 60 * 1000, NOW - 2 * HOUR),
        doc('hour:owner', 9, NOW - 2 * HOUR),
        doc('quota:gone:extract', 1),
        doc('global:day', 7, NOW - 5 * HOUR),
      ],
      NOW,
    );
    expect(report.rows.map(({ label, status }) => [label, status])).toEqual([
      ['owner', 'active'],
      ['acme', 'active'],
      ['old', 'expired'],
      ['fresh', 'active'],
      ['gone', 'revoked'],
    ]);
    const [owner, acme, , fresh] = report.rows;
    expect(acme).toEqual({
      label: 'acme',
      status: 'active',
      quota: {
        extract: { used: 12, limit: 40 },
        recommend: { used: 2, limit: 2 },
        present: { used: 0, limit: 5 },
      },
      hour: { used: 3, limit: 30 },
      lastUsed: NOW - 2 * HOUR,
    });
    // An ended hourly window counts as empty, as the gate treats it.
    expect(owner?.hour).toEqual({ used: 0, limit: 30 });
    expect(owner?.quota.extract).toEqual({ used: 0, limit: null });
    expect(owner?.lastUsed).toBe(NOW - HOUR);
    expect(fresh?.lastUsed).toBeUndefined();
    expect(report.day).toEqual({ used: 7, limit: 60 });
  });

  it('AC-GATE-31: lists counters for a label with no entry, with unknown limits', () => {
    const report = usageReport(config, [doc('hour:removed', 1, NOW - 60_000)], NOW);
    expect(report.rows.at(-1)).toMatchObject({
      label: 'removed',
      status: 'unlisted',
      hour: { used: 1, limit: undefined },
    });
    expect(report.day).toEqual({ used: 0, limit: 60 });
  });

  it('AC-GATE-31: formats a table with used/limit, never, and the daily total', () => {
    const text = formatUsageReport(
      usageReport(config, [doc('quota:acme:extract', 12, 0, Date.UTC(2026, 10, 19, 9, 5))], NOW),
    );
    const lines = text.split('\n');
    expect(lines[0]).toMatch(
      /^label\s+status\s+extract\s+recommend\s+present\s+this hour\s+last used$/,
    );
    expect(text).toMatch(/owner\s+active\s+0\/none\s+0\/none\s+0\/none\s+0\/30\s+never/);
    expect(text).toMatch(/acme\s+active\s+12\/40\s+0\/2\s+0\/5\s+0\/30\s+2026-11-19 09:05 UTC/);
    expect(text).toContain('All codes today: 0/60');
    expect(text).not.toContain(hash('a'));
  });
});

describe('listUsage', () => {
  it('AC-GATE-31: reads every page of the usage collection, with the caller’s token', async () => {
    const calls: string[] = [];
    const pages = [
      {
        documents: [
          {
            name: 'projects/p/databases/(default)/documents/usage/quota:acme:extract',
            fields: { count: { integerValue: '4' }, windowStart: { integerValue: '0' } },
            updateTime: '2026-11-19T09:05:00.123456Z',
          },
        ],
        nextPageToken: 'next',
      },
      {
        documents: [
          {
            name: 'projects/p/databases/(default)/documents/usage/global:day',
            fields: { count: { integerValue: '7' }, windowStart: { integerValue: '1000' } },
            updateTime: '2026-11-20T10:00:00Z',
          },
        ],
      },
    ];
    const fakeFetch = ((url: URL, init?: RequestInit) => {
      calls.push(String(url));
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer t0ken');
      return Promise.resolve(Response.json(pages[calls.length - 1]));
    }) as typeof fetch;

    expect(await listUsage(fakeFetch, 'p', 't0ken')).toEqual([
      {
        key: 'quota:acme:extract',
        count: 4,
        windowStart: 0,
        updatedAt: Date.parse('2026-11-19T09:05:00.123Z'),
      },
      {
        key: 'global:day',
        count: 7,
        windowStart: 1000,
        updatedAt: Date.parse('2026-11-20T10:00:00Z'),
      },
    ]);
    expect(calls[0]).toBe(
      'https://firestore.googleapis.com/v1/projects/p/databases/(default)/documents/usage?pageSize=300',
    );
    expect(new URL(calls[1] ?? '').searchParams.get('pageToken')).toBe('next');
  });

  it('AC-GATE-31: fails with the HTTP status only', async () => {
    const fakeFetch = (() =>
      Promise.resolve(
        Response.json({ error: { message: 'project p' } }, { status: 403 }),
      )) as typeof fetch;
    const error = await listUsage(fakeFetch, 'p', 't').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UsageReportError);
    expect((error as Error).message).toBe('Firestore answered HTTP 403');
  });
});
