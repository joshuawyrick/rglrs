"use client";

import Link from "next/link";
import { FormEvent, Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Brand } from "@/components/brand";
import { safeRelativePath } from "@/lib/app-url";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setError("Supabase is not configured yet. Add the public URL and publishable key to continue.");
      return;
    }

    setIsSubmitting(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setIsSubmitting(false);
    if (signInError) {
      setError(signInError.message);
      return;
    }
    const next = safeRelativePath(searchParams.get("next"));
    router.replace(next);
    router.refresh();
  }

  return <div className="auth-shell"><div className="auth-card glass">
    <div style={{display:"flex",justifyContent:"center"}}><Brand compact/></div>
    <h1 style={{textAlign:"center"}}>Welcome back</h1><p style={{textAlign:"center"}}>Sign in to your account</p>
    <form className="auth-form" onSubmit={handleSubmit}>
      <label className="sr-only" htmlFor="login-email">Email</label>
      <input id="login-email" className="input" type="email" autoComplete="email" placeholder="Email" value={email} onChange={(event) => setEmail(event.target.value)} required/>
      <label className="sr-only" htmlFor="login-password">Password</label>
      <input id="login-password" className="input" type="password" autoComplete="current-password" placeholder="Password" value={password} onChange={(event) => setPassword(event.target.value)} required/>
       <div style={{textAlign:"right"}}><Link className="text-btn" href={`/forgot-password?next=${encodeURIComponent(safeRelativePath(searchParams.get("next")))}`}>Forgot password?</Link></div>
       {searchParams.get("reset") ? <p className="form-message success-message" role="status">Your password was updated. Please sign in.</p> : null}
       {searchParams.get("expired") ? <p className="form-message error-message" role="alert">Your session expired. Please sign in again.</p> : null}
      {error ? <p className="form-message error-message" role="alert">{error}</p> : null}
      <button className="primary-btn" type="submit" disabled={isSubmitting}>{isSubmitting ? "Signing in…" : "Sign In"}</button>
    </form>
    <div className="auth-divider">Other sign-in options (unavailable)</div>
    <div className="social-auth"><button className="social-btn" type="button" disabled title="Apple sign-in is not available">● Apple · Unavailable</button><button className="social-btn" type="button" disabled title="Google sign-in is not available">G Google · Unavailable</button></div>
    <div style={{textAlign:"center",marginTop:28,fontSize:8,color:"var(--muted)"}}>Don’t have an account? <Link href={`/signup?next=${encodeURIComponent(safeRelativePath(searchParams.get("next")))}`} className="teal">Sign up</Link></div>
  </div></div>;
}

export default function Login() {
  return <Suspense fallback={<div className="auth-shell"><div className="feed-loader" aria-label="Loading sign in"><span /></div></div>}>
    <LoginForm />
  </Suspense>;
}
