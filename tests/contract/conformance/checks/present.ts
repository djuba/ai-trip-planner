import { mediaType, postStream } from '../../support/http.ts';
import { assertSchema, ConformanceError } from '../../support/schemas.ts';
import { PRESENT_PATH, presentRequest } from './requests.ts';

export async function checkPresentStream(
  baseUrl: string,
  request: unknown = presentRequest(),
): Promise<void> {
  const context = `POST ${PRESENT_PATH}`;
  const res = await postStream(baseUrl, PRESENT_PATH, request);
  if (res.status !== 200) {
    throw new ConformanceError(
      `${context}: expected 200, got ${res.status}: ${res.text.slice(0, 300)}`,
    );
  }
  const type = mediaType(res.header('content-type'));
  if (type !== 'text/plain') {
    throw new ConformanceError(`${context}: expected text/plain, got ${type}`);
  }
  let body: unknown;
  try {
    body = JSON.parse(res.text);
  } catch {
    throw new ConformanceError(
      `${context}: the complete stream is not raw JSON (SDK framing such as 0:"..." is not ` +
        `allowed): ${res.text.slice(0, 200)}`,
    );
  }
  assertSchema('PresentationModel', body, context);
}
