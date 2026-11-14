// Sample non-stop route data (CLAUDE.md §7 factual honesty; WU-10 plan D3, D4). Illustrative data
// for a demo, injected into the use case so a real source could replace it later. Pure: the caller
// loads and parses the JSON.
import { codePointLength } from '@vp/domain-schema/wire';
import { z } from 'zod';

const AirportCode = z.string().regex(/^[A-Z]{3}$/);

/**
 * The longest `city` the data may hold. Code writes it into a `fixture` claim's statement, which
 * must stay within MAX_CLAIM_LENGTH (recommend-output.test.ts pins that this cap keeps it there).
 */
export const MAX_ROUTE_CITY_LENGTH = 60;

const RouteDestination = z.object({
  airport: AirportCode,
  city: z
    .string()
    .min(1)
    .refine((city) => codePointLength(city) <= MAX_ROUTE_CITY_LENGTH, {
      message: `city is over ${MAX_ROUTE_CITY_LENGTH} code points`,
    }),
  /** Other names a recommendation may use for the place this airport serves ("Oahu" for HNL). */
  aliases: z.array(z.string().min(1)).optional(),
});
export type RouteDestination = z.infer<typeof RouteDestination>;

const RouteOrigin = z.object({
  airport: AirportCode,
  names: z.array(z.string().min(1)),
  nonstop: z.array(RouteDestination).min(1),
});
export type RouteOrigin = z.infer<typeof RouteOrigin>;

export const RouteData = z.object({
  note: z.string().min(1),
  origins: z.array(RouteOrigin).min(1),
});
export type RouteData = z.infer<typeof RouteData>;

/** Validates routes.json content; throws a clear error naming the file on any problem. */
export function parseRouteData(json: unknown): RouteData {
  const parsed = RouteData.safeParse(json);
  if (!parsed.success) {
    throw new Error(`routes.json is invalid: ${parsed.error.message}`);
  }
  const seen = new Set<string>();
  for (const origin of parsed.data.origins) {
    if (seen.has(origin.airport)) {
      throw new Error(`routes.json is invalid: duplicate origin ${origin.airport}`);
    }
    seen.add(origin.airport);
  }
  return parsed.data;
}

function normalizeText(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[.\-–—/]/g, ' ')
    .replace(/\p{White_Space}+/gu, ' ')
    .trim();
}

/** The origin whose name or airport code matches the traveler's city text, or null. */
export function resolveOrigin(
  data: RouteData,
  city: string | null | undefined,
): RouteOrigin | null {
  if (city === null || city === undefined) return null;
  const wanted = normalizeText(city);
  if (wanted === '') return null;
  return (
    data.origins.find(
      (origin) =>
        normalizeText(origin.airport) === wanted ||
        origin.names.some((name) => normalizeText(name) === wanted),
    ) ?? null
  );
}

/** A 3-letter IATA code, upper-cased and trimmed, or null when the text is not one. */
export function normalizeAirportCode(code: string): string | null {
  const upper = code.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, '').toUpperCase();
  return /^[A-Z]{3}$/.test(upper) ? upper : null;
}

/** The listed non-stop destination from `from` to `to`, or null. */
export function findNonstop(data: RouteData, from: string, to: string): RouteDestination | null {
  const fromCode = normalizeAirportCode(from);
  const toCode = normalizeAirportCode(to);
  if (fromCode === null || toCode === null) return null;
  const origin = data.origins.find((o) => o.airport === fromCode);
  return origin?.nonstop.find((d) => d.airport === toCode) ?? null;
}

/** normalizeText, with accents folded too ("Cancún" matches "Cancun"). */
function foldText(text: string): string {
  return normalizeText(text.normalize('NFD').replace(/\p{M}/gu, ''));
}

/**
 * Whether a recommendation's destination text names the place this listed airport serves: one of
 * its city's parts ("Maui (Kahului)" gives "Maui" and "Kahului"; "Eagle/Vail" gives both), an
 * alias, or the airport code, matched as whole words after folding case, accents and punctuation.
 */
export function servesDestination(route: RouteDestination, destination: string): boolean {
  const text = ` ${foldText(destination.replace(/[(),]/g, ' '))} `;
  const names = [...route.city.split(/[()/,]/), ...(route.aliases ?? []), route.airport].map(
    foldText,
  );
  return names.some((name) => name !== '' && text.includes(` ${name} `));
}

export function isCoveredOrigin(data: RouteData, code: string): boolean {
  const normalized = normalizeAirportCode(code);
  return normalized !== null && data.origins.some((o) => o.airport === normalized);
}
