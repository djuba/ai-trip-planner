import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  findNonstop,
  isCoveredOrigin,
  MAX_ROUTE_CITY_LENGTH,
  normalizeAirportCode,
  parseRouteData,
  resolveOrigin,
} from './routes.ts';

const json: unknown = JSON.parse(
  readFileSync(new URL('../../data/routes.json', import.meta.url), 'utf8'),
);
const data = parseRouteData(json);

describe('routes.json', () => {
  it('AC-RECOMMEND-04: the committed file parses and covers 8 origins with 10-15 non-stops', () => {
    expect(data.origins.map((o) => o.airport)).toEqual([
      'MSP',
      'ORD',
      'ATL',
      'DFW',
      'DEN',
      'LAX',
      'JFK',
      'SEA',
    ]);
    for (const origin of data.origins) {
      expect(origin.nonstop.length).toBeGreaterThanOrEqual(10);
      expect(origin.nonstop.length).toBeLessThanOrEqual(15);
      expect(origin.nonstop.some((d) => d.airport === origin.airport)).toBe(false);
    }
    expect(data.note).toMatch(/not live/i);
  });
});

describe('parseRouteData', () => {
  const origin = { airport: 'MSP', names: ['x'], nonstop: [{ airport: 'OGG', city: 'Maui' }] };
  const ok = { note: 'n', origins: [origin] };

  it('AC-RECOMMEND-04: accepts a minimal valid shape', () => {
    expect(parseRouteData(ok).origins).toHaveLength(1);
  });

  it('AC-RECOMMEND-04: accepts a city at MAX_ROUTE_CITY_LENGTH code points, and destination aliases', () => {
    const city = '🌴'.repeat(MAX_ROUTE_CITY_LENGTH);
    const nonstop = [{ airport: 'OGG', city, aliases: ['Maui'] }];
    expect(
      parseRouteData({ ...ok, origins: [{ ...origin, nonstop }] }).origins[0]?.nonstop,
    ).toEqual(nonstop);
  });

  it.each([
    ['not an object', 'x'],
    ['no origins', { note: 'n', origins: [] }],
    ['empty note', { ...ok, note: '' }],
    ['lower-case code', { ...ok, origins: [{ ...origin, airport: 'msp' }] }],
    ['empty nonstop list', { ...ok, origins: [{ ...origin, nonstop: [] }] }],
    ['empty city', { ...ok, origins: [{ ...origin, nonstop: [{ airport: 'OGG', city: '' }] }] }],
    ['empty alias', { ...ok, origins: [{ ...origin, names: [''] }] }],
    [
      'a city over MAX_ROUTE_CITY_LENGTH',
      {
        ...ok,
        origins: [
          {
            ...origin,
            nonstop: [{ airport: 'OGG', city: '🌴'.repeat(MAX_ROUTE_CITY_LENGTH + 1) }],
          },
        ],
      },
    ],
    [
      'an empty destination alias',
      {
        ...ok,
        origins: [{ ...origin, nonstop: [{ airport: 'OGG', city: 'Maui', aliases: [''] }] }],
      },
    ],
  ])('AC-RECOMMEND-04: rejects %s, naming routes.json', (_label, bad) => {
    expect(() => parseRouteData(bad)).toThrow(/routes\.json/);
  });

  it('AC-RECOMMEND-04: rejects duplicate origin airports', () => {
    expect(() => parseRouteData({ ...ok, origins: [origin, origin] })).toThrow(
      /duplicate origin MSP/,
    );
  });
});

describe('resolveOrigin', () => {
  it.each([
    ['St. Paul', 'MSP'],
    ['saint paul', 'MSP'],
    ['Minneapolis–St Paul', 'MSP'],
    ['  Twin   Cities ', 'MSP'],
    ['MSP', 'MSP'],
    ['msp', 'MSP'],
    ['Chicago', 'ORD'],
    ["O'Hare", 'ORD'],
    ['O’Hare', 'ORD'],
    ['ohare', 'ORD'],
    ['NYC', 'JFK'],
    ['New York City', 'JFK'],
    ['L.A.', 'LAX'],
    ['Ｓｅａｔｔｌｅ', 'SEA'],
    ['Dallas-Fort Worth', 'DFW'],
    ['Dallas/Fort Worth', 'DFW'],
    ['Denver', 'DEN'],
    ['Atlanta', 'ATL'],
  ])('AC-RECOMMEND-04: %s resolves to %s', (city, airport) => {
    expect(resolveOrigin(data, city)?.airport ?? null).toBe(airport);
  });

  it('AC-RECOMMEND-04: an uncovered city, blank and missing text resolve to null', () => {
    expect(resolveOrigin(data, 'Boise')).toBeNull();
    expect(resolveOrigin(data, '   ')).toBeNull();
    expect(resolveOrigin(data, '')).toBeNull();
    expect(resolveOrigin(data, null)).toBeNull();
    expect(resolveOrigin(data, undefined)).toBeNull();
  });
});

describe('normalizeAirportCode', () => {
  it('AC-RECOMMEND-04: trims and upper-cases a 3-letter code, else null', () => {
    expect(normalizeAirportCode(' ogg ')).toBe('OGG');
    expect(normalizeAirportCode('OG')).toBeNull();
    expect(normalizeAirportCode('OGGG')).toBeNull();
    expect(normalizeAirportCode('O1G')).toBeNull();
    expect(normalizeAirportCode('')).toBeNull();
  });
});

describe('findNonstop', () => {
  it('AC-RECOMMEND-04: hits a listed route, tolerating case and spaces', () => {
    expect(findNonstop(data, 'MSP', 'OGG')).toEqual({ airport: 'OGG', city: 'Maui (Kahului)' });
    expect(findNonstop(data, ' msp ', 'ogg')?.airport).toBe('OGG');
    expect(findNonstop(data, 'DEN', 'SLC')?.city).toBe('Salt Lake City');
  });

  it('AC-RECOMMEND-04: misses an unlisted route, an uncovered origin and bad codes', () => {
    expect(findNonstop(data, 'DEN', 'KEF')).toBeNull();
    expect(findNonstop(data, 'BOI', 'OGG')).toBeNull();
    expect(findNonstop(data, 'MS', 'OGG')).toBeNull();
    expect(findNonstop(data, 'MSP', 'Maui')).toBeNull();
  });
});

describe('isCoveredOrigin', () => {
  it('AC-RECOMMEND-04: true only for a listed origin code', () => {
    expect(isCoveredOrigin(data, 'sea')).toBe(true);
    expect(isCoveredOrigin(data, 'BOI')).toBe(false);
    expect(isCoveredOrigin(data, 'Seattle')).toBe(false);
  });
});
