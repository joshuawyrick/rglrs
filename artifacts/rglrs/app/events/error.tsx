"use client";

import { PageShell } from "@/components/page-shell";

export default function EventsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <PageShell>
    <div className="empty-state" role="alert">
      <strong>Could not load events</strong>
      <span>Check your connection, then try again.</span>
      <button className="secondary-btn" type="button" onClick={reset}>Retry</button>
    </div>
  </PageShell>;
}