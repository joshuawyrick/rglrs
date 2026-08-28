import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export async function GET(_:Request,{params}:{params:Promise<{token:string}>}) {
  const {token}=await params;
  if(!/^[A-Za-z0-9_-]{40,100}$/.test(token))return NextResponse.json({error:"This invite is invalid."},{status:404});
  const supabase=getSupabaseServiceClient();
  if(!supabase)return NextResponse.json({error:"Invite preview is unavailable."},{status:503});
  const hash=createHash("sha256").update(token).digest("hex");
  const {data:invite,error}=await supabase.from("invites").select("id,event_id,mode,expires_at,max_uses,use_count,revoked_at,pin_hash,created_by").eq("token_hash",hash).maybeSingle();
  if(error||!invite||invite.revoked_at||(invite.expires_at&&new Date(invite.expires_at)<=new Date())||(invite.max_uses!=null&&invite.use_count>=invite.max_uses))
    return NextResponse.json({error:"This invite is invalid, expired, or no longer available."},{status:404});
  const [{data:event},{data:creator},{count:memberCount}]=await Promise.all([
    supabase.from("events").select("id,title,starts_at,ends_at,place_name,place_address").eq("id",invite.event_id).maybeSingle(),
    supabase.from("profiles").select("display_name").eq("id",invite.created_by).maybeSingle(),
    supabase.from("event_members").select("*",{count:"exact",head:true}).eq("event_id",invite.event_id),
  ]);
  if(!event)return NextResponse.json({error:"This event is unavailable."},{status:404});
  return NextResponse.json({event:{id:event.id,title:event.title,startsAt:event.starts_at,endsAt:event.ends_at,placeName:event.place_name,placeAddress:event.place_address},mode:invite.mode,requiresPin:Boolean(invite.pin_hash),inviter:creator?.display_name||"an event member",memberCount:memberCount||0});
}