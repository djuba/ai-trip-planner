// The recommendations area: status, streamed cards, and failures (AC-CARDS-03 to -10).
import { ErrorNotice } from '@/components/conversation/error-notice';
import { PresentationCard } from '@/components/presentation/presentation-card';
import type { TripState } from '@/lib/conversation/reducer';
import { type PresentationView, presentationView } from '@/lib/presentation/view-model';

export interface PresentationResultsProps {
  trip: TripState;
  /** useObject's partial object; read ONLY while trip.step === 'presenting' (plan fix 2). */
  partial: unknown;
  onRetry: () => void;
}

function statusText(trip: TripState): string {
  switch (trip.step) {
    case 'recommending':
      return 'Finding trips…';
    case 'presenting':
      return 'Writing up your trips…';
    case 'presented':
      return 'Your recommendations are ready.';
    default:
      return '';
  }
}

export function PresentationResults({ trip, partial, onRetry }: PresentationResultsProps) {
  let view: PresentationView | undefined;
  if (trip.step === 'presenting') view = presentationView(partial, { finished: false });
  else if (trip.step === 'presented') view = presentationView(trip.model, { finished: true });

  const concerns =
    (trip.step === 'presenting' || trip.step === 'presented') &&
    trip.recommend.critique.unresolved.length > 0;
  const hasClaims =
    view !== undefined && view.cards.some((card) => card.claims !== null && card.claims.length > 0);
  const empty = trip.step === 'presented' && view !== undefined && view.cards.length === 0;

  return (
    <div className="flex flex-col gap-3">
      <p role="status" className="text-sm text-muted-foreground empty:sr-only">
        {statusText(trip)}
      </p>
      {trip.step === 'failed' ? <ErrorNotice error={trip.error} onRetry={onRetry} /> : null}
      {view !== undefined ? (
        <section aria-labelledby="results-heading" className="flex flex-col gap-4">
          <h2
            id="results-heading"
            className={view.headline !== undefined ? 'text-xl font-semibold' : 'sr-only'}
          >
            {view.headline ?? 'Recommendations'}
          </h2>
          {view.intro !== undefined ? <p>{view.intro}</p> : null}
          {concerns ? (
            <p className="text-sm">
              The planner&apos;s own checks still had concerns about these suggestions, so treat
              them with extra care.
            </p>
          ) : null}
          {hasClaims ? (
            <p className="text-sm text-muted-foreground">
              There&apos;s no live flight or hotel data here. Claims marked Unverified are the
              planner&apos;s suggestions; check them before booking. From sample route data means
              the route is in a small sample dataset, not a live schedule.
            </p>
          ) : null}
          {empty ? (
            <p>No trips matched this profile. Try changing a detail.</p>
          ) : (
            <ol aria-busy={trip.step === 'presenting'} className="flex flex-col gap-4">
              {view.cards.map((card) => (
                <li key={card.key}>
                  <PresentationCard card={card} />
                </li>
              ))}
            </ol>
          )}
        </section>
      ) : null}
    </div>
  );
}
