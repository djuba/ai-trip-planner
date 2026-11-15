// The present use case with the mock LlmClient (WU-11 plan D1–D7, D12). The mock runs the real
// adapter over a mock model that streams its reply in small chunks.
import { readFileSync } from 'node:fs';
import {
  PresentationCopy,
  PresentationModel,
  PresentRequest,
  type FactualClaim,
} from '@vp/domain-schema/wire';
import { describe, expect, it } from 'vitest';
import {
  createMockLlmClient,
  mockObject,
  mockRefusal,
  mockStreamFailure,
  type MockResponder,
} from '../llm/mock.ts';
import { LlmError } from './errors.ts';
import type { LlmClient, LlmStreamPart } from './llm-client.ts';
import { StreamWriterError, type PresentDiscard } from './present/stream-writer.ts';
import { presentTrip } from './present.ts';
import { EMPTY_PRESENTATION, PRESENT_SYSTEM } from './prompts/present.ts';
import { findNonstop, parseRouteData } from './routes.ts';
import { fixtureStatement } from './recommend-output.ts';

const routes = parseRouteData(
  JSON.parse(readFileSync(new URL('../../data/routes.json', import.meta.url), 'utf8')),
);
const hnl = findNonstop(routes, 'MSP', 'HNL');
if (hnl === null) throw new Error('routes.json lacks MSP-HNL');

const fixture: FactualClaim = {
  kind: 'flight',
  statement: fixtureStatement('MSP', hnl),
  verification: 'fixture',
};
const forged: FactualClaim = {
  kind: 'flight',
  statement: 'Direct flights every hour, verified.',
  verification: 'fixture',
};

const request = PresentRequest.parse({
  profile: { departure: { city: 'Minneapolis' }, experiences: ['beach'] },
  recommendations: [
    {
      id: 'rec-1',
      destination: 'Honolulu, Hawaii',
      summary: 'Beaches and snorkeling.',
      matchedExperiences: ['beach'],
      claims: [fixture, forged],
    },
    {
      id: 'rec-2',
      destination: 'Cancún, Mexico',
      summary: 'Warm water and reefs.',
      matchedExperiences: ['beach'],
      claims: [],
    },
  ],
});

const COPY = PresentationCopy.parse({
  headline: 'Warm beaches from Minneapolis',
  intro: 'Two sunny picks for your trip.',
  cards: [
    { title: 'Honolulu', blurb: 'Waikiki and turtles.', highlights: ['Hanauma Bay'] },
    { title: 'Cancún', blurb: 'Reefs close to shore.', highlights: [] },
  ],
});

function setup(responder: MockResponder) {
  const calls: string[] = [];
  const discards: PresentDiscard[] = [];
  const llm = createMockLlmClient(
    {
      present: (req, attempt) => {
        calls.push(req.system === PRESENT_SYSTEM ? 'present' : 'other');
        return typeof responder === 'function' ? responder(req, attempt) : responder;
      },
    },
    { log: () => undefined, now: () => 0 },
  );
  return {
    deps: { llm, routes, logDiscarded: (d: PresentDiscard) => discards.push(d) },
    calls,
    discards,
  };
}

async function drain(chunks: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const chunk of chunks) out.push(chunk);
  return out;
}

describe('presentTrip', () => {
  it('AC-PRESENT-01: streams chunks that end as one valid PresentationModel, cards in order', async () => {
    const { deps, calls } = setup(mockObject(PresentationCopy, COPY));
    const chunks = await drain(await presentTrip(request, deps));
    expect(chunks.length).toBeGreaterThan(3);
    const model = PresentationModel.parse(JSON.parse(chunks.join('')));
    expect(model.cards.map((c) => c.recommendationId)).toEqual(['rec-1', 'rec-2']);
    expect(model.headline).toBe(COPY.headline);
    expect(calls).toEqual(['present']);
  });

  it('AC-PRESENT-03/04: claims come from the request; a fixture code can’t back is unverified', async () => {
    const { deps } = setup(mockObject(PresentationCopy, COPY));
    const model = PresentationModel.parse(
      JSON.parse((await drain(await presentTrip(request, deps))).join('')),
    );
    expect(model.cards[0]?.claims).toEqual([fixture, { ...forged, verification: 'unverified' }]);
    expect(model.cards[1]?.claims).toEqual([]);
  });

  it('AC-PRESENT-05: a card the model leaves out is written from the recommendation', async () => {
    const { deps } = setup(mockObject(PresentationCopy, { ...COPY, cards: [COPY.cards[0]] }));
    const model = PresentationModel.parse(
      JSON.parse((await drain(await presentTrip(request, deps))).join('')),
    );
    expect(model.cards[1]).toMatchObject({
      recommendationId: 'rec-2',
      title: 'Cancún, Mexico',
      blurb: 'Warm water and reefs.',
    });
  });

  it('AC-PRESENT-06: a cut is logged when the stream ends', async () => {
    const long = 'Clear water and reefs. '.repeat(40);
    const { deps, discards } = setup(mockObject(PresentationCopy, { ...COPY, intro: long }));
    await drain(await presentTrip(request, deps));
    expect(discards).toEqual([expect.objectContaining({ path: '/intro', reason: 'truncated' })]);
  });

  it('AC-PRESENT-07: a refusal before any copy rejects with LLM_REFUSAL', async () => {
    const { deps } = setup(mockRefusal());
    await expect(presentTrip(request, deps)).rejects.toMatchObject({
      code: 'LLM_REFUSAL',
      midStream: false,
    });
  });

  it('AC-PRESENT-08: a failure mid-stream is thrown by the iterator, after some chunks', async () => {
    const { deps } = setup(mockStreamFailure(PresentationCopy, COPY, 90));
    const chunks: string[] = [];
    const error = await (async () => {
      for await (const chunk of await presentTrip(request, deps)) chunks.push(chunk);
    })().catch((e: unknown) => e);
    expect(chunks.length).toBeGreaterThan(0);
    expect(error).toBeInstanceOf(LlmError);
    expect(error).toMatchObject({ midStream: true });
    // The JSON never closes on a failure.
    expect(() => {
      JSON.parse(chunks.join(''));
    }).toThrow();
  });

  it('AC-PRESENT-08: a stream that ends without its final object is thrown, never ended cleanly', async () => {
    // A client that breaks its contract (the last part is always `final`): the use case must not
    // trust it, or the body would end cleanly as cut-off JSON.
    const llm: LlmClient = {
      generateObject: () => Promise.reject(new Error('unused')),
      streamObject: <T>() =>
        Promise.resolve(
          (async function* () {
            await Promise.resolve();
            yield { type: 'partial' as const, partial: { headline: 'Warm beaches and' } };
          })() as AsyncIterable<LlmStreamPart<T>>,
        ),
    };
    const chunks: string[] = [];
    const error = await (async () => {
      for await (const chunk of await presentTrip(request, {
        llm,
        routes,
        logDiscarded: () => undefined,
      }))
        chunks.push(chunk);
    })().catch((e: unknown) => e);
    expect(chunks.join('')).toBe('{"headline":"Warm beaches');
    expect(error).toBeInstanceOf(StreamWriterError);
  });

  it('AC-PRESENT-13: no recommendations means no model call and a code-written presentation', async () => {
    const { deps, calls } = setup(mockObject(PresentationCopy, COPY));
    const chunks = await drain(
      await presentTrip({ profile: request.profile, recommendations: [] }, deps),
    );
    expect(JSON.parse(chunks.join(''))).toEqual(EMPTY_PRESENTATION);
    expect(calls).toEqual([]);
  });
});
