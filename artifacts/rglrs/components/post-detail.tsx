"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { Send } from "lucide-react";
import { FeedPost } from "@/components/feed";
import { MobileHeader } from "@/components/mobile-header";
import { PageShell } from "@/components/page-shell";
import {
  addComment,
  fetchComments,
  fetchFeedPage,
  formatRelativeTime,
  getCurrentUserId,
  isSupabaseAvailable,
  type CommentData,
  type FeedPostData,
} from "@/lib/post-data";

export function PostDetail({ postId }: { postId: string }) {
  const [post, setPost] = useState<FeedPostData | null>(null);
  const [comments, setComments] = useState<CommentData[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isSupabaseAvailable()) {
      setError("Connect Supabase to view real private posts.");
      setLoading(false);
      return;
    }
    try {
      const id = await getCurrentUserId();
      setUserId(id);
      if (!id) throw new Error("Sign in to view this private post.");
      const [postResult, commentResult] = await Promise.all([
        fetchFeedPage(undefined, 1, postId),
        fetchComments(postId),
      ]);
      setPost(postResult.posts[0] || null);
      setComments(commentResult);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load this post.");
    } finally {
      setLoading(false);
    }
  }, [postId]);

  useEffect(() => { void load(); }, [load]);

  const submitComment = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await addComment(postId, body);
      setBody("");
      const nextComments = await fetchComments(postId);
      setComments(nextComments);
      setPost((current) => current ? { ...current, comments: nextComments.length } : current);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not add your comment.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PageShell>
      <MobileHeader title="" backHref="/" />
      {loading ? <div className="feed-loader" aria-label="Loading post"><span /></div> : null}
      {!loading && !post ? (
        <div className="empty-state card">
          <strong>{error || "This post is not available."}</strong>
          <span>It may be private, deleted, or outside your audience.</span>
          <Link href="/" className="secondary-btn">Back to feed</Link>
        </div>
      ) : null}
      {post ? (
        <>
          <FeedPost post={post} userId={userId} onDeleted={() => setPost(null)} />
          <section className="comments-section" aria-label="Comments">
            {comments.length ? comments.map((comment) => (
              <div className="comment-row" key={comment.id}>
                <img className="avatar" src={comment.author.avatar} width={31} height={31} alt="" />
                <div>
                  <div className="comment-text"><strong>{comment.author.name}</strong><br />{comment.body}</div>
                  <div className="comment-reply">{formatRelativeTime(comment.createdAt)} · Reply</div>
                </div>
              </div>
            )) : <div className="form-hint">No comments yet. Start the conversation.</div>}
            {isSupabaseAvailable() ? (
              <form className="comment-compose" onSubmit={submitComment}>
                <input className="input" placeholder="Add a comment…" value={body} onChange={(event) => setBody(event.target.value)} maxLength={5000} />
                <button className="screen-icon-btn" type="submit" disabled={submitting || !body.trim()} aria-label="Post comment"><Send size={15} /></button>
              </form>
            ) : null}
            {error && post ? <div className="form-error" role="alert">{error}</div> : null}
          </section>
        </>
      ) : null}
    </PageShell>
  );
}