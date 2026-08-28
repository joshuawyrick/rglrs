import Link from "next/link";
import { Settings } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { galleryImages, people } from "@/lib/demo-data";

export default function ProfilePage() {
  const p=people.josh;
  return <PageShell>
    <div className="row space" style={{minHeight:48}}><span/><Link className="screen-icon-btn" href="/settings"><Settings size={17}/></Link></div>
    <div className="profile-top">
      <div className="avatar-ring" style={{position:"relative"}}><img className="avatar" src={p.avatar} width={82} height={82} alt=""/><span className="online-dot"/></div>
      <div className="profile-name">{p.name}</div><div className="profile-handle">{p.username}</div><div className="profile-bio">Living life with my people.</div>
      <div className="profile-stats"><div className="profile-stat"><strong>128</strong><span>Posts</span></div><div className="profile-stat"><strong>24</strong><span>Events</span></div><div className="profile-stat"><strong>312</strong><span>Friends</span></div></div>
    </div>
    <div className="profile-tabs"><span className="profile-tab active">Posts</span><span className="profile-tab">Events</span><span className="profile-tab">Tagged</span></div>
    <div className="photo-grid">{galleryImages.slice(0,9).map((src,i)=><Link href="/post/p1" key={`${src}-${i}`}><img src={src} alt=""/></Link>)}</div>
  </PageShell>;
}
