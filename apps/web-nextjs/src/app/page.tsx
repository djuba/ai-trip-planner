// The shell's one page. WU-13 replaces the placeholder card with the conversation.
import { ApiStatus } from '@/components/api-status';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <p className="text-lg font-semibold tracking-tight">AI Trip Planner</p>
          <Badge variant="outline">Preview</Badge>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        <h1 className="mb-6 text-3xl font-semibold tracking-tight">
          Plan a trip in your own words
        </h1>
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>How it works</h2>
            </CardTitle>
            <CardDescription>
              Describe where you want to go, when, and who is coming. The planner turns it into a
              structured trip profile, asks about anything missing or inconsistent, then suggests
              destinations.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">The conversation is coming soon.</p>
          </CardContent>
        </Card>
      </main>
      <footer className="border-t">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm text-muted-foreground">
          <p>
            Recommendations are suggestions, not bookings. Flight and price details are unverified.
          </p>
          <ApiStatus />
        </div>
      </footer>
    </div>
  );
}
