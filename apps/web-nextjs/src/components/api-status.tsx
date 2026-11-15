'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { apiBaseUrl, createApiClient, type ApiClient } from '@/lib/api';

type Status = { state: 'checking' } | { state: 'connected'; version: string } | { state: 'down' };

function defaultClient(): Pick<ApiClient, 'health'> | null {
  try {
    return createApiClient({ baseUrl: apiBaseUrl(), getInviteCode: () => undefined });
  } catch (error) {
    console.error(String(error));
    return null;
  }
}

export function ApiStatus({ client }: { client?: Pick<ApiClient, 'health'> }) {
  const [status, setStatus] = useState<Status>({ state: 'checking' });

  useEffect(() => {
    const active = client ?? defaultClient();
    if (active === null) {
      setStatus({ state: 'down' });
      return;
    }
    const controller = new AbortController();
    let mounted = true;
    void active.health({ signal: controller.signal }).then((result) => {
      if (!mounted) return;
      setStatus(
        result.ok
          ? { state: 'connected', version: result.data.contractVersion }
          : { state: 'down' },
      );
    });
    return () => {
      mounted = false;
      controller.abort();
    };
  }, [client]);

  const variant =
    status.state === 'connected'
      ? 'secondary'
      : status.state === 'down'
        ? 'destructive'
        : 'outline';
  const text =
    status.state === 'connected'
      ? `API connected · contract ${status.version}`
      : status.state === 'down'
        ? 'API unavailable'
        : 'Checking the API…';

  return (
    <div role="status" aria-live="polite">
      <Badge variant={variant}>{text}</Badge>
    </div>
  );
}
