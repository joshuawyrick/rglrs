"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { PageShell } from "@/components/page-shell";
import { MobileHeader } from "@/components/mobile-header";
import { getAppUrl } from "@/lib/app-url";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { formatAuthError, isEmailRateLimitError } from "@/lib/auth-errors";

 export default function AccountSettings() {
  const [email,setEmail]=useState(""); const [verified,setVerified]=useState(false); const [message,setMessage]=useState(""); const [sending,setSending]=useState(false); const [cooldown,setCooldown]=useState(false);
 useEffect(()=>{ const supabase=getSupabaseBrowserClient(); if(!supabase)return; void supabase.auth.getUser().then(({data:{user}})=>{setEmail(user?.email||"");setVerified(Boolean(user?.email_confirmed_at));}); },[]);
  async function resend(){if(sending||cooldown)return;const supabase=getSupabaseBrowserClient();if(!supabase)return setMessage("Supabase is not configured yet.");setSending(true);const {error}=await supabase.auth.resend({type:"signup",email,options:{emailRedirectTo:getAppUrl("../../auth/callback?next=/profile")}});setSending(false);setMessage(error?formatAuthError(error,"We couldn’t resend the confirmation email."):"Confirmation email sent. Check your inbox.");if(error&&isEmailRateLimitError(error)){setCooldown(true);window.setTimeout(()=>setCooldown(false),60_000);}}
  return <PageShell><MobileHeader title="Account" backHref="/settings"/><div className="page-header"><h1>Account</h1><p>Manage your email and account access.</p></div><div className="card card-pad stack gap12"><div><div className="settings-title">Email</div><div className="settings-sub">{email||"Loading…"}</div></div><div><div className="settings-title">Verification</div><div className={verified?"form-message success-message":"form-message error-message"}>{verified?"Email verified":"Email verification pending"}</div></div>{!verified&&email?<button className="secondary-btn" onClick={resend} disabled={sending||cooldown}>{sending?"Sending…":cooldown?"Try again shortly":"Resend verification email"}</button>:null}{message?<p className="form-message" role="status">{message}</p>:null}</div><Link className="settings-row" href="/settings/security"><div><div className="settings-title">Security</div><div className="settings-sub">Password and sign-in settings</div></div></Link></PageShell>;
}