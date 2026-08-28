import Link from "next/link";
import { notFound } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { MobileHeader } from "@/components/mobile-header";
import { events, galleryImages } from "@/lib/demo-data";

export default async function EventGallery({params}:{params:Promise<{id:string}>}) {
  const {id}=await params; const e=events.find(x=>x.id===id); if(!e) notFound();
  return <PageShell>
    <MobileHeader title={e.title} backHref={`/events/${e.id}`}/>
    <div className="feed-tabs"><span className="pill">All</span><span className="pill active">Photos</span><span className="pill">Videos</span></div>
    <div className="gallery-grid">{galleryImages.map((src,i)=><Link href="/post/p1" key={`${src}-${i}`}><img src={src} alt={`Event photo ${i+1}`}/></Link>)}</div>
  </PageShell>;
}
