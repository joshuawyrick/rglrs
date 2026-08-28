"use client";

import { FormEvent, useState } from "react";
import { Flag, ShieldBan } from "lucide-react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const categories = ["harassment", "spam", "impersonation", "hate", "other"] as const;

export function MemberSafetyPanel({ memberId, memberName }: { memberId: string; memberName: string }) {
  const router = useRouter();
  const [category, setCategory] = useState<(typeof categories)[number]>("harassment");
  const [details, setDetails] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [blocking, setBlocking] = useState(false);
  const [reporting, setReporting] = useState(false);

  async function blockMember() {
    if (!window.confirm(`Block ${memberName}? They will no longer be able to interact with you.`)) return;
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return setError("Safety controls are unavailable until Supabase is connected.");
    setBlocking(true); setError(null); setMessage(null);
    const { error: blockError } = await supabase.rpc("block_member", { p_blocked: memberId });
    if (blockError) setError(blockError.message || "Could not block this member.");
    else {
      setMessage(`${memberName} has been blocked.`);
      window.dispatchEvent(new CustomEvent("rglrs:friendship-changed"));
      window.localStorage.setItem("rglrs:friendship-changed", Date.now().toString());
      router.replace("/search");
      router.refresh();
    }
    setBlocking(false);
  }

  async function reportMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanDetails = details.trim();
    if (!categories.includes(category) || cleanDetails.length < 10 || cleanDetails.length > 1000) {
      setError("Choose a category and provide 10–1000 characters of details.");
      return;
    }
    if (!window.confirm(`Send this report about ${memberName}?`)) return;
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return setError("Safety controls are unavailable until Supabase is connected.");
    setReporting(true); setError(null); setMessage(null);
    const { error: reportError } = await supabase.rpc("report_member", {
      p_target: memberId, p_category: category, p_details: cleanDetails,
    });
    if (reportError) setError(reportError.message || "Could not send this report.");
    else {
      setDetails("");
      setMessage("Your report has been sent. Thank you for helping keep RGLRS safe.");
    }
    setReporting(false);
  }

  return <section className="member-safety card card-pad" aria-labelledby="safety-heading">
    <div className="row gap8"><ShieldBan size={17} color="var(--danger)" /><h2 id="safety-heading" className="section-title">Safety</h2></div>
    <p className="member-safety-copy">Blocking removes this member from your experience. Reporting alerts our moderation team.</p>
    {message ? <p className="form-message success-message" role="status">{message}</p> : null}
    {error ? <p className="form-message error-message" role="alert">{error}</p> : null}
    <button type="button" className="danger-btn member-safety-block" onClick={blockMember} disabled={blocking || reporting}>{blocking ? "Blocking…" : `Block ${memberName}`}</button>
    <form className="member-report-form" onSubmit={reportMember}>
      <label className="form-label" htmlFor="report-category">Report category</label>
      <select id="report-category" className="input" value={category} onChange={(event) => setCategory(event.target.value as typeof category)} disabled={blocking || reporting}>
        {categories.map((value) => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}
      </select>
      <label className="form-label" htmlFor="report-details">Details (10–1000 characters)</label>
      <textarea id="report-details" className="input" value={details} onChange={(event) => setDetails(event.target.value)} minLength={10} maxLength={1000} required disabled={blocking || reporting} />
      <button className="secondary-btn" type="submit" disabled={blocking || reporting}><Flag size={14} />{reporting ? "Sending report…" : "Report member"}</button>
    </form>
  </section>;
}