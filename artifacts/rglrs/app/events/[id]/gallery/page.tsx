import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { MobileHeader } from "@/components/mobile-header";
import { getEvent, getEventPosts } from "@/lib/event-data";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export default async function EventGallery({params}:{params:Promise<{id:string}>}) {
  const {id}=await params; const supabase=await getSupabaseServerClient(); if(!supabase) redirect("/login");
  const {data:{user}}=await supabase.auth.getUser(); if(!user) redirect("/login");
  let event; let posts;
  try {[event,posts]=await Promise.all([getEvent(supabase,user.id,id),getEventPosts(supabase,id,user.id)]);}
  catch {return <PageShell><MobileHeader title="Gallery" backHref={`/events/${id}`}/><div className="empty-state"><strong>Gallery unavailable</strong><span>Please try again.</span></div></PageShell>;}
  if(!event) notFound();
  const media=posts.flatMap((post)=>post.media.map((asset)=>({...asset,postId:post.id})));
  return <PageShell>
    <MobileHeader title={event.title} backHref={`/events/${event.id}`}/>
    <div className="feed-tabs"><span className="pill active">All</span><span className="pill">Photos</span><span className="pill">Videos</span></div>
    {!media.length?<div className="empty-state"><strong>No photos or videos</strong><span>Media shared to this event will appear here.</span></div>:null}
    <div className="gallery-grid">{media.map((asset)=><Link href={`/post/${asset.postId}`} key={asset.id}>{asset.mediaType==="video"?<video src={asset.url} muted/>:<img src={asset.url} alt="Event media"/>}</Link>)}</div>
  </PageShell>;
}