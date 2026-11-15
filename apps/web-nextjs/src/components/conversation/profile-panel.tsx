// The profile so far, as labelled rows (AC-CONV-06).
import { Badge } from '@/components/ui/badge';
import type { ProfileRow } from '@/lib/conversation/profile-summary';

export function ProfilePanel({ rows }: { rows: ProfileRow[] }) {
  return (
    <section aria-labelledby="profile-heading" className="flex flex-col gap-3">
      <h2 id="profile-heading" className="text-lg font-semibold">
        Your trip so far
      </h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing yet. Describe your trip to get started.
        </p>
      ) : (
        <dl className="flex flex-col gap-3 text-sm">
          {rows.map((row) => (
            <div key={row.field} className="flex flex-col gap-1">
              <dt className="flex items-center gap-2 font-medium">
                {row.label}
                {row.needsAttention ? <Badge variant="destructive">Needs attention</Badge> : null}
              </dt>
              {row.values.map((value, index) => (
                <dd key={index}>{value}</dd>
              ))}
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
