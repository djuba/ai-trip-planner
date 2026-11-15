// The conversation's messages (AC-CONV-01, -02, -04, -08). Model text is rendered as plain text.
import type { Turn } from '@/lib/conversation/reducer';
import { describeViolation } from '@/lib/messages';

export function MessageThread({ turns, sending }: { turns: Turn[]; sending: boolean }) {
  return (
    <section aria-labelledby="conversation-heading" className="flex flex-col gap-3">
      <h2 id="conversation-heading" className="sr-only">
        Conversation
      </h2>
      <div role="log" aria-live="polite" className="flex flex-col gap-3">
        {turns.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Describe where you want to go, when, and who is coming.
          </p>
        ) : (
          <ol className="flex flex-col gap-3">
            {turns.map((turn) => (
              <li key={turn.id} className="flex flex-col gap-1 rounded-lg border p-3 text-sm">
                {turn.role === 'user' ? (
                  <>
                    <span className="font-medium">You</span>
                    <p className="whitespace-pre-wrap">{turn.text}</p>
                  </>
                ) : turn.kind === 'clarification' ? (
                  <>
                    <span className="font-medium">Planner</span>
                    <p>{turn.question}</p>
                    <span className="mt-2 font-medium">What needs fixing</span>
                    <ul className="list-disc pl-5">
                      {turn.violations.map((violation, index) => (
                        <li key={index}>{describeViolation(violation)}</li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <>
                    <span className="font-medium">Planner</span>
                    <p>
                      Your trip profile is ready. You can still correct anything by sending another
                      message.
                    </p>
                  </>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
      {/* Always in the DOM, so screen readers announce the text when it appears (review fix 1). */}
      <p role="status" className="text-sm text-muted-foreground empty:hidden">
        {sending ? 'Planning…' : ''}
      </p>
    </section>
  );
}
