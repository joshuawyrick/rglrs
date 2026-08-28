"use client";

import Link from "next/link";
import { useState } from "react";
import { Bookmark, Heart, MessageCircle, MoreHorizontal, Plus, Send } from "lucide-react";
import { posts, stories } from "@/lib/demo-data";

export function StoriesRail() {
  return (
    <div className="stories">
      <div className="story">
        <div className="story-avatar" style={{background:"transparent"}}><div className="story-add"><Plus size={17}/></div></div>
        <div className="story-name">Your Story</div>
      </div>
      {stories.map((s) => (
        <div className="story" key={s.name}>
          <div className="story-avatar"><img src={s.image} alt=""/></div>
          <div className="story-name">{s.name}</div>
        </div>
      ))}
    </div>
  );
}

export function FeedPost({post}:{post:(typeof posts)[number]}) {
  const [liked,setLiked] = useState(false);
  const [saved,setSaved] = useState(false);
  return (
    <article className="post card">
      <div className="post-head row space">
        <div className="row gap10">
          <img className="avatar" src={post.author.avatar} width={32} height={32} alt=""/>
          <div>
            <div className="post-name">{post.author.name}</div>
            <div className="post-meta">{post.time} · {post.audience}</div>
          </div>
        </div>
        <button className="screen-icon-btn" style={{width:32,height:32}} aria-label="Post options"><MoreHorizontal size={17}/></button>
      </div>
      <Link href={`/post/${post.id}`} className="post-image-wrap">
        <img className="post-image" src={post.image} alt="Shared moment"/>
        {post.carousel ? <span className="post-counter">{post.carousel}</span> : null}
      </Link>
      <div className="post-actions">
        <button className={`post-action ${liked?"hearted":""}`} onClick={()=>setLiked(v=>!v)} aria-label="Like">
          <Heart size={18} fill={liked?"currentColor":"none"}/>{post.likes+(liked?1:0)}
        </button>
        <Link className="post-action" href={`/post/${post.id}`}><MessageCircle size={18}/>{post.comments}</Link>
        <button className="post-action" aria-label="Send"><Send size={17}/></button>
        <div style={{flex:1}}/>
        <button className="post-action" onClick={()=>setSaved(v=>!v)} aria-label="Save"><Bookmark size={17} fill={saved?"currentColor":"none"}/></button>
      </div>
      <div className="post-liked">Liked by Sarah, Jess and 22 others</div>
      <div className="post-caption"><strong>{post.author.name.split(" ")[0]}</strong>{post.caption}</div>
    </article>
  );
}
