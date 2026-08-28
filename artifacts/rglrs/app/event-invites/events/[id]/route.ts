import { createHash, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

async function auth() {
  const supabase=await getSupabaseServerClient();
  if(!supabase) return null;
  const {data:{user}}=await supabase.auth.getUser();
  return user?{supabase,user}:null;
}

export async function GET(_:NextRequest,{params}:{params:Promise<{id:string}>}) {
  const session=await auth(); if(!session)return NextResponse.json({error:"Authentication required."},{status:401});
  const {id}=await params;
  const {data,error}=await session.supabase.rpc("list_event_invites_secure",{p_event:id});
  if(error)return NextResponse.json({error:"Could not load invite history."},{status:403});
  return NextResponse.json({invites:data||[]});
}

export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}) {
  const session=await auth(); if(!session)return NextResponse.json({error:"Authentication required."},{status:401});
  const {id}=await params;
  let body:{mode?:string;pin?:string;expiresAt?:string|null;maxUses?:number|null};
  try{body=await request.json();}catch{return NextResponse.json({error:"Invalid request."},{status:400});}
  const modes=["participate","upload_only","view_only","approval"];
  if(!body.mode||!modes.includes(body.mode))return NextResponse.json({error:"Choose a valid participation mode."},{status:400});
  if(body.pin&&(!/^\d{4,12}$/.test(body.pin)))return NextResponse.json({error:"PIN must be 4–12 digits."},{status:400});
  if(body.maxUses!=null&&(!Number.isInteger(body.maxUses)||body.maxUses<1||body.maxUses>10000))return NextResponse.json({error:"Max uses must be between 1 and 10,000."},{status:400});
  if(!body.expiresAt)return NextResponse.json({error:"An expiry date is required."},{status:400});
  const expiresAt=new Date(body.expiresAt);const now=Date.now();
  if(Number.isNaN(expiresAt.getTime())||expiresAt.getTime()<=now||expiresAt.getTime()>now+365*24*60*60*1000)return NextResponse.json({error:"Expiry must be in the future and within one year."},{status:400});
  const rawToken=randomBytes(32).toString("base64url");
  const tokenHash=createHash("sha256").update(rawToken).digest("hex");
  const {data,error}=await session.supabase.rpc("create_event_invite_secure",{
    p_event:id,p_token_hash:tokenHash,p_mode:body.mode,p_pin:body.pin||null,
    p_expires_at:expiresAt.toISOString(),p_max_uses:body.maxUses??null,
  });
  if(error)return NextResponse.json({error:"Could not create this invite. Check your event permissions and try again."},{status:403});
  return NextResponse.json({id:data,path:`/invite/${rawToken}`},{status:201});
}

export async function DELETE(request:NextRequest,{params}:{params:Promise<{id:string}>}) {
  const session=await auth(); if(!session)return NextResponse.json({error:"Authentication required."},{status:401});
  const {id}=await params;
  let body:{inviteId?:string};try{body=await request.json();}catch{return NextResponse.json({error:"Invalid request."},{status:400});}
  if(!body.inviteId)return NextResponse.json({error:"Invite is required."},{status:400});
  const {data:invites,error:listError}=await session.supabase.rpc("list_event_invites_secure",{p_event:id});
  if(listError)return NextResponse.json({error:"Could not verify this invite."},{status:403});
  if(!((invites||[]) as Array<{id?:string;invite_id?:string}>).some((invite)=>(invite.id||invite.invite_id)===body.inviteId))return NextResponse.json({error:"Invite not found for this event."},{status:404});
  const {error}=await session.supabase.rpc("revoke_event_invite_secure",{p_invite:body.inviteId});
  if(error)return NextResponse.json({error:"Could not revoke this invite."},{status:403});
  return NextResponse.json({ok:true});
}