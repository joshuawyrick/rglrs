"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#0b0f13", color: "#f5f7f8", fontFamily: "system-ui, sans-serif" }}>
        <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, textAlign: "center" }}>
          <div>
            <h1>Something went wrong</h1>
            <p>RGLRS couldn’t load safely.</p>
            {error.digest ? <p>Error ID: {error.digest}</p> : null}
            <button type="button" onClick={reset} style={{ marginTop: 16, padding: "12px 20px" }}>
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}