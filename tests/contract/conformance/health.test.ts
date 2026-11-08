import { it } from 'vitest';
import { targetUrl } from '../support/artifacts.ts';
import { checkHealth } from './checks/health.ts';

it('AC-CONTRACT-01: GET /v1/health is a valid HealthResponse with the contract version', () =>
  checkHealth(targetUrl()));
