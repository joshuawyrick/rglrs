"use client";

import Link from "next/link";
import { FormEvent, Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Brand } from "@/components/brand";
import { getAppUrl, safeRelativePath } from "@/lib/app-url";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { formatAuthError, isEmailRateLimitError } from "@/lib/auth-errors";

function SignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeRelativePath(searchParams.get("next"), "/profile");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(false);
  const [retryCooldown, setRetryCooldown] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (retryCooldown) return;
    setError("");
    setNotice("");
    const normalizedUsername = username.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,30}$/.test(normalizedUsername)) {
      setError("Username must be 3–30 characters using lowercase letters, numbers, or underscores.");
      return;
    }

    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setError("Supabase is not configured yet. Add the public URL and publishable key to continue.");
      return;
    }

    setIsSubmitting(true);
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: { full_name: fullName.trim(), username: normalizedUsername },
        emailRedirectTo: getAppUrl(`/auth/callback?next=${encodeURIComponent(next)}`),
      },
    });
    setIsSubmitting(false);
    if (signUpError) {
      setError(formatAuthError(signUpError, "We couldn’t create your account. Please try again."));
      if (isEmailRateLimitError(signUpError)) {
        setRetryCooldown(true);
        window.setTimeout(() => setRetryCooldown(false), 60_000);
      }
      return;
    }

    if (data.session) {
      router.replace(next);
      router.refresh();
    } else {
      setNotice("Account created. Check your email to confirm your address.");
    }
  }
  async function resendConfirmation() {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return setError("Supabase is not configured yet.");
    setError(""); setResendCooldown(true);
    const { error: resendError } = await supabase.auth.resend({
      type: "signup", email: email.trim(), options: { emailRedirectTo: getAppUrl(`/auth/callback?next=${encodeURIComponent(next)}`) },
    });
    if (resendError) {
      setError(formatAuthError(resendError, "We couldn’t resend the confirmation email."));
      if (isEmailRateLimitError(resendError)) {
        window.setTimeout(() => setResendCooldown(false), 60_000);
      } else {
        setResendCooldown(false);
      }
      return;
    }
    setNotice("Confirmation email sent. Check your inbox.");
    window.setTimeout(() => setResendCooldown(false), 60_000);
  }

  return <div className="auth-shell"><div className="auth-card glass">
    <div style={{display:"flex",justifyContent:"center"}}><Brand compact/></div>
    <h1 style={{textAlign:"center"}}>Find your regulars.</h1><p style={{textAlign:"center"}}>Create a private place for the people who are actually part of your life.</p>
    <form className="auth-form" onSubmit={handleSubmit}>
      <label className="sr-only" htmlFor="signup-name">Full name</label>
      <input id="signup-name" className="input" autoComplete="name" placeholder="Full name" value={fullName} onChange={(event) => setFullName(event.target.value)} required/>
      <label className="sr-only" htmlFor="signup-email">Email</label>
      <input id="signup-email" className="input" type="email" autoComplete="email" placeholder="Email" value={email} onChange={(event) => setEmail(event.target.value)} required/>
      <label className="sr-only" htmlFor="signup-username">Username</label>
      <input id="signup-username" className="input" autoComplete="username" placeholder="Username" value={username} onChange={(event) => setUsername(event.target.value.toLowerCase())} pattern="[a-z0-9_]{3,30}" required/>
      <label className="sr-only" htmlFor="signup-password">Password</label>
      <input id="signup-password" className="input" type="password" autoComplete="new-password" placeholder="Password (at least 6 characters)" value={password} onChange={(event) => setPassword(event.target.value)} minLength={6} required/>
      {error ? <p className="form-message error-message" role="alert">{error}</p> : null}
       {notice ? <p className="form-message success-message" role="status">{notice}</p> : null}
       <button className="primary-btn" type="submit" disabled={isSubmitting || retryCooldown}>{isSubmitting ? "Creating account…" : retryCooldown ? "Try again shortly" : "Create account"}</button>
       {notice ? <button className="text-btn" type="button" onClick={resendConfirmation} disabled={resendCooldown}>{resendCooldown ? "Resend available shortly" : "Resend confirmation email"}</button> : null}
      <Link className="secondary-btn" href={`/login?next=${encodeURIComponent(next)}`}>I already have an account</Link>
    </form>
  </div></div>;
}

export default function Signup() {
  return <Suspense fallback={<div className="auth-shell"><div className="feed-loader" aria-label="Loading sign up"><span /></div></div>}><SignupForm /></Suspense>;
}
