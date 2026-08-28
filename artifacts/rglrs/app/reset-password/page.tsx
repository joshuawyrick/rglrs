"use client";
import { FormEvent, Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Brand } from "@/components/brand";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { safeRelativePath } from "@/lib/app-url";
function ResetPasswordForm() {
 const searchParams=useSearchParams(); const next=safeRelativePath(searchParams.get("next"));
 const router=useRouter(); const [password,setPassword]=useState(""); const [error,setError]=useState(""); const [saving,setSaving]=useState(false);
 async function submit(e:FormEvent<HTMLFormElement>) { e.preventDefault(); setError(""); const supabase=getSupabaseBrowserClient(); if(!supabase)return setError("Supabase is not configured yet."); setSaving(true); const {error: updateError}=await supabase.auth.updateUser({password}); setSaving(false); if(updateError)return setError(updateError.message); router.replace(`/login?reset=1&next=${encodeURIComponent(next)}`); }
 return <div className="auth-shell"><div className="auth-card glass"><div style={{display:"flex",justifyContent:"center"}}><Brand compact/></div><h1>Choose a new password</h1><p>Use a password with at least 6 characters.</p><form className="auth-form" onSubmit={submit}><input className="input" type="password" autoComplete="new-password" placeholder="New password" minLength={6} value={password} onChange={e=>setPassword(e.target.value)} required/>{error&&<p className="form-message error-message" role="alert">{error}</p>}<button className="primary-btn" disabled={saving}>{saving?"Updating…":"Update password"}</button></form></div></div>;
}
export default function ResetPassword(){return <Suspense fallback={<div className="auth-shell"><div className="feed-loader" aria-label="Loading password reset"><span/></div></div>}><ResetPasswordForm/></Suspense>;}