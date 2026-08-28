import Link from "next/link";
import { SlidersHorizontal } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { FeedPost, StoriesRail } from "@/components/feed";
import { posts } from "@/lib/demo-data";

export default function HomePage() {
  return (
    <PageShell homeHeader>
      <StoriesRail/>
      <div className="row space" style={{marginBottom:4}}>
        <div className="feed-tabs" style={{padding:0}}>
          <Link href="/" className="pill active">All</Link>
          <Link href="/events" className="pill">Events</Link>
          <span className="pill">Photos</span>
          <span className="pill">Videos</span>
        </div>
        <button className="screen-icon-btn" style={{width:34,height:34}} aria-label="Filter"><SlidersHorizontal size={15}/></button>
      </div>
      {posts.map((post)=><FeedPost key={post.id} post={post}/>) }
    </PageShell>
  );
}
