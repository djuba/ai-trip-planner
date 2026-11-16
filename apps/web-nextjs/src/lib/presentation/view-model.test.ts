import { describe, expect, it } from 'vitest';
import { presentationView } from './view-model';

const open = { finished: false };

describe('presentationView', () => {
  it('AC-CARDS-03: anything that is not an object gives no cards and never throws', () => {
    for (const input of [undefined, null, 5, 'text', [], true]) {
      expect(presentationView(input, open)).toEqual({ cards: [] });
    }
  });

  it('AC-CARDS-03: keeps only fields that are strings, as received', () => {
    const view = presentationView({ headline: 'Two cal', intro: 7, cards: 'x' }, open);
    expect(view).toEqual({ headline: 'Two cal', cards: [] });
  });

  it('AC-CARDS-03: skips cards without a string id and cards that are not objects', () => {
    const view = presentationView(
      {
        cards: [null, 'x', { title: 'No id' }, { recommendationId: 4 }, { recommendationId: 'a' }],
      },
      { finished: true },
    );
    expect(view.cards.map((card) => card.key)).toEqual(['a']);
  });

  it('AC-CARDS-03: a cut-short blurb and non-string highlights are handled', () => {
    const view = presentationView(
      {
        cards: [{ recommendationId: 'a', blurb: 'Calm tur', highlights: ['One', 2, null, 'Tw'] }],
      },
      open,
    );
    expect(view.cards[0]).toMatchObject({ blurb: 'Calm tur', highlights: ['One', 'Tw'] });
  });

  it('AC-CARDS-04: claims are held back until the blurb is done', () => {
    const claims = [{ statement: 'A', verification: 'unverified' }];
    const last = presentationView({ cards: [{ recommendationId: 'a', claims, blurb: 'x' }] }, open);
    expect(last.cards[0]?.claims).toBeNull();
    const withHighlights = presentationView(
      { cards: [{ recommendationId: 'a', claims, blurb: 'x', highlights: [] }] },
      open,
    );
    expect(withHighlights.cards[0]?.claims).toEqual(claims);
    const laterCard = presentationView(
      { cards: [{ recommendationId: 'a', claims }, { recommendationId: 'b' }] },
      open,
    );
    expect(laterCard.cards[0]?.claims).toEqual(claims);
    expect(laterCard.cards[1]?.claims).toBeNull();
    const finished = presentationView(
      { cards: [{ recommendationId: 'a', claims }] },
      { finished: true },
    );
    expect(finished.cards[0]?.claims).toEqual(claims);
  });

  it('AC-CARDS-04: only claims with a statement and a known verification are kept', () => {
    const view = presentationView(
      {
        cards: [
          {
            recommendationId: 'a',
            claims: [
              { statement: 'ok', verification: 'fixture' },
              { statement: 'cut', verification: 'unveri' },
              { statement: 'no verification' },
              { verification: 'unverified' },
              'junk',
            ],
          },
        ],
      },
      { finished: true },
    );
    expect(view.cards[0]?.claims).toEqual([{ statement: 'ok', verification: 'fixture' }]);
  });

  it('AC-CARDS-04: claims that are not an array give an empty list once done', () => {
    const view = presentationView(
      { cards: [{ recommendationId: 'a', claims: 'x' }] },
      { finished: true },
    );
    expect(view.cards[0]?.claims).toEqual([]);
  });
});
