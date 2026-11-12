import { describe, it } from 'vitest';
import { targetUrl } from '../support/artifacts.ts';
import { checkMessageCap, checkProfileCaps } from './checks/limits.ts';
import { POST_ENDPOINTS } from './checks/requests.ts';

it('AC-LIMITS-11: a message at the cap is accepted and one over is 422 VALIDATION_FAILED', () =>
  checkMessageCap(targetUrl()));

describe.each(POST_ENDPOINTS)('$path', ({ path }) => {
  it('AC-LIMITS-11: a profile at the region and people caps is accepted, one over is 422', () =>
    checkProfileCaps(targetUrl(), path));
});
