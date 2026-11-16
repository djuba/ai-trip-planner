// How sure the app is of a claim (AC-CARDS-04). The text carries the meaning, not the colour.
import type { Verification } from '@vp/domain-schema/wire';
import { Badge } from '@/components/ui/badge';
import { enumLabel } from '@/lib/messages';

export function VerificationBadge({ verification }: { verification: Verification }) {
  return (
    <Badge variant={verification === 'fixture' ? 'secondary' : 'outline'}>
      {enumLabel('verification', verification)}
    </Badge>
  );
}
