"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { MobileHeader } from "@/components/mobile-header";
import { getAppPath } from "@/lib/app-url";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

async function responseError(response: Response, fallback: string) {
  const body = await response.json().catch(() => null) as { error?: string } | null;
  return body?.error || fallback;
}

export default function DataSettings() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function exportData() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(getAppPath("../../account-data/export"));
      if (!response.ok) throw new Error(await responseError(response, "Could not export your data."));
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "rglrs-account-export.json";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "A network error prevented the export. Please retry.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    if (confirmation !== "DELETE") {
      setMessage("Type DELETE to confirm.");
      return;
    }
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setMessage("Supabase is not configured yet.");
      return;
    }
    setBusy(true);
    try {
      const current = await supabase.auth.getUser();
      if (current.error || !current.data.user?.email) {
        throw new Error(current.error?.message || "Could not identify your account.");
      }
      const { data: { user }, error: reauthError } = await supabase.auth.signInWithPassword({
        email: current.data.user.email,
        password,
      });
      if (reauthError || !user) throw new Error(reauthError?.message || "Could not verify your password.");
      const response = await fetch(getAppPath("../../account-data"), {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation, password }),
      });
      if (!response.ok) throw new Error(await responseError(response, "Could not delete your account."));
      await supabase.auth.signOut();
      router.replace("/login");
      router.refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "A network error prevented account deletion. Please retry.");
    } finally {
      setBusy(false);
    }
  }

  const clearMessage = () => message && setMessage("");

  return <PageShell>
    <MobileHeader title="Data & Storage" backHref="/settings"/>
    <div className="page-header"><h1>Your data</h1><p>Download your data or permanently delete your account.</p></div>
    <div className="card card-pad stack gap12">
      <div className="settings-title">Export account data</div>
      <button className="secondary-btn" onClick={() => void exportData()} disabled={busy}>Download JSON export</button>
    </div>
    <form className="card card-pad profile-editor" onSubmit={remove}>
      <div className="settings-title" style={{ color: "var(--danger)" }}>Delete account</div>
      <p className="settings-sub">This permanently removes your profile and content. Type DELETE and enter your password to continue.</p>
      <label>Confirmation<input className="input" value={confirmation} onChange={(event) => { setConfirmation(event.target.value); clearMessage(); }} placeholder="Type DELETE" required/></label>
      <label>Password<input className="input" type="password" autoComplete="current-password" value={password} onChange={(event) => { setPassword(event.target.value); clearMessage(); }} placeholder="Password" required/></label>
      {message ? <p className="form-message error-message" role="alert">{message}</p> : null}
      <button className="danger-btn" disabled={busy}>{busy ? "Working…" : "Permanently delete account"}</button>
    </form>
  </PageShell>;
}