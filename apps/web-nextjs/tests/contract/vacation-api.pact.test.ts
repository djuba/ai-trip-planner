// Consumer-driven contract (CLAUDE.md §6.5): the real API client runs against Pact's mock server,
// and the interactions it makes are written to contracts/pacts/web-nextjs-vacation-api.json, which
// tests/contract/pact-verify.test.ts replays against the backend (WU-12 plan D6).
//
// Requests are matched exactly; responses by type, because model-written text isn't the contract.
// The client branches on `status` and error `code`, so those are matched exactly.
//
// Every request that reaches the model reuses a body the conformance suite already sends
// (tests/support/fixtures.ts), so the provider replays an existing cassette. 401 and 429 aren't
// here: the verifier sets a valid invite code on every request (WU-22), so they can't verify. The
// unit and msw tests prove the client's side of them; the conformance suite proves the provider's.
import { fileURLToPath } from 'node:url';
import { MatchersV3, PactV4 } from '@pact-foundation/pact';
import { describe, expect, it } from 'vitest';
import { createApiClient } from '../../src/lib/api/client.ts';
import {
  PROFILE,
  confirmExtractRequest,
  extractRequest,
  notReadyRecommendRequest,
  presentRequest,
  recommendRequest,
  vagueExtractRequest,
} from '../support/fixtures.ts';

const { atLeastLike, boolean, eachLike, like, regex } = MatchersV3;

process.env.PACT_DO_NOT_TRACK = 'true';

const pact = new PactV4({
  consumer: 'web-nextjs',
  provider: 'vacation-api',
  dir: fileURLToPath(new URL('../../../../contracts/pacts/', import.meta.url)),
  logLevel: 'warn',
});

/**
 * Not a code any backend accepts. The provider verification passes only because its request filter
 * replaces it with the run's own code (WU-22 note), which interaction 2 below proves.
 */
const EXAMPLE_CODE = 'pact-example-invite-code';
const AUTH = { Authorization: regex(/^Bearer \S+$/, `Bearer ${EXAMPLE_CODE}`) };
const JSON_TYPE = { 'Content-Type': regex(/^application\/json(;.*)?$/, 'application/json') };

const client = (baseUrl: string) => createApiClient({ baseUrl, getInviteCode: () => EXAMPLE_CODE });

const validationFailed = {
  error: { code: 'VALIDATION_FAILED', message: like('The request does not match the contract.') },
};

const ExperienceMatcher = regex(
  /^(beach|pool|golf|go-karts|hiking|snorkeling|theme-parks|museums|nightlife|skiing)$/,
  'beach',
);

describe('web-nextjs → vacation-api pact', () => {
  it('AC-WEB-11: GET /v1/health reports status and contract version', async () => {
    await pact
      .addInteraction()
      .uponReceiving('a health check')
      .withRequest('GET', '/v1/health')
      .willRespondWith(200, (res) =>
        res.headers(JSON_TYPE).jsonBody({ status: 'ok', contractVersion: like('0.8.0') }),
      )
      .executeTest(async (server) => {
        const result = await client(server.url).health();
        expect(result).toEqual({ ok: true, data: { status: 'ok', contractVersion: '0.8.0' } });
      });
  });

  it('AC-WEB-11: POST /extract with a vague message needs clarification', async () => {
    await pact
      .addInteraction()
      .uponReceiving('a vague trip request')
      .withRequest('POST', '/v1/trip/extract', (req) =>
        req.headers(AUTH).jsonBody(vagueExtractRequest()),
      )
      .willRespondWith(200, (res) =>
        res.headers(JSON_TYPE).jsonBody({
          status: 'needs_clarification',
          profile: like({}),
          violations: eachLike({
            code: like('INSUFFICIENT_DETAIL'),
            path: like(''),
            // params are typed per code; the example must be a valid INSUFFICIENT_DETAIL one.
            params: like({ populated: 1, required: 3 }),
          }),
          clarificationQuestion: like('Where would you like to go, and when?'),
        }),
      )
      .executeTest(async (server) => {
        const result = await client(server.url).extract(vagueExtractRequest());
        expect(result.ok && result.data.status).toBe('needs_clarification');
      });
  });

  it('AC-WEB-11: POST /extract with a confirmed complete profile is ready', async () => {
    await pact
      .addInteraction()
      .uponReceiving('a confirmation of a complete trip profile')
      .withRequest('POST', '/v1/trip/extract', (req) =>
        req.headers(AUTH).jsonBody(confirmExtractRequest()),
      )
      .willRespondWith(200, (res) =>
        res.headers(JSON_TYPE).jsonBody({ status: 'ready', profile: like(PROFILE) }),
      )
      .executeTest(async (server) => {
        const result = await client(server.url).extract(confirmExtractRequest());
        expect(result.ok && result.data.status).toBe('ready');
      });
  });

  it('AC-WEB-11: POST /extract with an empty message is a 422', async () => {
    const body = { ...extractRequest(), message: '' };
    await pact
      .addInteraction()
      .uponReceiving('a trip request with an empty message')
      .withRequest('POST', '/v1/trip/extract', (req) => req.headers(AUTH).jsonBody(body))
      .willRespondWith(422, (res) => res.headers(JSON_TYPE).jsonBody(validationFailed))
      .executeTest(async (server) => {
        const result = await client(server.url).extract(body);
        expect(result.ok ? undefined : result.error.kind).toBe('invalid_request');
      });
  });

  it('AC-WEB-11: POST /recommend with a ready profile returns recommendations', async () => {
    await pact
      .addInteraction()
      .uponReceiving('a recommendation request for a ready profile')
      .withRequest('POST', '/v1/trip/recommend', (req) =>
        req.headers(AUTH).jsonBody(recommendRequest()),
      )
      .willRespondWith(200, (res) =>
        res.headers(JSON_TYPE).jsonBody({
          recommendations: eachLike({
            id: like('rec-1'),
            destination: like('Maui, Hawaii'),
            summary: like('Warm beaches and calm snorkeling water in February.'),
            matchedExperiences: eachLike(ExperienceMatcher),
            claims: eachLike({
              kind: regex(/^(flight|lodging|price|activity|other)$/, 'flight'),
              statement: like('Flights from Minneapolis may be available with one stop.'),
              verification: regex(/^(unverified|fixture)$/, 'unverified'),
            }),
          }),
          critique: {
            pass: boolean(true),
            unresolved: atLeastLike(
              { recommendationId: like('rec-1'), issue: like('A claim is unsupported.') },
              0,
              1,
            ),
          },
        }),
      )
      .executeTest(async (server) => {
        const result = await client(server.url).recommend(recommendRequest());
        expect(result.ok && result.data.recommendations.length).toBeGreaterThan(0);
      });
  });

  it('AC-WEB-11: POST /recommend with a profile that is not ready is a 422', async () => {
    await pact
      .addInteraction()
      .uponReceiving('a recommendation request for a party with no adult')
      .withRequest('POST', '/v1/trip/recommend', (req) =>
        req.headers(AUTH).jsonBody(notReadyRecommendRequest()),
      )
      .willRespondWith(422, (res) => res.headers(JSON_TYPE).jsonBody(validationFailed))
      .executeTest(async (server) => {
        const result = await client(server.url).recommend(notReadyRecommendRequest());
        expect(result.ok ? undefined : result.error.kind).toBe('invalid_request');
      });
  });

  it('AC-WEB-11: POST /present streams text/plain', async () => {
    // The body isn't matched: a text body is compared byte for byte, which would pin the cassette's
    // prose. The conformance suite proves the stream parses as PresentationModel (plan D6).
    await pact
      .addInteraction()
      .uponReceiving('a presentation request')
      .withRequest('POST', '/v1/trip/present', (req) =>
        req.headers(AUTH).jsonBody(presentRequest()),
      )
      .willRespondWith(200, (res) =>
        res.headers({
          'Content-Type': regex(/^text\/plain(;.*)?$/, 'text/plain; charset=utf-8'),
        }),
      )
      .executeTest(async (server) => {
        const result = await client(server.url).present(presentRequest());
        expect(result.ok).toBe(true);
      });
  });
});
