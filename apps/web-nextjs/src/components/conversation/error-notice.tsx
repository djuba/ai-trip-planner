// An API failure the user can act on (AC-CONV-09, AC-CONV-12).
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { ApiError } from '@/lib/api';
import { errorText } from '@/lib/conversation/error-text';

export function ErrorNotice({ error, onRetry }: { error: ApiError; onRetry: () => void }) {
  const text = errorText(error);
  if (text === null) return null;
  return (
    <Alert variant="destructive" role="alert">
      <AlertTitle>{text.title}</AlertTitle>
      <AlertDescription>
        {text.detail !== null ? <p>{text.detail}</p> : null}
        {text.canRetry ? (
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
