// STUB — replaced in WU-11
import { PresentationModel, PresentRequest } from '@vp/domain-schema/wire';
import { postRoute, preflight } from '../../../../http/route.ts';
import { CANNED_PRESENT } from '../../../../stubs/canned.ts';

export const dynamic = 'force-dynamic';

const CHUNKS = 4;

export const POST = postRoute(PresentRequest, () => {
  const text = JSON.stringify(PresentationModel.parse(CANNED_PRESENT));
  const size = Math.ceil(text.length / CHUNKS);
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < text.length; i += size) {
        controller.enqueue(encoder.encode(text.slice(i, i + size)));
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
});

export const OPTIONS = preflight;
