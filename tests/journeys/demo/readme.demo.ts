// The README demo: the @smoke journey's flow (AC-JOURNEY-01), paced for a viewer. Its messages
// must stay byte-for-byte those of specs/clarify-to-recommendations.spec.ts, so every model call
// replays from the committed cassettes. The pauses are for the recording; tests never sleep.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { fixClock } from '../support/clock.ts';
import { inviteCode, thread } from '../support/start-trip.ts';

const TYPING_DELAY_MS = 25;

async function type(page: Page, text: string): Promise<void> {
  const box = page.getByLabel('Your message');
  await press(page, box);
  await box.pressSequentially(text, { delay: TYPING_DELAY_MS });
  await page.waitForTimeout(300);
  await press(page, page.getByRole('button', { name: 'Send' }));
}

/** Where the pointer starts, and how long a glide to a control takes (in mouse-move steps). */
const POINTER_START = { x: 560, y: 360 };
const GLIDE_STEPS = 22;
/** Out of the way, in the right-hand margin, while the results stream in. */
const POINTER_ASIDE = { x: 1040, y: 420 };

/**
 * Glides the pointer to the middle of a control, rests on it a moment, then clicks: the
 * recording has no system pointer, so the drawn one (showPointer) is how a viewer sees the click.
 */
async function press(page: Page, target: Locator, restMs = 250): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (box === null) throw new Error('press: the control has no box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: GLIDE_STEPS });
  await page.waitForTimeout(restMs);
  await page.mouse.down();
  await page.mouse.up();
}

/**
 * Draws a pointer that follows the mouse, and a ring that pulses out on each press. In the
 * recording's browser only: Playwright's video shows no pointer of its own.
 */
async function showPointer(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const install = () => {
      const style = document.createElement('style');
      style.textContent = `
        #demo-pointer { position: fixed; z-index: 2147483647; pointer-events: none;
          width: 22px; height: 22px; margin: -11px 0 0 -11px; border-radius: 50%;
          background: rgba(37, 99, 235, 0.35); border: 2px solid rgb(37, 99, 235);
          left: -100px; top: -100px; transition: transform 120ms ease-out; }
        #demo-pointer.down { transform: scale(0.7); }
        .demo-ripple { position: fixed; z-index: 2147483646; pointer-events: none;
          width: 22px; height: 22px; margin: -11px 0 0 -11px; border-radius: 50%;
          border: 3px solid rgb(37, 99, 235); animation: demo-ripple 600ms ease-out forwards; }
        @keyframes demo-ripple { from { transform: scale(1); opacity: 0.9; }
          to { transform: scale(3.2); opacity: 0; } }`;
      document.head.append(style);
      const pointer = document.createElement('div');
      pointer.id = 'demo-pointer';
      document.body.append(pointer);
      document.addEventListener('mousemove', (event) => {
        pointer.style.left = `${event.clientX}px`;
        pointer.style.top = `${event.clientY}px`;
      });
      document.addEventListener('mousedown', (event) => {
        pointer.classList.add('down');
        const ripple = document.createElement('div');
        ripple.className = 'demo-ripple';
        ripple.style.left = `${event.clientX}px`;
        ripple.style.top = `${event.clientY}px`;
        document.body.append(ripple);
        setTimeout(() => ripple.remove(), 700);
      });
      document.addEventListener('mouseup', () => pointer.classList.remove('down'));
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
    else install();
  });
}

test('README demo', async ({ page }) => {
  await paceStream(page, '/v1/trip/present');
  await showPointer(page);
  await fixClock(page);
  // Opened through an invite link, as a demo is sent to someone: the app stores the code and
  // drops it from the address bar, so the code prompt never appears (web WU-13 plan D5).
  await page.goto(`/?invite=${encodeURIComponent(inviteCode())}`);
  await page.mouse.move(POINTER_START.x, POINTER_START.y);
  await page.waitForTimeout(500);

  await type(page, "I'd like a beach holiday sometime.");
  await expect(thread(page).getByText('What needs fixing')).toBeVisible();
  await page.waitForTimeout(1600);

  await type(page, 'Two adults flying from Chicago, somewhere in the Caribbean in March 2027.');
  await expect(thread(page).getByText(/Your trip profile is ready/)).toBeVisible();
  await page.waitForTimeout(500);

  // A longer rest on the button, so the eye finds it before the click.
  await press(page, page.getByRole('button', { name: 'Get recommendations' }), 700);
  // The button goes away and Start over moves up under the pointer; move the pointer aside.
  await page.mouse.move(POINTER_ASIDE.x, POINTER_ASIDE.y, { steps: GLIDE_STEPS });

  // Follow the page down as the results load and stream in, until the stream has finished and
  // the last card is on screen.
  await page.waitForTimeout(600);
  await followToEnd(page, READY_TEXT);
  await expect(page.getByRole('status').filter({ hasText: READY_TEXT })).toBeVisible();
  await page.waitForTimeout(2500);
});

const READY_TEXT = 'Your recommendations are ready.';

/** The recording's pace for the model's prose: about 250 characters a second. */
const PROSE_CHARS = 10;
const PROSE_MS = 40;
/** A pause before the first chunk, so "Writing up your trips…" is on screen first. */
const FIRST_CHUNK_DELAY_MS = 900;

/**
 * Replay sends the /present stream almost at once, so the cards would appear already written.
 * In the recording's browser only, this wraps fetch for that one path and plays the real response
 * back the way it arrives live. Each card's `claims` array, which the server writes from the
 * request, goes out at once; the model's prose (headline, intro, titles, blurbs, highlights) is
 * paced. The app reads it as it would a live stream. (Chromium's network throttling was tried
 * first: it delivers 1,500-byte packets, so the cards arrived in two bursts, and pacing every
 * byte equally made each card wait on its claims.)
 */
async function paceStream(page: Page, path: string): Promise<void> {
  await page.addInitScript(
    ([streamPath, proseChars, proseMs, firstDelay]) => {
      /** The body cut into [text, delay before it] pieces: claims arrays whole, prose in small pieces. */
      const pieces = (body: string): Array<[string, number]> => {
        const out: Array<[string, number]> = [];
        let i = 0;
        while (i < body.length) {
          const claims = body.indexOf('"claims":[', i);
          const proseEnd = claims === -1 ? body.length : claims;
          for (let j = i; j < proseEnd; j += proseChars) {
            out.push([body.slice(j, Math.min(j + proseChars, proseEnd)), proseMs]);
          }
          if (claims === -1) break;
          // The claims array ends at its matching bracket; statements contain no brackets.
          let depth = 0;
          let k = claims + '"claims":'.length;
          for (; k < body.length; k++) {
            if (body[k] === '[') depth++;
            else if (body[k] === ']' && --depth === 0) break;
          }
          out.push([body.slice(claims, k + 1), 0]);
          i = k + 1;
        }
        if (out[0]) out[0][1] = firstDelay;
        return out;
      };

      const original = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const response = await original(input, init);
        const url = input instanceof Request ? input.url : String(input);
        if (!new URL(url, location.href).pathname.endsWith(streamPath) || !response.ok) {
          return response;
        }
        const queue = pieces(await response.text());
        const encoder = new TextEncoder();
        const paced = new ReadableStream<Uint8Array>({
          async pull(controller) {
            const next = queue.shift();
            if (next === undefined) {
              controller.close();
              return;
            }
            const [text, delay] = next;
            if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
            controller.enqueue(encoder.encode(text));
          },
        });
        return new Response(paced, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      };
    },
    [path, PROSE_CHARS, PROSE_MS, FIRST_CHUNK_DELAY_MS] as const,
  );
}

/**
 * Keeps the bottom of a growing page on screen, one animation frame at a time: each frame closes
 * part of the distance to the bottom, so the scroll is gentle when the stream is slow and catches
 * up when it falls behind. Stops once the page shows `doneText` and the bottom is reached.
 */
async function followToEnd(page: Page, doneText: string): Promise<void> {
  await page.evaluate(
    (text) =>
      new Promise<void>((resolve) => {
        const step = () => {
          const bottom = document.documentElement.scrollHeight - window.innerHeight;
          const gap = bottom - window.scrollY;
          // At most 14 px a frame (about 840 px/s), at least 0.6 px, and a tenth of the gap.
          window.scrollTo(
            0,
            window.scrollY + Math.min(gap, Math.max(0.6, Math.min(14, gap * 0.1))),
          );
          const done = document.body.innerText.includes(text);
          if (done && bottom - window.scrollY < 1) resolve();
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
    doneText,
  );
}
