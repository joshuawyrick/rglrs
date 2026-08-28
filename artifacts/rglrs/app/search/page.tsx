"use client";

import Link from "next/link";
import { CalendarDays, FileText, Search as SearchIcon, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { PageShell } from "@/components/page-shell";
import { JsonRow, requireRpc, rows } from "@/lib/social-data";

type SearchResults = { people: JsonRow[]; events: JsonRow[]; posts: JsonRow[] };
const empty: SearchResults = { people: [], events: [], posts: [] };
const value = (row: JsonRow, ...keys: string[]) => keys.map((key) => row[key]).find((item): item is string => typeof item === "string") || "";

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults>(empty);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = query.trim();

  useEffect(() => {
    let active = true;
    if (trimmed.length < 2) {
      setResults(empty);
      setLoading(false);
      setError(null);
      return () => { active = false; };
    }
    setLoading(true);
    setError(null);
    const timeout = window.setTimeout(async () => {
      try {
        const data = await requireRpc("search_authorized", { p_query: trimmed, p_limit: 20 });
        if (!active) return;
        setResults({ people: rows(data, "people"), events: rows(data, "events"), posts: rows(data, "posts") });
      } catch (cause) {
        if (!active) return;
        setResults(empty);
        setError(cause instanceof Error ? cause.message : "Search could not be completed.");
      } finally {
        if (active) setLoading(false);
      }
    }, 300);
    return () => { active = false; window.clearTimeout(timeout); };
  }, [trimmed]);

  const total = results.people.length + results.events.length + results.posts.length;
  return <PageShell>
    <div className="row space" style={{minHeight:52}}>
      <h1 style={{margin:0,fontSize:18}}>Search</h1>
      <Link href="/friends" className="secondary-btn" style={{padding: "6px 12px", fontSize: "11px", minHeight: "32px"}}>Manage friends</Link>
    </div>
    <label className="search-box"><SearchIcon size={15} color="var(--muted)"/><span className="sr-only">Search people, events, and posts</span><input className="input" value={query} maxLength={80} onChange={(event) => setQuery(event.target.value)} placeholder="Search people, events, posts…"/></label>
    <div className="search-status" role="status">{!trimmed ? "Search across private content you are authorized to see." : trimmed.length < 2 ? "Enter at least 2 characters." : loading ? "Searching…" : error || `${total} result${total === 1 ? "" : "s"} found`}</div>
    {error ? <div className="empty-state"><strong>Search unavailable</strong><span>{error}</span></div> : null}
    {!loading && !error && trimmed.length >= 2 && !total ? <div className="empty-state"><strong>No authorized results</strong><span>Try a different name, event, or post phrase.</span></div> : null}
    {results.people.length ? <SearchSection title="People">{results.people.map((person) => {
      const id = value(person, "id", "profile_id");
      const name = value(person, "display_name", "name") || "Member";
      return <Link href={`/people/${id}`} className="search-result-row" key={id}><div className="search-type-icon"><UserRound size={17}/></div><div><div className="friend-name">{name}</div><div className="friend-sub">{value(person, "username") ? `@${value(person, "username")}` : "Person"}</div></div></Link>;
    })}</SearchSection> : null}
    {results.events.length ? <SearchSection title="Events">{results.events.map((event) => {
      const id = value(event, "id", "event_id");
      return <Link href={`/events/${id}`} className="search-result-row" key={id}><div className="search-type-icon"><CalendarDays size={17}/></div><div><div className="friend-name">{value(event, "title", "name") || "Event"}</div><div className="friend-sub">{value(event, "starts_at", "place_name") || "Private event"}</div></div></Link>;
    })}</SearchSection> : null}
    {results.posts.length ? <SearchSection title="Posts">{results.posts.map((post) => {
      const id = value(post, "id", "post_id");
      return <Link href={`/post/${id}`} className="search-result-row" key={id}><div className="search-type-icon"><FileText size={17}/></div><div><div className="friend-name">{value(post, "author_name", "display_name") || "Post"}</div><div className="friend-sub search-snippet">{value(post, "caption", "body", "text") || "Shared post"}</div></div></Link>;
    })}</SearchSection> : null}
  </PageShell>;
}

function SearchSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section><h2 className="search-section-title">{title}</h2>{children}</section>;
}