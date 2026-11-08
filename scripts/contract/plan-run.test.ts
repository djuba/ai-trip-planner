import { describe, expect, it } from 'vitest';
import { RunPlanError, planRun } from './plan-run.ts';

describe('planRun', () => {
  it('AC-CONTRACT-11: by default starts its own server', () => {
    expect(planRun([], {})).toEqual({
      startServer: true,
      vitestArgs: [],
      notices: ['Building and starting api-nextjs on a free port for this run.'],
    });
  });

  it('AC-CONTRACT-11: by default ignores an exported API_BASE_URL, and says so', () => {
    const plan = planRun([], { API_BASE_URL: 'http://localhost:4000' });
    expect(plan.startServer).toBe(true);
    expect(plan.notices.join('\n')).toContain('Ignoring API_BASE_URL=http://localhost:4000');
  });

  it('AC-CONTRACT-11: --external targets API_BASE_URL and starts nothing', () => {
    expect(planRun(['--external'], { API_BASE_URL: 'http://127.0.0.1:8000/' })).toEqual({
      startServer: false,
      baseUrl: 'http://127.0.0.1:8000',
      vitestArgs: [],
      notices: [
        'Testing the backend at http://127.0.0.1:8000 (--external; not started by this run).',
      ],
    });
  });

  it('AC-CONTRACT-11: --external without API_BASE_URL is an error', () => {
    expect(() => planRun(['--external'], {})).toThrow(RunPlanError);
    expect(() => planRun(['--external'], { API_BASE_URL: '  ' })).toThrow(RunPlanError);
  });

  it('AC-CONTRACT-11: --external with an API_BASE_URL that is not a URL is an error', () => {
    expect(() => planRun(['--external'], { API_BASE_URL: 'localhost' })).toThrow(/not a URL/);
  });

  it('passes other arguments through to Vitest', () => {
    expect(
      planRun(['--external', '-t', 'health'], { API_BASE_URL: 'http://h:1' }).vitestArgs,
    ).toEqual(['-t', 'health']);
    expect(planRun(['-t', 'cors'], {}).vitestArgs).toEqual(['-t', 'cors']);
  });
});
