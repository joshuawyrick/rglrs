"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bookmark, ChevronLeft, ChevronRight, Download, Heart, MapPin, MessageCircle, MoreHorizontal, Plus, Repeat2, Send, Trash2, UserMinus, UsersRound } from "lucide-react";
import { EventSharingDialog } from "@/components/post-options-dialogs";
import {
  fetchFeedPage,
  getCurrentUserId,
  isSupabaseAvailable,
  type FeedPostData,
} from "@/lib/post-data";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type StoryProfile = {
  display_name: string | null;
  username: string | null;
  avatar_upload_id: string | null;
};

export function StoriesRail() {
  const [profile, setProfile] = useState<StoryProfile | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      if (!isSupabaseAvailable()) return;
      const userId = await getCurrentUserId();
      const supabase = getSupabaseBrowserClient();
      if (!userId || !supabase) return;
      const { data } = await supabase
        .from("profiles")
        .select("display_name,username,avatar_upload_id")
        .eq("id", userId)
        .maybeSingle();
      if (active) setProfile(data as StoryProfile | null);
    })();
    return () => { active = false; };
  }, []);

  const label = profile?.display_name?.trim() || profile?.username?.trim() || "Your Profile";
  const avatarUrl = profile?.avatar_upload_id ? `/private-media/avatar/${profile.avatar_upload_id}` : null;

  return (
    <div className="stories">
      <Link className="story" href="/profile" aria-label={`Open ${label}`}>
        <div className="story-avatar" style={avatarUrl ? undefined : { background: "transparent" }}>
          {avatarUrl
            ? <img src={avatarUrl} alt="" />
            : <div className="story-add"><Plus size={17} /></div>}
        </div>
        <div className="story-name">{label}</div>
      </Link>
    </div>
  );
}

export function FeedPost({
  post,
  userId,
  onSaveChange,
  onDeleted,
}: {
  post: FeedPostData;
  userId?: string | null;
  onSaveChange?: (saved: boolean) => void;
  onDeleted?: () => void;
}) {
  const router = useRouter();
  const [liked, setLiked] = useState(post.liked);
  const [saved, setSaved] = useState(post.saved);
  const [likes, setLikes] = useState(post.likes);
  const [savingReaction, setSavingReaction] = useState(false);
  const [activeMedia, setActiveMedia] = useState(0);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [busyOption, setBusyOption] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [downloadsAllowed, setDownloadsAllowed] = useState(post.allowDownloads);
  const [eventId, setEventId] = useState(post.eventId);
  const [sharingOpen, setSharingOpen] = useState(false);
  const supabase = isSupabaseAvailable();
  const mediaItems = post.media?.length
    ? post.media
    : post.image && post.mediaType
      ? [{ id: post.id, url: post.image, mediaType: post.mediaType }]
      : [];
  const mediaRail = useRef<HTMLDivElement>(null);
  const moveMedia = (next: number) => {
    const index = Math.max(0, Math.min(mediaItems.length - 1, next));
    mediaRail.current?.scrollTo({ left: index * mediaRail.current.clientWidth, behavior: "smooth" });
    setActiveMedia(index);
  };

  const sharePost = async () => {
    const url = `${window.location.origin}/post/${post.id}`;
    try {
      if (navigator.share) {
        try {
          await navigator.share({ title: `${post.author.name} on RGLRS`, text: post.caption || "View this post on RGLRS", url });
          setFeedback("Post shared.");
          return;
        } catch (shareError) {
          if (shareError instanceof DOMException && shareError.name === "AbortError") return;
        }
      }
      await navigator.clipboard.writeText(url);
      setFeedback("Link copied.");
    } catch {
      setFeedback("Couldn’t share this post. Please try again.");
    }
  };

  const deletePost = async () => {
    if (!userId || post.authorId !== userId || busyOption || !window.confirm("Delete this post? This can’t be undone.")) return;
    const client = (await import("@/lib/supabase/client")).getSupabaseBrowserClient();
    if (!client) {
      setFeedback("Post deletion is unavailable.");
      return;
    }
    setBusyOption(true);
    const { data, error } = await client.from("posts").delete().eq("id", post.id).eq("author_id", userId).select("id").maybeSingle();
    setBusyOption(false);
    if (error || !data) {
      setFeedback(error?.message || "This post is no longer available.");
      return;
    }
    setOptionsOpen(false);
    onDeleted?.();
  };

  const toggleDownloads = async () => {
    if (!userId || post.authorId !== userId || busyOption) return;
    const client = getSupabaseBrowserClient();
    if (!client) return setFeedback("Download controls are unavailable.");
    const next = !downloadsAllowed;
    setBusyOption(true);
    const { error } = await client.rpc("set_post_downloads_secure", {
      p_post: post.id,
      p_allow_downloads: next,
    });
    setBusyOption(false);
    if (error) return setFeedback("Could not update download permission.");
    setDownloadsAllowed(next);
    setFeedback(next ? "Downloads are now allowed." : "Downloads are now disabled.");
  };

  const unshareFromEvent = async () => {
    if (!userId || post.authorId !== userId || !eventId || busyOption || !window.confirm("Remove this post from the event? The post will remain private in your account.")) return;
    const client = getSupabaseBrowserClient();
    if (!client) return setFeedback("Event sharing controls are unavailable.");
    setBusyOption(true);
    const { error } = await client.rpc("unshare_event_post_secure", { p_post: post.id });
    setBusyOption(false);
    if (error) return setFeedback("Could not remove this post from the event.");
    setEventId(null);
    setOptionsOpen(false);
    setFeedback("Post removed from the event and kept private.");
    router.refresh();
  };

  const toggleLike = async () => {
    if (!supabase || !userId || savingReaction) return;
    const nextLiked = !liked;
    setLiked(nextLiked);
    setLikes((count) => count + (nextLiked ? 1 : -1));
    setSavingReaction(true);
    const client = (await import("@/lib/supabase/client")).getSupabaseBrowserClient();
    if (!client) return;
    const result = nextLiked
      ? await client.from("reactions").upsert(
          { post_id: post.id, user_id: userId, reaction: "like" },
          { onConflict: "post_id,user_id" },
        )
      : await client.from("reactions").delete().eq("post_id", post.id).eq("user_id", userId);
    setSavingReaction(false);
    if (result.error) {
      setLiked(!nextLiked);
      setLikes((count) => count + (nextLiked ? -1 : 1));
    }
  };

  const toggleSave = async () => {
    if (!supabase || !userId || savingReaction) return;
    const nextSaved = !saved;
    setSaved(nextSaved);
    setSavingReaction(true);
    const client = (await import("@/lib/supabase/client")).getSupabaseBrowserClient();
    if (!client) return;
    const result = nextSaved
      ? await client.from("saves").upsert(
          { post_id: post.id, user_id: userId },
          { onConflict: "post_id,user_id" },
        )
      : await client.from("saves").delete().eq("post_id", post.id).eq("user_id", userId);
    setSavingReaction(false);
    if (result.error) {
      setSaved(!nextSaved);
    } else {
      onSaveChange?.(nextSaved);
    }
  };
  const reshare = async () => {
    const client=getSupabaseBrowserClient();
    if (!client || !userId || busyOption) return;
    setBusyOption(true);
    const {error}=await client.rpc("reshare_post_secure",{p_post:post.id});
    setBusyOption(false);
    setFeedback(error ? (error.message || "This post cannot be reshared.") : "Post reshared to your friends.");
    if (!error) router.refresh();
  };

  const canDownload = post.authorId === userId || downloadsAllowed;

  return (
    <>
    <article className="post card">
      <div className="post-head row space" style={{position:"relative"}}>
        <div className="row gap10">
          <img className="avatar" src={post.author.avatar} width={32} height={32} alt="" />
          <div>
            <div className="post-name">{post.author.name}</div>
            <div className="post-meta">{post.time} · {post.audience}</div>
            {post.locationName ? <div className="post-location"><MapPin size={9} /><span>{post.locationName}{post.locationAddress ? ` · ${post.locationAddress}` : ""}</span></div> : null}
          </div>
        </div>
        <button className="screen-icon-btn" style={{ width: 32, height: 32 }} aria-label="Post options" aria-expanded={optionsOpen} onClick={() => setOptionsOpen((open) => !open)}>
          <MoreHorizontal size={17} />
        </button>
        {optionsOpen ? <div className="card card-pad stack gap8" style={{position:"absolute",right:0,top:34,zIndex:20,minWidth:175}}>
          {post.authorId === userId ? (
            <>
              {eventId?<button className="text-btn" type="button" onClick={()=>{setOptionsOpen(false);setSharingOpen(true);}} disabled={busyOption}><UsersRound size={14}/>Edit my sharing</button>:null}
              {eventId?<button className="text-btn" type="button" onClick={unshareFromEvent} disabled={busyOption}><UserMinus size={14}/>Remove from event</button>:null}
              {mediaItems.length?<button className="text-btn" type="button" onClick={toggleDownloads} disabled={busyOption}><Download size={14}/>{downloadsAllowed?"Disable downloads":"Allow downloads"}</button>:null}
              <button className="text-btn" type="button" onClick={deletePost} disabled={busyOption}><Trash2 size={14}/>{busyOption ? "Updating…" : "Delete post"}</button>
            </>
          ) : (
            <>
              <button className="text-btn" type="button" disabled>Report post · Unavailable</button>
              <span className="form-hint">Post reporting isn’t available yet.</span>
            </>
          )}
        </div> : null}
      </div>
      <div className="post-image-wrap">
        {mediaItems.length ? (
          <div
            ref={mediaRail}
            className="post-media-rail"
            onScroll={(event) => setActiveMedia(Math.round(event.currentTarget.scrollLeft / Math.max(1, event.currentTarget.clientWidth)))}
          >
            {mediaItems.map((media) => (
              <div className="post-media-slide" key={media.id}>
                {media.mediaType === "video" ? (
                  <video className="post-image" src={media.url} controls playsInline preload="metadata" />
                ) : (
                  <button type="button" className="post-media-open" onClick={() => window.location.assign(`/post/${post.id}`)} aria-label={`Open post by ${post.author.name}`}>
                    <img className="post-image" src={media.url} alt="Shared moment" />
                  </button>
                )}
                {canDownload?<a className="post-media-download" href={`/private-media/download/${media.id}`} download aria-label={`Download ${media.mediaType}`} onClick={(event)=>event.stopPropagation()}><Download size={15}/></a>:null}
              </div>
            ))}
          </div>
        ) : (
          <div className="post-image post-placeholder" aria-label="Post without media">RGLRS</div>
        )}
        {mediaItems.length > 1 ? (
          <>
            <span className="post-counter">{activeMedia + 1}/{mediaItems.length}</span>
            <button className="post-carousel-btn previous" type="button" onClick={() => moveMedia(activeMedia - 1)} disabled={activeMedia === 0} aria-label="Previous media"><ChevronLeft size={16} /></button>
            <button className="post-carousel-btn next" type="button" onClick={() => moveMedia(activeMedia + 1)} disabled={activeMedia === mediaItems.length - 1} aria-label="Next media"><ChevronRight size={16} /></button>
          </>
        ) : null}
      </div>
      <div className="post-actions">
        <button
          className={`post-action ${liked ? "hearted" : ""}`}
          onClick={toggleLike}
          aria-label={liked ? "Unlike" : "Like"}
          disabled={!userId}
        >
          <Heart size={18} fill={liked ? "currentColor" : "none"} />{likes}
        </button>
        <Link className="post-action" href={`/post/${post.id}`}>
          <MessageCircle size={18} />{post.comments}
        </Link>
        <button className="post-action" aria-label="Share post" onClick={sharePost}><Send size={17} /></button>
        {post.authorId!==userId?<button className="post-action" aria-label="Reshare inside RGLRS" onClick={reshare} disabled={!userId||busyOption}><Repeat2 size={17}/></button>:null}
        <div style={{ flex: 1 }} />
        <button
          className={`post-action ${saved ? "teal" : ""}`}
          onClick={toggleSave}
          aria-label={saved ? "Remove saved post" : "Save post"}
          data-testid={`button-save-post-${post.id}`}
          disabled={!userId}
        >
          <Bookmark size={17} fill={saved ? "currentColor" : "none"} />
        </button>
      </div>
      <div className="post-liked">{likes ? `Liked by ${likes} ${likes === 1 ? "person" : "people"}` : "Be the first to like this"}</div>
      <div className="post-caption">
        {post.author.name ? <strong>{post.author.name.split(" ")[0]}</strong> : null}{post.caption}
      </div>
      {post.sharedFromPostId ? <Link className="form-hint" href={`/post/${post.sharedFromPostId}`}>View the original shared post</Link> : null}
      {feedback ? <div className={feedback.startsWith("Couldn’t") ? "feed-error" : "form-hint"} role="status">{feedback}</div> : null}
    </article>
    <EventSharingDialog open={sharingOpen} eventId={eventId} onClose={()=>setSharingOpen(false)} onSaved={()=>setFeedback("Your event sharing choices were saved.")}/>
    </>
  );
}

export function InfiniteFeed({
  kind = "all",
  author = "all",
  captionsOnly = false,
}: {
  kind?: "all" | "events" | "photos" | "videos";
  author?: "all" | "me";
  captionsOnly?: boolean;
}) {
  const [items, setItems] = useState<FeedPostData[] | null>(null);
  const [cursor, setCursor] = useState<string | undefined>();
  const [hasMore, setHasMore] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const loadingMore = useRef(false);
  const refreshGeneration = useRef(0);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const visibleItems = useMemo(() => (items || []).filter((post) => {
    if (author === "me" && post.authorId !== userId) return false;
    if (captionsOnly && !post.caption.trim()) return false;
    if (kind === "events" && post.audience !== "Events" && post.audience !== "Event") return false;
    if (kind === "photos" && !post.media.some((media) => media.mediaType === "image")) return false;
    if (kind === "videos" && !post.media.some((media) => media.mediaType === "video")) return false;
    return true;
  }), [items, kind, author, captionsOnly, userId]);

  const loadPage = useCallback(async (nextCursor: string) => {
    if (loadingMore.current) return;
    const generation = refreshGeneration.current;
    loadingMore.current = true;
    setLoading(true);
    try {
      const result = await fetchFeedPage(nextCursor);
      if (generation !== refreshGeneration.current) return;
      setItems((current) => [...(current || []), ...result.posts]);
      setCursor(result.nextCursor || undefined);
      setHasMore(result.hasMore);
      setError(null);
    } catch (loadError) {
      if (generation !== refreshGeneration.current) return;
      setError(loadError instanceof Error ? loadError.message : "Could not load your feed.");
    } finally {
      loadingMore.current = false;
      if (generation === refreshGeneration.current) setLoading(false);
    }
  }, []);

  const refreshFeed = useCallback(async () => {
    const generation = ++refreshGeneration.current;
    setLoading(true);
    try {
      const result = await fetchFeedPage();
      if (generation !== refreshGeneration.current) return;
      setItems(result.posts);
      setCursor(result.nextCursor || undefined);
      setHasMore(result.hasMore);
      setError(null);
    } catch (loadError) {
      if (generation !== refreshGeneration.current) return;
      setError(loadError instanceof Error ? loadError.message : "Could not load your feed.");
    } finally {
      if (generation === refreshGeneration.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      const configured = isSupabaseAvailable();
      if (!configured) {
        setError("Connect Supabase to see your real private feed.");
        setHasMore(false);
        setLoading(false);
        return;
      }
      const id = await getCurrentUserId();
      if (!active) return;
      setUserId(id);
      if (!id) {
        setError("Sign in to see your private feed.");
        setLoading(false);
        return;
      }
      await refreshFeed();
    })();
    return () => { active = false; };
  }, [refreshFeed]);

  useEffect(() => {
    const refresh = () => void refreshFeed();
    const storageRefresh = (event: StorageEvent) => {
      if (event.key === "rglrs:friendship-changed") refresh();
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 10_000);
    const supabase = getSupabaseBrowserClient();
    const relationshipChannel = userId && supabase
      ? supabase
          .channel(`feed-invalidation:${userId}`)
          .on(
            "postgres_changes",
            { event: "INSERT", schema: "public", table: "feed_invalidations", filter: `user_id=eq.${userId}` },
            refresh,
          )
          .subscribe()
      : null;
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    window.addEventListener("rglrs:friendship-changed", refresh);
    window.addEventListener("storage", storageRefresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      if (relationshipChannel && supabase) void supabase.removeChannel(relationshipChannel);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      window.removeEventListener("rglrs:friendship-changed", refresh);
      window.removeEventListener("storage", storageRefresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refreshFeed, userId]);

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || !hasMore || !cursor) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) void loadPage(cursor);
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [cursor, hasMore, loadPage]);

  if (loading && !items) {
    return <div className="feed-loader" aria-label="Loading feed"><span /></div>;
  }
  if (error && !items) {
    return <div className="empty-state card"><strong>{error}</strong><div className="row gap8"><button className="secondary-btn" type="button" onClick={() => void refreshFeed()}>Try again</button><Link className="text-btn" href="/login">Sign in</Link></div></div>;
  }
  if (!items?.length) {
    return <div className="empty-state card"><strong>Your private feed is quiet.</strong><span>Share the first moment with your regulars.</span><Link className="primary-btn" href="/create">Create a post</Link></div>;
  }

  return (
    <div className="infinite-feed">
      {visibleItems.map((post) => <FeedPost key={post.id} post={post} userId={userId} onDeleted={() => setItems((current) => current?.filter((item) => item.id !== post.id) || [])}/>)}
      {!visibleItems.length && !hasMore ? <div className="empty-state card"><strong>No posts match these filters.</strong><span>Try another feed type or clear your feed filters.</span></div> : null}
      {error ? <div className="empty-state card"><strong>Couldn’t load more posts.</strong><span>{error}</span><button className="secondary-btn" type="button" onClick={() => void (cursor ? loadPage(cursor) : refreshFeed())}>Try again</button></div> : null}
      {hasMore ? (!error ? (
        <div ref={loadMoreRef} className="feed-loader" aria-label="Loading more posts"><span /></div>
      ) : null) : visibleItems.length ? <div className="form-hint" style={{textAlign:"center",padding:"14px 0"}}>You’re all caught up.</div> : null}
    </div>
  );
}