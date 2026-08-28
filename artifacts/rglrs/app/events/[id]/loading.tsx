import { PageShell } from "@/components/page-shell";

export default function EventLoading() {
  return <PageShell><div className="feed-loader" role="status"><span/><p className="sr-only">Loading event…</p></div></PageShell>;
}