import { Bookmark } from "lucide-react";
import { redirect } from "next/navigation";
import { MobileHeader } from "@/components/mobile-header";
import { PageShell } from "@/components/page-shell";
import { SavedPosts } from "@/components/saved-posts";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export default async function SavedPage() {
  const supabase = await getSupabaseServerClient();
  if (!supabase) redirect("/login");

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <PageShell>
      <MobileHeader title="Saved" backHref="/profile" />
      <div className="page-header saved-page-header">
        <div className="saved-page-icon"><Bookmark size={17} fill="currentColor" /></div>
        <div>
          <h1>Saved posts</h1>
          <p>Keep saved moments organized, just for you.</p>
        </div>
      </div>
      <SavedPosts userId={user.id} />
    </PageShell>
  );
}