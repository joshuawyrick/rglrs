import { notFound, redirect } from "next/navigation";
import { MobileHeader } from "@/components/mobile-header";
import { PageShell } from "@/components/page-shell";
import { SavedCollection } from "@/components/saved-posts";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export default async function SavedCollectionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await getSupabaseServerClient();
  if (!supabase) redirect("/login");

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: collection } = await supabase
    .from("saved_collections")
    .select("id,name,created_at")
    .eq("id", id)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!collection) notFound();

  return (
    <PageShell>
      <MobileHeader title={collection.name} backHref="/saved" />
      <SavedCollection
        collection={{
          id: collection.id,
          name: collection.name,
          createdAt: collection.created_at,
          postCount: 0,
        }}
      />
    </PageShell>
  );
}