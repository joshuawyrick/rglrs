"use client";

import { useEffect } from "react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Application render failed", { errorId: error.digest, error });
  }, [error]);

  return (
    <main className="splash-shell" role="alert">
      <h1>Something went wrong</h1>
      <p>We couldn’t load this view safely. Try again.</p>
      {error.digest ? <p className="muted">Error ID: {error.digest}</p> : null}
      <button className="primary-btn" style={{ marginTop: 24, minWidth: 150 }} onClick={reset}>
        Try again
      </button>
    </main>
  );
}