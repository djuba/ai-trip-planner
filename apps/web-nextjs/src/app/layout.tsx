// Root layout: the page frame every screen shares (header, main, footer). No data fetching here.
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'AI Trip Planner',
  description: 'Describe a trip in your own words and get structured, checked recommendations.',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
