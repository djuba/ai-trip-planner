// The shell's one page: the conversation (WU-13). Recommendations follow in WU-14.
import { ApiStatus } from '@/components/api-status';
import { Conversation } from '@/components/conversation/conversation';
import { Badge } from '@/components/ui/badge';

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <p className="text-lg font-semibold tracking-tight">AI Trip Planner</p>
          <Badge variant="outline">Preview</Badge>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">
        <h1 className="mb-2 text-3xl font-semibold tracking-tight">
          Plan a trip in your own words
        </h1>
        <p className="mb-6 text-muted-foreground">
          The planner turns your description into a structured trip profile, then asks about
          anything missing or inconsistent.
        </p>
        <Conversation />
      </main>
      <footer className="border-t">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm text-muted-foreground">
          <p>
            Recommendations are suggestions, not bookings. Flight and price details are unverified.
          </p>
          <ApiStatus />
        </div>
      </footer>
    </div>
  );
}
