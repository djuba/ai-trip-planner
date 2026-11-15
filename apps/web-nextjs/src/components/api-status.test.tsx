// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ApiStatus } from '@/components/api-status';
import type { ApiClient } from '@/lib/api';
import { healthResponse } from '../../tests/support/fixtures';

type Health = Pick<ApiClient, 'health'>;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it('AC-WEB-12: shows a checking state first', () => {
  const client: Health = { health: () => new Promise(() => undefined) };
  render(<ApiStatus client={client} />);
  expect(screen.getByRole('status')).toHaveTextContent('Checking the API…');
});

it('AC-WEB-12: shows the contract version once connected', async () => {
  const client: Health = { health: () => Promise.resolve({ ok: true, data: healthResponse() }) };
  render(<ApiStatus client={client} />);
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent(
      `API connected · contract ${healthResponse().contractVersion}`,
    ),
  );
});

it('AC-WEB-12: shows unavailable for an error result', async () => {
  const client: Health = {
    health: () => Promise.resolve({ ok: false, error: { kind: 'network' } }),
  };
  render(<ApiStatus client={client} />);
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('API unavailable'));
});

it('AC-WEB-12: shows unavailable and logs when no base URL is configured', async () => {
  vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', '');
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  render(<ApiStatus />);
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('API unavailable'));
  expect(error).toHaveBeenCalledWith(expect.stringContaining('NEXT_PUBLIC_API_BASE_URL'));
});

it('AC-WEB-12: builds its own client from the base URL by default', async () => {
  vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'http://api.test/');
  const fetchMock = vi.fn<typeof fetch>(() =>
    Promise.resolve(new Response(JSON.stringify(healthResponse()), { status: 200 })),
  );
  vi.stubGlobal('fetch', fetchMock);
  render(<ApiStatus />);
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('API connected'));
  expect(fetchMock).toHaveBeenCalledWith('http://api.test/v1/health', expect.anything());
  vi.unstubAllGlobals();
});

it('AC-WEB-12: aborts the request and ignores the result after unmount', async () => {
  let signal: AbortSignal | undefined;
  let resolve: (value: Awaited<ReturnType<Health['health']>>) => void = () => undefined;
  const client: Health = {
    health: (init) => {
      signal = init?.signal;
      return new Promise((r) => {
        resolve = r;
      });
    },
  };
  const { unmount } = render(<ApiStatus client={client} />);
  unmount();
  expect(signal?.aborted).toBe(true);
  resolve({ ok: false, error: { kind: 'aborted' } });
  await Promise.resolve();
});
