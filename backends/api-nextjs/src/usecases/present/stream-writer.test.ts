// The /present stream writer (WU-11 plan D3, D4). The model's text is split into chunks at every
// kind of boundary (inside escapes, surrogate pairs, keys), parsed as the adapter parses it, and
// pushed through the writer: what goes out must always extend what went out before, end as valid
// PresentationModel JSON, and keep every cap.
import {
  codePointLength,
  MAX_BLURB_LENGTH,
  MAX_CARD_TITLE_LENGTH,
  MAX_HIGHLIGHTS,
  PresentationCopy,
  PresentationModel,
  type FactualClaim,
} from '@vp/domain-schema/wire';
import { parsePartialJson } from 'ai';
import { describe, expect, it } from 'vitest';
import type { PartialObject } from '../llm-client.ts';
import {
  capString,
  createStreamWriter,
  MAX_HELD_RUN,
  StreamWriterError,
  type CardInput,
} from './stream-writer.ts';

const claim: FactualClaim = {
  kind: 'flight',
  statement: 'Non-stop service MSP–CUN (Cancún) is listed in our sample route data.',
  verification: 'fixture',
};
const cards: CardInput[] = [
  {
    recommendationId: 'rec-1',
    claims: [claim],
    fallback: { title: 'Cancún, Mexico', blurb: 'Warm water and reefs.', highlights: [] },
  },
  {
    recommendationId: 'rec-2',
    claims: [],
    fallback: { title: 'Maui, Hawaii', blurb: 'Beaches and snorkeling.', highlights: [] },
  },
];

function copyOf(value: unknown): PresentationCopy {
  return PresentationCopy.parse(value);
}

const COPY = copyOf({
  headline: 'Warm beaches for your family',
  intro: 'Two sunny picks with "easy" snorkeling\nand short drives.\\ Enjoy 🌴!',
  cards: [
    {
      title: 'Cancún 🏖️',
      blurb: 'Calm, clear water on the Riviera Maya, with reef snorkeling close to shore.',
      highlights: ['Snorkel at Puerto Morelos', 'Cenote swims'],
    },
    {
      title: 'Maui',
      blurb: 'Golden beaches and turtles at Molokini.',
      highlights: ['Molokini crater'],
    },
  ],
});

/** A small deterministic PRNG, so chunk splits are random but repeatable (§6.1). */
function prng(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2 ** 31;
    return state / 2 ** 31;
  };
}

function chunk(text: string, sizes: () => number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length;) {
    const size = Math.max(1, Math.round(sizes()));
    out.push(text.slice(i, i + size));
    i += size;
  }
  return out;
}

/** Streams `model` (the model's JSON text) through the writer, as the adapter would. */
async function stream(model: string, chunks: string[], inputs = cards) {
  const writer = createStreamWriter(inputs);
  const deltas: string[] = [];
  let text = '';
  for (const piece of chunks) {
    text += piece;
    const { value } = await parsePartialJson(text);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue;
    const delta = writer.push(value as PartialObject<PresentationCopy>);
    if (delta !== '') deltas.push(delta);
  }
  deltas.push(writer.finish(copyOf(JSON.parse(model))));
  return { writer, deltas, wire: deltas.join('') };
}

function finalModel(wire: string) {
  return PresentationModel.parse(JSON.parse(wire));
}

describe('stream writer: the prefix property', () => {
  const model = JSON.stringify(COPY);

  it.each([1, 2, 3, 5, 8, 13])(
    'AC-PRESENT-02: chunks of %i characters end in the same valid text, sent in many deltas',
    async (size) => {
      const { wire, deltas } = await stream(
        model,
        chunk(model, () => size),
      );
      expect(deltas.filter((d) => d !== '').length).toBeGreaterThan(5);
      const result = finalModel(wire);
      expect(result.headline).toBe(COPY.headline);
      expect(result.intro).toBe(COPY.intro);
      expect(result.cards.map((c) => c.title)).toEqual(['Cancún 🏖️', 'Maui']);
    },
  );

  it.each(Array.from({ length: 40 }, (_, i) => i + 1))(
    'AC-PRESENT-02: random split %i gives the same text as one chunk',
    async (seed) => {
      const random = prng(seed);
      const whole = await stream(model, [model]);
      const split = await stream(
        model,
        chunk(model, () => 1 + random() * 24),
      );
      expect(split.wire).toBe(whole.wire);
    },
  );

  it('AC-PRESENT-02: every text sent so far is a prefix of the final text', async () => {
    const writer = createStreamWriter(cards);
    const sentSoFar: string[] = [];
    let text = '';
    for (const piece of chunk(model, () => 4)) {
      text += piece;
      const { value } = await parsePartialJson(text);
      if (typeof value === 'object' && value !== null) {
        writer.push(value as PartialObject<PresentationCopy>);
        sentSoFar.push(writer.sent);
      }
    }
    writer.finish(COPY);
    for (const sent of sentSoFar) expect(writer.sent.startsWith(sent)).toBe(true);
  });

  it('AC-PRESENT-03: code fields come first in each card, from the card input', async () => {
    const { wire } = await stream(model, [model]);
    expect(wire).toContain(
      `{"recommendationId":"rec-1","claims":${JSON.stringify([claim])},"title":`,
    );
    const result = finalModel(wire);
    expect(result.cards.map((c) => [c.recommendationId, c.claims])).toEqual([
      ['rec-1', [claim]],
      ['rec-2', []],
    ]);
  });

  it('holds back the word still being written, the first one too, and a lone high surrogate', () => {
    const writer = createStreamWriter(cards);
    expect(writer.push({ headline: 'Wa' })).toBe('{"headline":"');
    expect(writer.push({ headline: 'Warm beac' })).toBe('Warm');
    expect(writer.push({ headline: 'Warm beaches f' })).toBe(' beaches');
    expect(writer.push({ headline: 'Warm beaches for \uD83C' })).toBe(' for');
    expect(writer.push({ headline: 'Warm beaches for 🌴 x' })).toBe(' 🌴');
    expect(writer.push({ headline: 'Warm beaches for 🌴 x', intro: '' })).toBe(' x","intro":"');
  });

  it(`sends a run longer than ${MAX_HELD_RUN} code points without waiting for a space`, () => {
    const writer = createStreamWriter(cards);
    const run = 'x'.repeat(MAX_HELD_RUN + 1);
    expect(writer.push({ headline: run })).toBe(`{"headline":"${run}`);
  });

  it('skips a snapshot that would not extend the text sent', () => {
    const writer = createStreamWriter(cards);
    expect(writer.push({ headline: 'Warm beaches today' })).toBe('{"headline":"Warm beaches');
    expect(writer.push({ headline: 'Cold' })).toBe('');
    expect(writer.sent).toBe('{"headline":"Warm beaches');
  });

  it('waits on a key the model writes out of order', () => {
    const writer = createStreamWriter(cards);
    writer.push({
      headline: 'Hi',
      intro: 'There',
      cards: [{ title: 'Cancún', highlights: ['a'] }],
    });
    // The title is complete (a later key exists), but the blurb is missing: stop there.
    expect(writer.sent.endsWith('"title":"Cancún","blurb":')).toBe(true);

    // The late blurb is the newest key, so it is still open: it streams, and the card finishes.
    const card = { title: 'Cancún', highlights: ['a'], blurb: 'Calm water and reefs' };
    writer.push({ headline: 'Hi', intro: 'There', cards: [card] });
    expect(writer.sent.endsWith('"blurb":"Calm water and')).toBe(true);
    writer.finish({
      headline: 'Hi',
      intro: 'There',
      cards: [card, COPY.cards[1]],
    } as PresentationCopy);
    expect(PresentationModel.parse(JSON.parse(writer.sent)).cards[0]).toMatchObject({
      title: 'Cancún',
      blurb: 'Calm water and reefs',
      highlights: ['a'],
    });
  });

  it('a final text that does not extend the sent text is a StreamWriterError', () => {
    const writer = createStreamWriter(cards);
    writer.push({ headline: 'Warm beaches today' });
    expect(() => writer.finish({ ...COPY, headline: 'Cold' })).toThrow(StreamWriterError);
  });
});

describe('stream writer: cards line up with the recommendations', () => {
  it('AC-PRESENT-05: a missing model card is written from its fallback', async () => {
    const model = JSON.stringify({ ...COPY, cards: [COPY.cards[0]] });
    const { wire } = await stream(
      model,
      chunk(model, () => 7),
    );
    const result = finalModel(wire);
    expect(result.cards[1]).toEqual({
      recommendationId: 'rec-2',
      claims: [],
      title: 'Maui, Hawaii',
      blurb: 'Beaches and snorkeling.',
      highlights: [],
    });
  });

  it('AC-PRESENT-05: model cards past the recommendations are dropped and logged', async () => {
    const extra = { title: 'Fiji', blurb: 'Far away.', highlights: [] };
    const model = JSON.stringify({ ...COPY, cards: [...COPY.cards, extra] });
    const { wire, writer } = await stream(
      model,
      chunk(model, () => 9),
    );
    expect(finalModel(wire).cards).toHaveLength(2);
    expect(wire).not.toContain('Fiji');
    expect(writer.discarded).toEqual([
      { path: '/cards/2', reason: 'too_many_items', limit: 2, actual: 3 },
    ]);
  });

  it('with no cards, writes a valid model with an empty list', async () => {
    const model = JSON.stringify({ headline: 'None', intro: 'Nothing matched.', cards: [] });
    const { wire } = await stream(
      model,
      chunk(model, () => 3),
      [],
    );
    expect(finalModel(wire)).toEqual({ headline: 'None', intro: 'Nothing matched.', cards: [] });
  });
});

describe('stream writer: caps (plan D4, ADR 0004 WU-11 addendum)', () => {
  const sentence = 'Family resorts on clear water, with reef snorkeling close to shore. ';
  const longBlurb = sentence.repeat(12).trim(); // ≈ 800 code points

  it('AC-PRESENT-06: an over-cap blurb ends at a word boundary with "…", within the cap, logged', async () => {
    const model = JSON.stringify({
      ...COPY,
      cards: [{ ...COPY.cards[0], blurb: longBlurb }, COPY.cards[1]],
    });
    const { wire, writer } = await stream(
      model,
      chunk(model, () => 11),
    );
    const blurb = finalModel(wire).cards[0]?.blurb ?? '';
    expect(codePointLength(blurb)).toBeLessThanOrEqual(MAX_BLURB_LENGTH);
    expect(blurb.endsWith('…')).toBe(true);
    expect(longBlurb.startsWith(blurb.slice(0, -1))).toBe(true);
    // The cut lands on a word boundary: the next character of the model's text is a space.
    expect(longBlurb[blurb.length - 1]).toMatch(/\s/);
    expect(writer.discarded).toEqual([
      {
        path: '/cards/0/blurb',
        reason: 'truncated',
        limit: MAX_BLURB_LENGTH,
        actual: codePointLength(longBlurb),
      },
    ]);
  });

  it('AC-PRESENT-06: the cut is the same however the text was chunked', async () => {
    const model = JSON.stringify({ ...COPY, intro: longBlurb });
    const one = await stream(model, [model]);
    for (const size of [1, 3, 17]) {
      expect(
        (
          await stream(
            model,
            chunk(model, () => size),
          )
        ).wire,
      ).toBe(one.wire);
    }
  });

  it('AC-PRESENT-06: a word longer than the cap is cut at cap − 1, with "…"', () => {
    const { text, cut } = capString('y'.repeat(MAX_CARD_TITLE_LENGTH + 40), MAX_CARD_TITLE_LENGTH);
    expect(cut).toBe(true);
    expect(text).toBe(`${'y'.repeat(MAX_CARD_TITLE_LENGTH - 1)}…`);
  });

  it('AC-PRESENT-06: a string at exactly its cap is sent whole', () => {
    const value = `${'word '.repeat(19)}abcde`; // 100 code points
    expect(capString(value, MAX_CARD_TITLE_LENGTH)).toEqual({ text: value, cut: false });
  });

  it('AC-PRESENT-06: caps count code points, not UTF-16 units', () => {
    const value = '🌴'.repeat(MAX_CARD_TITLE_LENGTH);
    expect(capString(value, MAX_CARD_TITLE_LENGTH)).toEqual({ text: value, cut: false });
  });

  it(`AC-PRESENT-06: highlights past ${MAX_HIGHLIGHTS} are dropped and logged`, async () => {
    const highlights = Array.from({ length: MAX_HIGHLIGHTS + 2 }, (_, i) => `Highlight ${i}`);
    const model = JSON.stringify({ ...COPY, cards: [{ ...COPY.cards[0], highlights }] });
    const { wire, writer } = await stream(
      model,
      chunk(model, () => 5),
    );
    expect(finalModel(wire).cards[0]?.highlights).toEqual(highlights.slice(0, MAX_HIGHLIGHTS));
    expect(writer.discarded).toContainEqual({
      path: `/cards/0/highlights/${MAX_HIGHLIGHTS}`,
      reason: 'too_many_items',
      limit: MAX_HIGHLIGHTS,
      actual: MAX_HIGHLIGHTS + 2,
    });
  });

  it('AC-PRESENT-06: every string over its cap at once still gives a valid model', async () => {
    const long = (n: number) => 'lorem ipsum '.repeat(Math.ceil(n / 12) + 10);
    const model = JSON.stringify({
      headline: long(120),
      intro: long(600),
      cards: [0, 1].map(() => ({
        title: long(100),
        blurb: long(600),
        highlights: Array.from({ length: 9 }, () => long(120)),
      })),
    });
    const random = prng(7);
    const { wire } = await stream(
      model,
      chunk(model, () => 1 + random() * 30),
    );
    expect(PresentationModel.safeParse(JSON.parse(wire)).success).toBe(true);
  });
});
