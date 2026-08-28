import Link from "next/link";
import { ChevronRight, MapPin, Tag, UsersRound, X } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { galleryImages } from "@/lib/demo-data";
import { MobileHeader } from "@/components/mobile-header";

export default async function CreatePage({searchParams}:{searchParams:Promise<{audience?:string}>}) {
  const query=await searchParams;
  const audience=query.audience || "Family + Besties";
  return (
    <PageShell>
      <MobileHeader title="New Post" backHref="/" right={<Link className="screen-icon-btn" href="/" aria-label="Close"><X size={18}/></Link>}/>
      <div className="composer">
        <div className="composer-media-row">{galleryImages.slice(0,3).map((src)=><img key={src} src={src} alt="Selected media"/>)}</div>
        <textarea className="input composer-textarea" placeholder="Add a caption…" maxLength={220}/>
        <div style={{textAlign:"right",fontSize:7.5,color:"var(--muted-2)",marginTop:-8,marginBottom:8}}>0/220</div>
        <div className="composer-option"><div className="left"><MapPin size={16}/><span>Add location</span></div><ChevronRight size={16} color="var(--muted-2)"/></div>
        <div className="composer-option"><div className="left"><Tag size={16}/><span>Tag people</span></div><ChevronRight size={16} color="var(--muted-2)"/></div>
        <Link href="/create/audience" className="composer-option">
          <div className="left"><UsersRound size={16}/><div><div>Who can see this?</div><div style={{color:"var(--teal)",fontSize:8,marginTop:3}}>{audience}</div></div></div>
          <ChevronRight size={16} color="var(--muted-2)"/>
        </Link>
        <button className="primary-btn" style={{width:"100%",marginTop:14}}>Share</button>
      </div>
    </PageShell>
  );
}
