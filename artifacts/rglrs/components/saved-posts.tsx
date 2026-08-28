"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  BookmarkPlus,
  Check,
  Folder,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { FeedPost } from "@/components/feed";
import {
  addPostToSavedCollection,
  createSavedCollection,
  deleteSavedCollection,
  fetchSavedCollectionMemberships,
  fetchSavedCollectionPosts,
  fetchSavedCollections,
  fetchSavedPosts,
  removePostFromSavedCollection,
  renameSavedCollection,
  type FeedPostData,
  type SavedCollection as SavedCollectionData,
} from "@/lib/post-data";

type CollectionMemberships = Record<string, string[]>;

function CollectionPicker({
  postId,
  collections,
  selectedCollectionIds,
  onMembershipChange,
}: {
  postId: string;
  collections: SavedCollectionData[];
  selectedCollectionIds: string[];
  onMembershipChange: (collectionId: string, selected: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggleMembership = async (collectionId: string) => {
    if (pendingId) return;
    const selected = selectedCollectionIds.includes(collectionId);
    setPendingId(collectionId);
    setError(null);
    try {
      if (selected) {
        await removePostFromSavedCollection(collectionId, postId);
      } else {
        await addPostToSavedCollection(collectionId, postId);
      }
      onMembershipChange(collectionId, !selected);
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "Could not update this collection.");
    } finally {
      setPendingId(null);
    }
  };

  if (!collections.length) return null;

  return (
    <div className="collection-picker">
      <button
        className="secondary-btn collection-picker-trigger"
        type="button"
        aria-expanded={open}
        aria-controls={`collection-picker-${postId}`}
        onClick={() => {
          setOpen((current) => !current);
          setError(null);
        }}
        data-testid={`button-collections-${postId}`}
      >
        <BookmarkPlus size={14} />
        {selectedCollectionIds.length ? `${selectedCollectionIds.length} collection${selectedCollectionIds.length === 1 ? "" : "s"}` : "Add to collection"}
      </button>
      {open ? (
        <div className="collection-picker-menu" id={`collection-picker-${postId}`}>
          <div className="collection-picker-title">
            <span>Add to collections</span>
            <button className="screen-icon-btn" type="button" aria-label="Close collection picker" onClick={() => setOpen(false)}>
              <X size={14} />
            </button>
          </div>
          {collections.map((collection) => {
            const selected = selectedCollectionIds.includes(collection.id);
            const pending = pendingId === collection.id;
            return (
              <button
                className={`collection-option ${selected ? "selected" : ""}`}
                type="button"
                key={collection.id}
                onClick={() => void toggleMembership(collection.id)}
                disabled={Boolean(pendingId)}
              >
                <span>{collection.name}</span>
                <span className="collection-check">{pending ? "…" : selected ? <Check size={13} /> : null}</span>
              </button>
            );
          })}
          {error ? <p className="form-message error-message">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function CollectionsSection({
  collections,
  onCreated,
}: {
  collections: SavedCollectionData[];
  onCreated: (collection: SavedCollectionData) => void;
}) {
  const [name, setName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsCreating(true);
    setError(null);
    try {
      const collection = await createSavedCollection(name);
      onCreated(collection);
      setName("");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not create collection.");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <section className="saved-collections" aria-labelledby="saved-collections-heading">
      <div className="row space saved-section-heading">
        <div>
          <h2 id="saved-collections-heading">Collections</h2>
          <p>Private folders for the moments you want close.</p>
        </div>
        <Folder size={17} className="teal" />
      </div>
      <form className="saved-collection-form" onSubmit={submit}>
        <label className="sr-only" htmlFor="new-collection-name">Collection name</label>
        <input
          id="new-collection-name"
          className="input"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="New collection name"
          maxLength={80}
          required
          disabled={isCreating}
        />
        <button className="primary-btn" type="submit" disabled={isCreating}>
          <Plus size={14} />
          {isCreating ? "Creating…" : "Create"}
        </button>
      </form>
      {error ? <p className="form-message error-message saved-form-message">{error}</p> : null}
      {collections.length ? (
        <div className="saved-collection-grid">
          {collections.map((collection) => (
            <Link className="saved-collection-card" href={`/saved/${collection.id}`} key={collection.id}>
              <span className="saved-collection-icon"><Folder size={17} /></span>
              <span className="saved-collection-copy">
                <strong>{collection.name}</strong>
                <span>{collection.postCount} {collection.postCount === 1 ? "post" : "posts"}</span>
              </span>
              <MoreHorizontal size={15} className="muted" />
            </Link>
          ))}
        </div>
      ) : (
        <div className="saved-collection-empty">Create a collection, then add saved posts to it.</div>
      )}
    </section>
  );
}

export function SavedPosts({ userId }: { userId: string }) {
  const [posts, setPosts] = useState<FeedPostData[] | null>(null);
  const [collections, setCollections] = useState<SavedCollectionData[] | null>(null);
  const [memberships, setMemberships] = useState<CollectionMemberships>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([fetchSavedPosts(), fetchSavedCollections()])
      .then(async ([savedPosts, savedCollections]) => {
        const savedMemberships = await fetchSavedCollectionMemberships(savedPosts.map((post) => post.id));
        if (active) {
          setPosts(savedPosts);
          setCollections(savedCollections);
          setMemberships(savedMemberships);
          setError(null);
        }
      })
      .catch((loadError) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Could not load your saved posts.");
        }
      });
    return () => {
      active = false;
    };
  }, [userId]);

  const handleSaveChange = useCallback((postId: string, saved: boolean) => {
    if (saved) return;
    const affectedCollections = memberships[postId] || [];
    setPosts((current) => current?.filter((post) => post.id !== postId) || []);
    setMemberships((current) => {
      const next = { ...current };
      delete next[postId];
      return next;
    });
    setCollections((current) => current?.map((collection) => affectedCollections.includes(collection.id)
      ? { ...collection, postCount: Math.max(0, collection.postCount - 1) }
      : collection) || null);
  }, [memberships]);

  const handleMembershipChange = useCallback((postId: string, collectionId: string, selected: boolean) => {
    setMemberships((current) => {
      const currentIds = current[postId] || [];
      const nextIds = selected ? [...new Set([...currentIds, collectionId])] : currentIds.filter((id) => id !== collectionId);
      return { ...current, [postId]: nextIds };
    });
    setCollections((current) => current?.map((collection) => collection.id === collectionId
      ? { ...collection, postCount: Math.max(0, collection.postCount + (selected ? 1 : -1)) }
      : collection) || null);
  }, []);

  if (!posts || !collections) {
    return error ? (
      <div className="empty-state card" role="alert">
        <strong>{error}</strong>
        <Link className="secondary-btn" href="/profile" data-testid="link-saved-error-profile">Back to profile</Link>
      </div>
    ) : <div className="feed-loader" aria-label="Loading saved posts"><span /></div>;
  }

  return (
    <>
      <CollectionsSection
        collections={collections}
        onCreated={(collection) => setCollections((current) => [...(current || []), collection])}
      />
      {!posts.length ? (
        <div className="empty-state card" data-testid="empty-saved-posts">
          <strong>No saved posts yet.</strong>
          <span>Bookmark a post when you want to come back to it.</span>
          <Link className="primary-btn" href="/" data-testid="link-saved-empty-feed">Browse your feed</Link>
        </div>
      ) : (
        <div className="infinite-feed" aria-label="Saved posts" data-testid="saved-posts-list">
          {posts.map((post) => (
            <div key={post.id} className="saved-post-item">
              <FeedPost
                post={post}
                userId={userId}
                onSaveChange={(saved) => handleSaveChange(post.id, saved)}
              />
              <CollectionPicker
                postId={post.id}
                collections={collections}
                selectedCollectionIds={memberships[post.id] || []}
                onMembershipChange={(collectionId, selected) => handleMembershipChange(post.id, collectionId, selected)}
              />
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export function SavedCollection({ collection: initialCollection }: { collection: SavedCollectionData }) {
  const [collection, setCollection] = useState(initialCollection);
  const [posts, setPosts] = useState<FeedPostData[] | null>(null);
  const [collections, setCollections] = useState<SavedCollectionData[] | null>(null);
  const [memberships, setMemberships] = useState<CollectionMemberships>({});
  const [isEditing, setIsEditing] = useState(false);
  const [draftName, setDraftName] = useState(initialCollection.name);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let active = true;
    void Promise.all([fetchSavedCollectionPosts(collection.id), fetchSavedCollections()])
      .then(async ([collectionPosts, allCollections]) => {
        const savedMemberships = await fetchSavedCollectionMemberships(collectionPosts.map((post) => post.id));
        if (active) {
          setPosts(collectionPosts);
          setCollections(allCollections);
          setMemberships(savedMemberships);
          setCollection((current) => ({ ...current, postCount: collectionPosts.length }));
        }
      })
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Could not load this collection.");
      });
    return () => {
      active = false;
    };
  }, [collection.id]);

  const saveName = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    setMessage(null);
    try {
      const nextName = draftName.trim();
      await renameSavedCollection(collection.id, nextName);
      setCollection((current) => ({ ...current, name: nextName }));
      setIsEditing(false);
      setMessage("Collection renamed.");
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : "Could not rename collection.");
    } finally {
      setIsSaving(false);
    }
  };

  const deleteCollection = async () => {
    if (!window.confirm(`Delete “${collection.name}”? Posts will stay saved.`)) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteSavedCollection(collection.id);
      window.location.assign("/saved");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete collection.");
      setDeleting(false);
    }
  };

  const handleMembershipChange = (postId: string, collectionId: string, selected: boolean) => {
    setMemberships((current) => {
      const currentIds = current[postId] || [];
      const nextIds = selected ? [...new Set([...currentIds, collectionId])] : currentIds.filter((id) => id !== collectionId);
      return { ...current, [postId]: nextIds };
    });
    if (collectionId === collection.id && !selected) {
      setPosts((current) => current?.filter((post) => post.id !== postId) || []);
      setCollection((current) => ({ ...current, postCount: Math.max(0, current.postCount - 1) }));
    }
  };

  if (error && !posts) {
    return (
      <div className="empty-state card" role="alert">
        <strong>{error}</strong>
        <Link className="secondary-btn" href="/saved">Back to saved</Link>
      </div>
    );
  }

  return (
    <div className="saved-collection-page">
      <div className="saved-collection-toolbar">
        {isEditing ? (
          <form className="saved-rename-form" onSubmit={saveName}>
            <label className="sr-only" htmlFor="collection-name">Collection name</label>
            <input id="collection-name" className="input" value={draftName} onChange={(event) => setDraftName(event.target.value)} maxLength={80} required disabled={isSaving} />
            <button className="primary-btn" type="submit" disabled={isSaving}>{isSaving ? "Saving…" : "Save"}</button>
            <button className="secondary-btn" type="button" onClick={() => { setDraftName(collection.name); setIsEditing(false); }} disabled={isSaving}>Cancel</button>
          </form>
        ) : (
          <div className="row space saved-collection-title-row">
            <div>
              <div className="eyebrow">Private collection</div>
              <h1>{collection.name}</h1>
              <p>{collection.postCount} {collection.postCount === 1 ? "post" : "posts"} · newest saved first</p>
            </div>
            <div className="row gap6">
              <button className="screen-icon-btn" type="button" aria-label="Rename collection" onClick={() => { setDraftName(collection.name); setIsEditing(true); }}>
                <Pencil size={15} />
              </button>
              <button className="screen-icon-btn collection-delete-btn" type="button" aria-label="Delete collection" onClick={() => void deleteCollection()} disabled={deleting}>
                <Trash2 size={15} />
              </button>
            </div>
          </div>
        )}
      </div>
      {message ? <p className="form-message success-message">{message}</p> : null}
      {error ? <p className="form-message error-message">{error}</p> : null}
      {!posts ? (
        <div className="feed-loader" aria-label="Loading collection"><span /></div>
      ) : !posts.length ? (
        <div className="empty-state card collection-empty">
          <Folder size={24} className="teal" />
          <strong>This collection is empty.</strong>
          <span>Add saved posts from your saved feed.</span>
          <Link className="primary-btn" href="/saved">Browse saved posts</Link>
        </div>
      ) : (
        <div className="infinite-feed" aria-label={`${collection.name} posts`} data-testid="saved-collection-posts">
          {posts.map((post) => (
            <div key={post.id} className="saved-post-item">
              <FeedPost post={post} userId={null} />
              <CollectionPicker
                postId={post.id}
                collections={collections || [collection]}
                selectedCollectionIds={memberships[post.id] || [collection.id]}
                onMembershipChange={(collectionId, selected) => handleMembershipChange(post.id, collectionId, selected)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}