// One recommendation card. Model text is rendered as plain text nodes (AC-CARDS-12).
import { VerificationBadge } from '@/components/presentation/verification-badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { CardView } from '@/lib/presentation/view-model';

export function PresentationCard({ card }: { card: CardView }) {
  const headingId = `card-${card.key}-title`;
  const title = card.title;
  return (
    <article
      aria-labelledby={title !== undefined ? headingId : undefined}
      aria-label={title !== undefined ? undefined : 'Recommendation'}
    >
      <Card>
        {title !== undefined ? (
          <CardHeader>
            <CardTitle>
              <h3 id={headingId}>{title}</h3>
            </CardTitle>
          </CardHeader>
        ) : null}
        <CardContent className="flex flex-col gap-3 text-sm">
          {card.blurb !== undefined ? <p>{card.blurb}</p> : null}
          {card.highlights.length > 0 ? (
            <ul className="list-disc pl-5">
              {card.highlights.map((highlight, index) => (
                <li key={index}>{highlight}</li>
              ))}
            </ul>
          ) : null}
          {card.claims !== null && card.claims.length > 0 ? (
            <ul aria-label="Claims" className="flex flex-col gap-2">
              {card.claims.map((claim, index) => (
                <li key={index} className="flex flex-wrap items-center gap-2">
                  <span>{claim.statement}</span>
                  <VerificationBadge verification={claim.verification} />
                </li>
              ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>
    </article>
  );
}
