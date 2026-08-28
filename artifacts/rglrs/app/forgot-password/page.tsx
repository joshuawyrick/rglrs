"use client";
import Link from "next/link";
import { FormEvent, Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Brand } from "@/components/brand";
import { getAppUrl, safeRelativePath } from "@/lib/app-url";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { formatAuthError, isEmailRateLimitError } from "@/lib/auth-errors";

function ForgotPasswordForm() {
  const searchParams = useSearchParams();
  const next = safeRelativePath(searchParams.get("next"));
  const [email, setEmail] = useState(""); const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [cooldown, setCooldown] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); const supabase = getSupabaseBrowserClient();
    if (!supabase) return setError("Supabase is not configured yet.");
    setCooldown(true);
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: getAppUrl(`/reset-password?next=${encodeURIComponent(next)}`) });
     if (resetError) {
       setError(formatAuthError(resetError, "We couldn’t send the password reset email."));
       if (isEmailRateLimitError(resetError)) {
         window.setTimeout(() => setCooldown(false), 60_000);
       } else {
         setCooldown(false);
       }
       return;
     }
    setNotice("If that email has an account, we sent a password reset link.");
    window.setTimeout(() => setCooldown(false), 60_000);
  }
  return <div className="auth-shell"><div className="auth-card glass"><div style={{display:"flex",justifyContent:"center"}}><Brand compact/></div><h1>Reset your password</h1><p>Enter your email and we’ll send a secure reset link.</p><form className="auth-form" onSubmit={submit}><input className="input" type="email" autoComplete="email" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} required />{error && <p className="form-message error-message" role="alert">{error}</p>}{notice && <p className="form-message success-message" role="status">{notice}</p>}<button className="primary-btn" disabled={cooldown}>{cooldown ? "Email sent — please wait…" : "Send reset link"}</button><Link className="secondary-btn" href={`/login?next=${encodeURIComponent(next)}`}>Back to sign in</Link></form></div></div>;
}
export default function ForgotPassword() {
  return <Suspense fallback={<div className="auth-shell"><div className="feed-loader" aria-label="Loading password reset"><span /></div></div>}><ForgotPasswordForm /></Suspense>;
}