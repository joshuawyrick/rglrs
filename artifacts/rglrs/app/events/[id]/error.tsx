"use client";

import Link from "next/link";
import { PageShell } from "@/components/page-shell";

export default function EventError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <PageShell>
    <div className="empty-state" role="alert">
      <strong>Could not load this event</strong>
      <span>It may be temporarily unavailable.</span>
      <div className="row gap8">
        <button className="secondary-btn" type="button" onClick={reset}>Retry</button>
        <Link className="text-btn" href="/events">All events</Link>
      </div>
    </div>
  </PageShell>;
}