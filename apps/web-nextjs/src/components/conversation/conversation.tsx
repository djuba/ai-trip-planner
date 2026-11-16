'use client';
// The conversation screen (WU-13 plan D1, D5, D7; WU-14 plan D5): wires the hook to the API
// client, the invite store and the presentational components. Holds no state of its own beyond
// the hook's.
import { useEffect, useMemo, useState } from 'react';
import { PresentationResults } from '@/components/presentation/presentation-results';
import { Button } from '@/components/ui/button';
import { apiBaseUrl, createApiClient, type ApiClient } from '@/lib/api';
import { localDate } from '@/lib/conversation/local-date';
import { summarizeProfile } from '@/lib/conversation/profile-summary';
import { canRecommend, canSend } from '@/lib/conversation/reducer';
import { useConversation } from '@/lib/conversation/use-conversation';
import { createInviteStore, takeInviteFromUrl, type InviteStore } from '@/lib/invite';
import { ErrorNotice } from './error-notice';
import { InvitePrompt } from './invite-prompt';
import { MessageComposer } from './message-composer';
import { MessageThread } from './message-thread';
import { ProfilePanel } from './profile-panel';

type Client = Pick<ApiClient, 'extract' | 'recommend' | 'present'>;

/** Without a base URL every call fails as `network`, shown as "can't reach the planner". */
const unreachable: Client = {
  extract: () => Promise.resolve({ ok: false, error: { kind: 'network' } }),
  recommend: () => Promise.resolve({ ok: false, error: { kind: 'network' } }),
  present: () => Promise.resolve({ ok: false, error: { kind: 'network' } }),
};

function defaultClient(invites: InviteStore): Client {
  try {
    return createApiClient({ baseUrl: apiBaseUrl(), getInviteCode: () => invites.get() });
  } catch (error) {
    console.error(String(error));
    return unreachable;
  }
}

const browserToday = (): string => localDate(new Date());

export interface ConversationProps {
  client?: Client;
  invites?: InviteStore;
  today?: () => string;
}

export function Conversation({ client, invites, today = browserToday }: ConversationProps) {
  const [store] = useState(() => invites ?? createInviteStore());
  const api = useMemo(() => client ?? defaultClient(store), [client, store]);
  const { state, partial, send, retry, submitInvite, reset, getRecommendations, retryTrip } =
    useConversation({ client: api, invites: store, today });

  // An invite link fills in the code and leaves the address bar (AC-CONV-11).
  useEffect(() => {
    const code = takeInviteFromUrl(window.location, window.history);
    if (code !== undefined) store.set(code);
  }, [store]);

  const rows = summarizeProfile(state.profile, state.violations);
  const started = state.turns.length > 0;

  return (
    <div className="flex flex-col gap-8">
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <MessageThread turns={state.turns} sending={state.status === 'sending'} />
          {state.error !== undefined && <ErrorNotice error={state.error} onRetry={retry} />}
          {state.invite === 'none' ? (
            <MessageComposer onSend={send} disabled={!canSend(state)} />
          ) : (
            <InvitePrompt state={state.invite} onSubmit={submitInvite} />
          )}
          <div className="flex flex-wrap gap-2">
            {canRecommend(state) && (
              <Button type="button" onClick={getRecommendations}>
                Get recommendations
              </Button>
            )}
            {started && (
              <Button type="button" variant="ghost" onClick={reset}>
                Start over
              </Button>
            )}
          </div>
        </div>
        {/* Above the thread on narrow screens, beside it from md (WU-13 plan D7, review fix 3). */}
        <div className="order-first md:order-none">
          <ProfilePanel rows={rows} />
        </div>
      </div>
      <PresentationResults trip={state.trip} partial={partial} onRetry={retryTrip} />
    </div>
  );
}
