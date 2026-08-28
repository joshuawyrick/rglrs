import { notFound } from "next/navigation";
import { Heart, MoreHorizontal, Send } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { MobileHeader } from "@/components/mobile-header";
import { people, posts } from "@/lib/demo-data";

export default async function PostDetail({params}:{params:Promise<{id:string}>}) {
  const {id}=await params; const post=posts.find(p=>p.id===id); if(!post) notFound();
  return <PageShell>
    <MobileHeader title="" backHref="/" right={<button className="screen-icon-btn"><MoreHorizontal size={17}/></button>}/>
    <div className="row gap10" style={{padding:"2px 0 9px"}}><img className="avatar" src={post.author.avatar} width={32} height={32} alt=""/><div><div className="post-name">{post.author.name}</div><div className="post-meta">{post.time} · {post.audience}</div></div></div>
    <div className="post-caption" style={{padding:"0 0 9px"}}>{post.caption}</div>
    <div className="post-image-wrap" style={{margin:"0 -12px"}}><img className="post-image" src={post.image} alt=""/><span className="post-counter">{post.carousel}</span></div>
    <div className="post-actions" style={{paddingLeft:0,paddingRight:0}}><span className="post-action hearted"><Heart size={18} fill="currentColor"/>24</span><span className="post-action">6 comments</span><div style={{flex:1}}/><Send size={17}/></div>
    <div className="post-liked" style={{paddingLeft:0,paddingRight:0}}>Liked by Sarah, Jess and 22 others</div>
    <div className="comment-row"><img className="avatar" src={people.sarah.avatar} width={31} height={31} alt=""/><div><div className="comment-text"><strong>Sarah Johnson</strong><br/>Looks amazing! 🔥</div><div className="comment-reply">1h · Reply</div></div><Heart size={13} color="var(--danger)"/></div>
    <div className="comment-compose"><input className="input" placeholder="Add a comment…"/><button className="screen-icon-btn"><Send size={15}/></button></div>
  </PageShell>;
}
