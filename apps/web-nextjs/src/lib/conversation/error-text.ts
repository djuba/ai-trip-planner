// Words for an API failure in the conversation view (AC-CONV-09, AC-CONV-12) and the results
// (AC-CARDS-06, AC-CARDS-07). Display only.
import type { ApiError } from '../api/errors.ts';

export interface ErrorText {
  title: string;
  detail: string | null;
  canRetry: boolean;
}

function retryDetail(seconds: number | null): string {
  if (seconds === null) return 'Try again in a little while.';
  if (seconds < 60) {
    const count = Math.max(1, seconds);
    return `Try again in about ${count} ${count === 1 ? 'second' : 'seconds'}.`;
  }
  const minutes = Math.ceil(seconds / 60);
  return `Try again in about ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`;
}

/** Text for an error, or `null` for the kinds handled elsewhere (`aborted`, `unauthorized`). */
export function errorText(error: ApiError): ErrorText | null {
  switch (error.kind) {
    case 'aborted':
    case 'unauthorized':
      return null;
    case 'rate_limited':
      return {
        title: 'Too many requests right now.',
        detail: retryDetail(error.retryAfterSeconds),
        canRetry: true,
      };
    case 'quota_exhausted':
      return {
        title: 'This invite has been used up.',
        detail: 'Ask whoever sent it for a new one.',
        canRetry: false,
      };
    case 'message_too_long':
      return {
        title: 'That message is too long to send.',
        detail: 'Shorten it and send it again.',
        canRetry: false,
      };
    case 'upstream':
      return error.refusal
        ? {
            title: "The planner couldn't help with that request.",
            detail: 'Try rewording it.',
            canRetry: true,
          }
        : {
            title: "The planner couldn't answer just now.",
            detail: 'Try again in a moment.',
            canRetry: true,
          };
    case 'interrupted':
      return {
        title: 'The suggestions stopped partway.',
        detail: 'Try again.',
        canRetry: true,
      };
    case 'network':
      return {
        title: "Can't reach the planner.",
        detail: 'Check your connection and try again.',
        canRetry: true,
      };
    case 'server':
    case 'contract':
    case 'invalid_request':
      return {
        title: 'Something went wrong on our side.',
        detail: 'Try again. If it keeps happening, start over.',
        canRetry: true,
      };
  }
}
