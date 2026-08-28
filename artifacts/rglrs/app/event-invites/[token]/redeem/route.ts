import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export async function POST(request:NextRequest,{params}:{params:Promise<{token:string}>}) {
  const supabase=await getSupabaseServerClient(); if(!supabase)return NextResponse.json({error:"Authentication required."},{status:401});
  const {data:{user}}=await supabase.auth.getUser(); if(!user)return NextResponse.json({error:"Authentication required."},{status:401});
  const {token}=await params;
  if(!/^[A-Za-z0-9_-]{40,100}$/.test(token))return NextResponse.json({error:"This invite is invalid."},{status:404});
  let pin:string|null=null;try{const body=await request.json();pin=typeof body.pin==="string"?body.pin:null;}catch{}
  const hash=createHash("sha256").update(token).digest("hex");
  const service=getSupabaseServiceClient();
  if(!service)return NextResponse.json({error:"Invite redemption is unavailable."},{status:503});
  const {data:invite}=await service.from("invites").select("event_id,mode").eq("token_hash",hash).maybeSingle();
  if(!invite)return NextResponse.json({error:"This invite is unavailable."},{status:404});
  const {data,error}=await supabase.rpc("redeem_event_invite_secure",{p_token_hash:hash,p_pin:pin});
  if(error||data==null)return NextResponse.json({error:"This invite could not be redeemed. Check the invite details and try again later."},{status:403});
  const result=data&&typeof data==="object"?data as {event_id?:string;eventId?:string;status?:string}:null;
  return NextResponse.json({eventId:result?.event_id||result?.eventId||invite.event_id,status:result?.status||(invite.mode==="approval"?"pending":"joined")});
}