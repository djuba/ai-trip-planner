// Builds every file in `spec/generated/` in memory (CLAUDE.md §4.1). Pure and deterministic: the same
// schemas always give byte-identical output (LF, 2-space JSON, trailing newline), so `gen --check`
// can compare it with what is committed.
import { stringify } from 'yaml';
import { z } from 'zod';
import {
  CONTRACT_VERSION,
  MAX_CLAIM_LENGTH,
  MAX_CLAIMS,
  MAX_CLARIFICATION_QUESTION_LENGTH,
  MAX_CRITIQUE_ISSUE_LENGTH,
  MAX_DATE_TEXT_LENGTH,
  MAX_EXPERIENCES,
  MAX_MESSAGE_LENGTH,
  MAX_NOTE_LENGTH,
  MAX_PEOPLE,
  MAX_RECOMMENDATIONS,
  MAX_REQUEST_BODY_BYTES,
  MAX_SHORT_TEXT_LENGTH,
  MAX_SUMMARY_LENGTH,
  MAX_UNMAPPED_EXPERIENCES,
  MAX_UNRESOLVED_ISSUES,
  MIN_POPULATED_FIELDS,
} from '../src/wire/index.ts';
import {
  CONTRACT_SCHEMAS,
  LLM_ONLY_IDS,
  contractRegistry,
  type ContractSchemaId,
} from './registry.ts';

type JsonSchema = Record<string, unknown>;

export const schemaFileName = (id: string): string => `${id}.schema.json`;

/** Open objects (`io: 'input'` omits `additionalProperties: false`): tolerant reader (plan D2). */
function emit(uri: (id: string) => string): Record<ContractSchemaId, JsonSchema> {
  const { schemas } = z.toJSONSchema(contractRegistry, { io: 'input', uri });
  const ids = Object.keys(CONTRACT_SCHEMAS) as ContractSchemaId[];
  const out = {} as Record<ContractSchemaId, JsonSchema>;
  for (const id of ids) {
    const schema = schemas[id];
    if (!schema) throw new Error(`gen: no JSON Schema emitted for ${id}`);
    out[id] = schema;
  }
  return out;
}

export function buildJsonSchemas(): Record<ContractSchemaId, JsonSchema> {
  return emit(schemaFileName);
}

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

const ref = (id: ContractSchemaId) => ({ $ref: `#/components/schemas/${id}` });
const jsonBody = (id: ContractSchemaId, description: string) => ({
  description,
  content: { 'application/json': { schema: ref(id) } },
});
/** Responses every POST can give, gated or not. */
const errorResponses = {
  '413': { $ref: '#/components/responses/PayloadTooLarge' },
  '422': { $ref: '#/components/responses/ValidationFailed' },
  '500': { $ref: '#/components/responses/InternalError' },
  '502': { $ref: '#/components/responses/UpstreamFailure' },
};

/** The trip endpoints need an invite code (WU-22 plan D1): one scheme, and its two refusals. */
const INVITE_CODE = 'inviteCode';
const gated = {
  security: [{ [INVITE_CODE]: [] }],
};
const gatedResponses = {
  '401': { $ref: '#/components/responses/Unauthorized' },
  '429': { $ref: '#/components/responses/TooManyRequests' },
  ...errorResponses,
};

export function buildOpenApi(): JsonSchema {
  // LLM-only schemas never cross HTTP, so the API spec leaves them out.
  const llmOnly = new Set<string>(LLM_ONLY_IDS);
  const components = Object.fromEntries(
    Object.entries(emit((id) => `#/components/schemas/${id}`)).filter(([id]) => !llmOnly.has(id)),
  );
  for (const schema of Object.values(components)) {
    delete schema.$schema;
    delete schema.$id;
  }
  return {
    openapi: '3.1.1',
    info: {
      title: 'AI Trip Planner API',
      version: CONTRACT_VERSION,
      description:
        'Language-neutral HTTP contract. Generated from packages/domain-schema/src/wire; ' +
        'do not edit by hand. Business rules (rules.md) are not expressed here. On ' +
        '/v1/trip/extract a rule violation is a 200 `needs_clarification`; ' +
        '/v1/trip/recommend only takes a ready profile, so a rule violation there is a 422.',
    },
    servers: [{ url: 'http://localhost:4000', description: 'local api-nextjs' }],
    paths: {
      '/v1/trip/extract': {
        post: {
          operationId: 'extractTrip',
          ...gated,
          summary: 'Turn a message into an updated trip profile',
          requestBody: {
            required: true,
            ...jsonBody('ExtractRequest', 'Message and current state'),
          },
          responses: {
            '200': jsonBody('ExtractResponse', 'Ready, or needs clarification'),
            ...gatedResponses,
          },
        },
      },
      '/v1/trip/recommend': {
        post: {
          operationId: 'recommendTrips',
          ...gated,
          summary: 'Recommend destinations for a ready profile (critic applied)',
          requestBody: {
            required: true,
            ...jsonBody(
              'RecommendRequest',
              'A ready profile: one with any rule violation is a 422 VALIDATION_FAILED',
            ),
          },
          responses: {
            '200': jsonBody('RecommendResponse', 'Critic-checked recommendations'),
            ...gatedResponses,
          },
        },
      },
      '/v1/trip/present': {
        post: {
          operationId: 'presentTrips',
          ...gated,
          summary: 'Stream presentation copy for recommendations',
          requestBody: {
            required: true,
            ...jsonBody('PresentRequest', 'Profile and recommendations'),
          },
          responses: {
            '200': {
              description:
                'Raw JSON text streamed in chunks, with no SDK framing. Partial text is not ' +
                'valid JSON; the complete body parses as PresentationModel (x-final-schema).',
              content: {
                'text/plain': {
                  schema: { type: 'string' },
                  'x-final-schema': ref('PresentationModel'),
                },
              },
            },
            ...gatedResponses,
          },
        },
      },
      '/v1/health': {
        get: {
          operationId: 'health',
          security: [],
          summary: 'Liveness and contract version',
          responses: {
            '200': jsonBody('HealthResponse', 'Backend is up'),
            '500': errorResponses['500'],
          },
        },
      },
    },
    components: {
      schemas: components,
      securitySchemes: {
        [INVITE_CODE]: {
          type: 'http',
          scheme: 'bearer',
          description:
            'A per-recipient invite code: `Authorization: Bearer <code>`. The scheme name is ' +
            'case-insensitive. Required on the trip endpoints; health and CORS preflights are open.',
        },
      },
      responses: {
        Unauthorized: {
          ...jsonBody(
            'ErrorResponse',
            'Invite code missing, malformed, unknown or revoked (UNAUTHORIZED). The response ' +
              'does not say which.',
          ),
          headers: {
            'WWW-Authenticate': {
              description: 'Names the Bearer scheme (RFC 6750).',
              required: true,
              schema: { type: 'string' },
            },
          },
        },
        TooManyRequests: {
          ...jsonBody(
            'ErrorResponse',
            'RATE_LIMITED: a per-code or global window is full; retry after Retry-After. ' +
              'QUOTA_EXHAUSTED: the code has used its lifetime allowance for this endpoint; ' +
              'retrying will not help, and there is no Retry-After.',
          ),
          headers: {
            'Retry-After': {
              description: 'Whole seconds until the window resets. Sent with RATE_LIMITED only.',
              required: false,
              schema: { type: 'integer', minimum: 1 },
            },
          },
        },
        PayloadTooLarge: jsonBody(
          'ErrorResponse',
          `Request body over ${MAX_REQUEST_BODY_BYTES} bytes (PAYLOAD_TOO_LARGE)`,
        ),
        ValidationFailed: jsonBody(
          'ErrorResponse',
          'Request body fails the contract, or (on /v1/trip/recommend) its profile breaks a rule ' +
            '(VALIDATION_FAILED)',
        ),
        UpstreamFailure: jsonBody('ErrorResponse', 'Upstream LLM failure or refusal (LLM_*)'),
        InternalError: jsonBody('ErrorResponse', 'Bug (INTERNAL_ERROR)'),
      },
    },
  };
}

export function buildConstants() {
  return {
    contractVersion: CONTRACT_VERSION,
    minPopulatedFields: MIN_POPULATED_FIELDS,
    maxRequestBodyBytes: MAX_REQUEST_BODY_BYTES,
    maxMessageLength: MAX_MESSAGE_LENGTH,
    maxShortTextLength: MAX_SHORT_TEXT_LENGTH,
    maxNoteLength: MAX_NOTE_LENGTH,
    maxDateTextLength: MAX_DATE_TEXT_LENGTH,
    maxExperiences: MAX_EXPERIENCES,
    maxUnmappedExperiences: MAX_UNMAPPED_EXPERIENCES,
    maxPeople: MAX_PEOPLE,
    maxClarificationQuestionLength: MAX_CLARIFICATION_QUESTION_LENGTH,
    maxRecommendations: MAX_RECOMMENDATIONS,
    maxClaims: MAX_CLAIMS,
    maxSummaryLength: MAX_SUMMARY_LENGTH,
    maxClaimLength: MAX_CLAIM_LENGTH,
    maxCritiqueIssueLength: MAX_CRITIQUE_ISSUE_LENGTH,
    maxUnresolvedIssues: MAX_UNRESOLVED_ISSUES,
  };
}

/** Every generated file, keyed by its path relative to `generated/`. */
export function buildArtifacts(): Map<string, string> {
  const files = new Map<string, string>();
  for (const [id, schema] of Object.entries(buildJsonSchemas())) {
    files.set(schemaFileName(id), json(schema));
  }
  files.set(
    'openapi.yaml',
    '# GENERATED by `pnpm --filter @vp/domain-schema gen`. Do not edit.\n' +
      stringify(buildOpenApi(), { aliasDuplicateObjects: false, lineWidth: 0 }),
  );
  files.set('constants.json', json(buildConstants()));
  return files;
}
