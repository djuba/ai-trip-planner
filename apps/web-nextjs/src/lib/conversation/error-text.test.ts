import { describe, expect, it } from 'vitest';
import type { ApiError } from '../api/errors.ts';
import { errorText } from './error-text.ts';

const rate = (retryAfterSeconds: number | null) =>
  errorText({ kind: 'rate_limited', retryAfterSeconds });

describe('errorText', () => {
  it('AC-CONV-09: aborted and unauthorized are handled elsewhere', () => {
    expect(errorText({ kind: 'aborted' })).toBeNull();
    expect(errorText({ kind: 'unauthorized' })).toBeNull();
  });

  it('AC-CONV-09: rate limits say how long to wait', () => {
    const cases: [number | null, string][] = [
      [null, 'Try again in a little while.'],
      [0, 'Try again in about 1 second.'],
      [1, 'Try again in about 1 second.'],
      [59, 'Try again in about 59 seconds.'],
      [60, 'Try again in about 1 minute.'],
      [61, 'Try again in about 2 minutes.'],
      [120, 'Try again in about 2 minutes.'],
    ];
    for (const [seconds, detail] of cases) {
      expect(rate(seconds)).toEqual({
        title: 'Too many requests right now.',
        detail,
        canRetry: true,
      });
    }
  });

  it('AC-CONV-12: a spent quota cannot be retried', () => {
    expect(errorText({ kind: 'quota_exhausted' })).toEqual({
      title: 'This invite has been used up.',
      detail: 'Ask whoever sent it for a new one.',
      canRetry: false,
    });
  });

  it('AC-CONV-09: a long message cannot be retried as is', () => {
    expect(errorText({ kind: 'message_too_long' })).toEqual({
      title: 'That message is too long to send.',
      detail: 'Shorten it and send it again.',
      canRetry: false,
    });
  });

  it('AC-CONV-09: upstream failures differ for a refusal', () => {
    expect(errorText({ kind: 'upstream', refusal: false })).toEqual({
      title: "The planner couldn't answer just now.",
      detail: 'Try again in a moment.',
      canRetry: true,
    });
    expect(errorText({ kind: 'upstream', refusal: true })).toEqual({
      title: "The planner couldn't help with that request.",
      detail: 'Try rewording it.',
      canRetry: true,
    });
  });

  it('AC-CONV-09: network failures can be retried', () => {
    expect(errorText({ kind: 'network' })).toEqual({
      title: "Can't reach the planner.",
      detail: 'Check your connection and try again.',
      canRetry: true,
    });
  });

  it('AC-CONV-09: server, contract and invalid_request share one text', () => {
    const errors: ApiError[] = [
      { kind: 'server', status: 500 },
      { kind: 'contract', detail: 'x' },
      { kind: 'invalid_request', message: 'y' },
    ];
    for (const error of errors) {
      expect(errorText(error)).toEqual({
        title: 'Something went wrong on our side.',
        detail: 'Try again. If it keeps happening, start over.',
        canRetry: true,
      });
    }
  });
});

describe('errorText for the results', () => {
  it('AC-CARDS-06: a stream that stopped partway can be retried', () => {
    expect(errorText({ kind: 'interrupted' })).toEqual({
      title: 'The suggestions stopped partway.',
      detail: 'Try again.',
      canRetry: true,
    });
  });
});
