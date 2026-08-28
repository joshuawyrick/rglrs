import { notFound } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { ChatClient } from "@/components/chat-client";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await getSupabaseServerClient();
  if (!supabase) notFound();
  const { data: conversation, error } = await supabase.from("conversations").select("id").eq("id", id).maybeSingle();
  if (error || !conversation) notFound();
  return <PageShell><ChatClient conversationId={id}/></PageShell>;
}