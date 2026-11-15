// @vitest-environment jsdom
// The container with its real components, hook and reducer; only the API client is faked.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { buildFixture } from '@vp/domain-schema/testing';
import { ExtractResponse, type ExtractRequest } from '@vp/domain-schema/wire';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient, ApiResult } from '@/lib/api';
import { createInviteStore, type InviteStore } from '@/lib/invite';
import { Conversation } from './conversation';

const clarification = buildFixture(ExtractResponse, {
  status: 'needs_clarification',
  profile: { climate: 'warm', people: [{ userType: 'child', age: 19 }] },
  violations: [
    { code: 'CHILD_AGE_RANGE', path: '/people/0/age', params: { age: 19, min: 0, max: 17 } },
  ],
  clarificationQuestion: 'Is the 19-year-old an adult?',
});
const ready = buildFixture(ExtractResponse, {
  status: 'ready',
  profile: {
    climate: 'warm',
    region: 'Hawaii',
    people: [{ userType: 'adult', age: 19 }],
  },
});

type Result = ApiResult<ExtractResponse>;

function fakeClient(...results: Result[]) {
  const bodies: ExtractRequest[] = [];
  const extract = vi.fn<ApiClient['extract']>((body) => {
    bodies.push(body);
    return Promise.resolve(results.shift() ?? { ok: false, error: { kind: 'network' } });
  });
  return { client: { extract }, bodies };
}

function memoryInvites(): InviteStore {
  return createInviteStore(() => undefined);
}

function renderConversation(client: Pick<ApiClient, 'extract'>, invites = memoryInvites()) {
  render(<Conversation client={client} invites={invites} today={() => '2030-01-15'} />);
  return invites;
}

function sendMessage(text: string) {
  fireEvent.change(screen.getByLabelText('Your message'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
}

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('Conversation', () => {
  it('AC-CONV-02: shows the question and what needs fixing, and fills the profile panel', async () => {
    const { client } = fakeClient({ ok: true, data: clarification });
    renderConversation(client);
    sendMessage('Somewhere warm with my kid');
    expect(await screen.findByText('Is the 19-year-old an adult?')).toBeInTheDocument();
    expect(screen.getByText(/A child's age must be from 0 to 17/)).toBeInTheDocument();
    const panel = screen.getByRole('region', { name: 'Your trip so far' });
    expect(within(panel).getByText('Warm')).toBeInTheDocument();
    expect(within(panel).getByText('Needs attention')).toBeInTheDocument();
  });

  it('AC-CONV-03 / AC-CONV-04: the next turn sends the profile back; ready keeps the composer', async () => {
    const { client, bodies } = fakeClient(
      { ok: true, data: clarification },
      { ok: true, data: ready },
    );
    renderConversation(client);
    sendMessage('Somewhere warm with my kid');
    await screen.findByText('Is the 19-year-old an adult?');
    sendMessage('Actually they are an adult, and Hawaii');
    expect(await screen.findByText(/Your trip profile is ready/)).toBeInTheDocument();
    expect(bodies[1]).toEqual({
      message: 'Actually they are an adult, and Hawaii',
      currentProfile: clarification.profile,
      referenceDate: '2030-01-15',
    });
    expect(screen.queryByText('Needs attention')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Your message')).toBeEnabled();
  });

  it('AC-CONV-09: an error offers Retry, which sends the same request again', async () => {
    const { client, bodies } = fakeClient(
      { ok: false, error: { kind: 'upstream', refusal: false } },
      { ok: true, data: clarification },
    );
    renderConversation(client);
    sendMessage('Somewhere warm');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("The planner couldn't answer just now.");
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    await screen.findByText('Is the 19-year-old an adult?');
    expect(bodies[1]).toBe(bodies[0]);
    expect(screen.getAllByText('Somewhere warm')).toHaveLength(1);
  });

  it('AC-CONV-10: a 401 shows the code entry instead of the composer, and retries with it', async () => {
    const { client, bodies } = fakeClient(
      { ok: false, error: { kind: 'unauthorized' } },
      { ok: true, data: clarification },
    );
    const invites = renderConversation(client);
    expect(screen.queryByRole('textbox', { name: 'Invite code' })).not.toBeInTheDocument();
    sendMessage('Somewhere warm');
    const input = await screen.findByRole('textbox', { name: 'Invite code' });
    expect(screen.queryByLabelText('Your message')).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'abc-123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByText('Is the 19-year-old an adult?');
    expect(invites.get()).toBe('abc-123');
    expect(bodies).toHaveLength(2);
  });

  it('AC-CONV-11: an invite link is stored and removed from the address bar', () => {
    window.history.replaceState(null, '', '/?invite=from-link&x=1');
    const invites = renderConversation(fakeClient().client);
    expect(invites.get()).toBe('from-link');
    expect(window.location.search).toBe('?x=1');
  });

  it('AC-CONV-08: Start over clears the conversation', async () => {
    const { client } = fakeClient({ ok: true, data: clarification });
    renderConversation(client);
    expect(screen.queryByRole('button', { name: 'Start over' })).not.toBeInTheDocument();
    sendMessage('Somewhere warm');
    await screen.findByText('Is the 19-year-old an adult?');
    fireEvent.click(screen.getByRole('button', { name: 'Start over' }));
    expect(screen.queryByText('Is the 19-year-old an adult?')).not.toBeInTheDocument();
    expect(screen.getByText(/Nothing yet/)).toBeInTheDocument();
  });

  it('AC-CONV-09: without a configured base URL, a turn says the planner is unreachable', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', '');
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<Conversation invites={memoryInvites()} today={() => '2030-01-15'} />);
    sendMessage('Somewhere warm');
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent("Can't reach the planner."),
    );
    expect(error).toHaveBeenCalledWith(expect.stringContaining('NEXT_PUBLIC_API_BASE_URL'));
    vi.unstubAllEnvs();
    error.mockRestore();
  });

  it('AC-CONV-01: by default it builds a client from the base URL and sends the stored code', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'http://api.test');
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(JSON.stringify(clarification), { status: 200 })),
    );
    vi.stubGlobal('fetch', fetchMock);
    const invites = memoryInvites();
    invites.set('abc-123');
    render(<Conversation invites={invites} />);
    sendMessage('Somewhere warm');
    await screen.findByText('Is the 19-year-old an adult?');
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('http://api.test/v1/trip/extract');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer abc-123');
    const body = JSON.parse(init?.body as string) as { referenceDate: string };
    expect(body.referenceDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
});
