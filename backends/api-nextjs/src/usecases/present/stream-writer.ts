// Writes the `/v1/trip/present` JSON stream from the model's partial copy (WU-11 plan D3, D4; ADR
// 0004 WU-11 addendum). The model's own text never reaches the client: code renders the wire
// `PresentationModel`, in a fixed key order, with `recommendationId` and `claims` from the request.
// Each push renders the open prefix of the object so far and returns only what extends the text
// already sent, so every chunk is a prefix of the final text. Pure: no clock, no I/O.
import {
  MAX_BLURB_LENGTH,
  MAX_CARD_TITLE_LENGTH,
  MAX_HEADLINE_LENGTH,
  MAX_HIGHLIGHT_LENGTH,
  MAX_HIGHLIGHTS,
  MAX_INTRO_LENGTH,
  type FactualClaim,
  type PresentationCopy,
} from '@vp/domain-schema/wire';
import type { PartialObject } from '../llm-client.ts';

/** What code knows about each card before the model writes anything. */
export interface CardInput {
  recommendationId: string;
  claims: FactualClaim[];
  /** The card's copy if the model writes none (plan D3: title = destination, blurb = summary). */
  fallback: { title: string; blurb: string; highlights: string[] };
}

/** A cut or a drop, for the server log (ADR 0004 §4): never the value itself. */
export interface PresentDiscard {
  /** JSON Pointer into the wire `PresentationModel`, e.g. `/cards/1/blurb`. */
  path: string;
  reason: 'truncated' | 'too_many_items';
  /** The cap. */
  limit: number;
  /** The length the model wrote, in code points, or its item count. */
  actual: number;
}

/** A word still being written is held back, unless it is longer than this (plan D4). */
export const MAX_HELD_RUN = 32;

const ELLIPSIS = '…';

/** The final text no longer extends what was sent. A bug: the stream can't be taken back. */
export class StreamWriterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StreamWriterError';
  }
}

const isWhitespace = (char: string): boolean => /\s/u.test(char);
const isHighSurrogate = (char: string): boolean => /^[\uD800-\uDBFF]$/.test(char);

/** Where a string over its cap is cut: the last word boundary in reach, or cap − 1 (plan D4). */
function cutPoint(window: readonly string[]): number {
  let boundary = -1;
  for (let i = window.length - 1; i >= 0; i--) {
    if (isWhitespace(window[i] ?? '')) {
      boundary = i;
      break;
    }
  }
  return boundary === -1 || window.length - 1 - boundary > MAX_HELD_RUN ? window.length : boundary;
}

/** A finished string as sent: whole within its cap, otherwise cut with "…" (within the cap). */
export function capString(value: string, cap: number): { text: string; cut: boolean } {
  const points = [...value];
  if (points.length <= cap) return { text: value, cut: false };
  const window = points.slice(0, cap - 1);
  return { text: window.slice(0, cutPoint(window)).join('') + ELLIPSIS, cut: true };
}

/**
 * How much of a string still being written can go out now: text up to its last whitespace, or
 * all of it once the held run passes `MAX_HELD_RUN`, never past cap − 1, never ending in half a
 * surrogate pair. `undefined` means the string is already certain to be cut: send the cut instead.
 */
function openPrefix(value: string, cap: number): string | undefined {
  const points = [...value];
  if (points.length > cap) return undefined;
  let window = points.slice(0, cap - 1);
  if (window.length > 0 && isHighSurrogate(window[window.length - 1] ?? '')) {
    window = window.slice(0, -1);
  }
  // A first word is held back too, until it ends or passes MAX_HELD_RUN (review fix 4).
  if (!window.some(isWhitespace) && window.length <= MAX_HELD_RUN) return '';
  return window.slice(0, cutPoint(window)).join('');
}

/** Thrown inside a render to stop at the first field not yet ready; never escapes the module. */
class Stop extends Error {}
const STOP = new Stop('Not ready yet');

class Render {
  text = '';
  readonly onDiscard: (entry: PresentDiscard) => void;

  constructor(onDiscard: (entry: PresentDiscard) => void) {
    this.onDiscard = onDiscard;
  }

  raw(text: string): void {
    this.text += text;
  }

  /** A model-written string: whole when complete, its open prefix when not, or stop if absent. */
  string(value: unknown, complete: boolean, cap: number, path: string): void {
    if (typeof value !== 'string') throw STOP;
    if (complete) {
      const { text, cut } = capString(value, cap);
      if (cut) this.onDiscard({ path, reason: 'truncated', limit: cap, actual: [...value].length });
      this.raw(JSON.stringify(text));
      return;
    }
    const prefix = openPrefix(value, cap);
    if (prefix === undefined) {
      // Certain to be cut, and the cut is already known: send it, and close the string.
      this.raw(JSON.stringify(capString(value, cap).text));
      return;
    }
    this.raw(JSON.stringify(prefix).slice(0, -1));
    throw STOP;
  }
}

/**
 * A field is complete once the model has started another key after it, in the order the keys
 * actually arrived (the parser keeps it), or the stream has ended. Judging by schema order instead
 * would close a field early when the model writes keys out of order (review fix 2).
 */
function done(object: unknown, key: string): boolean {
  if (typeof object !== 'object' || object === null) return false;
  const keys = Object.keys(object);
  const at = keys.indexOf(key);
  return at !== -1 && at < keys.length - 1;
}

type CopySnapshot = PartialObject<PresentationCopy>;
type CardSnapshot = NonNullable<CopySnapshot['cards']>[number];

function renderCard(
  out: Render,
  index: number,
  card: CardInput,
  copy: CardSnapshot | undefined,
  complete: boolean,
): void {
  const path = `/cards/${index}`;
  const source = copy ?? (complete ? card.fallback : undefined);
  if (source === undefined) throw STOP;
  out.raw(
    `{"recommendationId":${JSON.stringify(card.recommendationId)},` +
      `"claims":${JSON.stringify(card.claims)},"title":`,
  );
  out.string(
    source.title,
    complete || done(source, 'title'),
    MAX_CARD_TITLE_LENGTH,
    `${path}/title`,
  );
  out.raw(',"blurb":');
  out.string(source.blurb, complete || done(source, 'blurb'), MAX_BLURB_LENGTH, `${path}/blurb`);
  out.raw(',"highlights":[');
  const highlights = source.highlights;
  if (!Array.isArray(highlights)) throw STOP;
  if (complete && highlights.length > MAX_HIGHLIGHTS) {
    out.onDiscard({
      path: `${path}/highlights/${MAX_HIGHLIGHTS}`,
      reason: 'too_many_items',
      limit: MAX_HIGHLIGHTS,
      actual: highlights.length,
    });
  }
  const kept = highlights.slice(0, MAX_HIGHLIGHTS);
  kept.forEach((highlight, i) => {
    if (i > 0) out.raw(',');
    out.string(
      highlight,
      complete || i < highlights.length - 1,
      MAX_HIGHLIGHT_LENGTH,
      `${path}/highlights/${i}`,
    );
  });
  // Past the count cap nothing more can be shown; until the card ends the list stays open.
  if (!complete) throw STOP;
  out.raw(']}');
}

/** The wire text for `copy`: an open prefix while `final` is false, the whole object when true. */
function render(
  copy: CopySnapshot,
  cards: readonly CardInput[],
  final: boolean,
  onDiscard: (entry: PresentDiscard) => void,
): string {
  const out = new Render(onDiscard);
  try {
    out.raw('{"headline":');
    out.string(copy.headline, final || done(copy, 'headline'), MAX_HEADLINE_LENGTH, '/headline');
    out.raw(',"intro":');
    out.string(copy.intro, final || done(copy, 'intro'), MAX_INTRO_LENGTH, '/intro');
    out.raw(',"cards":[');
    const written = Array.isArray(copy.cards) ? copy.cards : undefined;
    if (written === undefined && !final) throw STOP;
    const model = written ?? [];
    if (final && model.length > cards.length) {
      onDiscard({
        path: `/cards/${cards.length}`,
        reason: 'too_many_items',
        limit: cards.length,
        actual: model.length,
      });
    }
    cards.forEach((card, i) => {
      if (i > 0) out.raw(',');
      renderCard(out, i, card, model[i], final || i < model.length - 1);
    });
    out.raw(']}');
  } catch (error) {
    if (error !== STOP) throw error;
  }
  return out.text;
}

export interface StreamWriter {
  /** The text to send for this snapshot: what extends the text sent so far, or ''. */
  push(snapshot: CopySnapshot): string;
  /** The rest of the text for the finished copy, closing every bracket. */
  finish(copy: PresentationCopy): string;
  /** Everything sent so far. */
  readonly sent: string;
  /** Cuts and drops, once each, in the order they were first seen. */
  readonly discarded: readonly PresentDiscard[];
}

export function createStreamWriter(cards: readonly CardInput[]): StreamWriter {
  let sent = '';
  const discards = new Map<string, PresentDiscard>();
  const noteDiscard = (entry: PresentDiscard) => {
    // A string seen complete twice reports the length it had the last time.
    discards.set(entry.path, entry);
  };

  const extend = (text: string): string | undefined => {
    if (!text.startsWith(sent)) return undefined;
    const delta = text.slice(sent.length);
    sent = text;
    return delta;
  };

  return {
    push(snapshot) {
      // A snapshot that would not extend the text (a parser repair that changed earlier text) is
      // skipped: the next one, or the final object, catches up.
      return extend(render(snapshot, cards, false, noteDiscard)) ?? '';
    },
    finish(copy) {
      const delta = extend(render(copy, cards, true, noteDiscard));
      if (delta === undefined) {
        throw new StreamWriterError('The final presentation does not extend the streamed text.');
      }
      return delta;
    },
    get sent() {
      return sent;
    },
    get discarded() {
      return [...discards.values()];
    },
  };
}
