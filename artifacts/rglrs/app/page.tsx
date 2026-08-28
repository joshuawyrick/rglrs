"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SlidersHorizontal } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { InfiniteFeed, StoriesRail } from "@/components/feed";

function HomeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const kind = searchParams.get("feed");
  const activeKind = kind === "events" || kind === "photos" || kind === "videos" ? kind : "all";
  const author = searchParams.get("from") === "me" ? "me" : "all";
  const captionsOnly = searchParams.get("captioned") === "1";
  const [filtersOpen, setFiltersOpen] = useState(false);

  function update(values: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams.toString());
    Object.entries(values).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key));
    router.replace(next.size ? `/?${next.toString()}` : "/", { scroll: false });
  }

  return (
    <PageShell homeHeader>
      <StoriesRail/>
      <div className="row space" style={{marginBottom:4,position:"relative"}}>
        <div className="feed-tabs" style={{padding:0}}>
          {(["all","events","photos","videos"] as const).map((value) => (
            <button key={value} type="button" className={`pill ${activeKind === value ? "active" : ""}`} onClick={() => update({ feed: value === "all" ? null : value })}>
              {value[0].toUpperCase() + value.slice(1)}
            </button>
          ))}
        </div>
        <button className="screen-icon-btn" style={{width:34,height:34}} aria-label="Filter feed" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((open) => !open)}><SlidersHorizontal size={15}/></button>
        {filtersOpen ? <div className="card card-pad stack gap8" style={{position:"absolute",right:0,top:39,zIndex:20,minWidth:190}}>
          <strong style={{fontSize:10}}>Filter posts</strong>
          <label className="row gap8" style={{fontSize:9}}><input type="radio" name="feed-author" checked={author === "all"} onChange={() => update({from:null})}/> Everyone in my feed</label>
          <label className="row gap8" style={{fontSize:9}}><input type="radio" name="feed-author" checked={author === "me"} onChange={() => update({from:"me"})}/> My posts</label>
          <label className="row gap8" style={{fontSize:9}}><input type="checkbox" checked={captionsOnly} onChange={(event) => update({captioned:event.target.checked ? "1" : null})}/> Has a caption</label>
          <button className="text-btn" type="button" onClick={() => { update({from:null,captioned:null}); setFiltersOpen(false); }}>Clear filters</button>
        </div> : null}
      </div>
      <InfiniteFeed kind={activeKind} author={author} captionsOnly={captionsOnly}/>
    </PageShell>
  );
}

export default function HomePage() {
  return <Suspense fallback={<PageShell homeHeader><div className="feed-loader" aria-label="Loading feed"><span/></div></PageShell>}>
    <HomeContent/>
  </Suspense>;
}
