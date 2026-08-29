"use client";

import { useEffect, useMemo, useState } from "react";
import { ShieldCheck, Trash2, UserPlus } from "lucide-react";
import { AudienceDialog } from "@/components/post-options-dialogs";
import { MobileHeader } from "@/components/mobile-header";
import { PageShell } from "@/components/page-shell";
import type { AudienceType } from "@/lib/post-data";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type Visibility = "everyone" | "friends" | "only_me";
type Settings = {
  default_post_audience_kind: AudienceType; default_event_media_audience: string;
  default_media_downloads: boolean; allow_internal_resharing: boolean;
  full_profile_visibility: Visibility; profile_photo_visibility: Visibility; connections_visibility: Visibility;
  username_discoverability: string; email_discoverability: string;
  friend_request_policy: string; message_policy: string; event_invite_policy: string;
};
type DefaultRule = { scope: "post" | "event_media"; rule_type: string; subject_id: string | null };
type OverrideField = "can_view_profile" | "can_view_profile_photo" | "can_view_connections" |
  "can_find_username" | "can_find_email" | "can_send_friend_request" | "can_message" |
  "can_invite_to_events" | "can_download_media" | "can_reshare_internal" | "hide_posts" | "hide_event_media" | "can_view_location";
type PersonOverride = { person_id: string } & Record<OverrideField, boolean | null>;
type Candidate = { id: string; name: string };

const defaults: Settings = {
  default_post_audience_kind: "friends", default_event_media_audience: "all_event_members",
  default_media_downloads: false, allow_internal_resharing: false,
  full_profile_visibility: "everyone", profile_photo_visibility: "everyone", connections_visibility: "friends",
  username_discoverability: "everyone", email_discoverability: "nobody", friend_request_policy: "everyone",
  message_policy: "friends", event_invite_policy: "friends",
};
const overrideFields: Array<[OverrideField, string]> = [
  ["can_view_profile","View profile"],["can_view_profile_photo","View photo"],["can_view_connections","View connections"],
  ["can_find_username","Find username"],["can_find_email","Find email"],["can_send_friend_request","Send friend request"],
  ["can_message","Message"],["can_invite_to_events","Invite to events"],["can_download_media","Download media"],
  ["can_reshare_internal","Reshare internally"],["hide_posts","Hide posts"],["hide_event_media","Hide event media"],
  ["can_view_location","See my What’s Crackin location"],
];
const emptyOverride = (personId: string): PersonOverride => Object.fromEntries([
  ["person_id", personId], ...overrideFields.map(([field]) => [field, null]),
]) as PersonOverride;
const ruleForAudience: Record<AudienceType, string | null> = {
  private: null, friends: "include_friends", circles: "include_circle", events: "include_event",
  people: "include_user", except: "exclude_user",
};

const Select = ({ label, value, options, onChange }: { label: string; value: string; options: Array<[string, string]>; onChange: (value: string) => void }) =>
  <label className="privacy-control"><span>{label}</span><select className="input" value={value} onChange={(event) => onChange(event.target.value)}>{options.map(([id,name]) => <option value={id} key={id}>{name}</option>)}</select></label>;
const Toggle = ({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (checked: boolean) => void }) =>
  <label className="privacy-toggle"><div className="privacy-toggle-text"><strong>{label}</strong><small>{hint}</small></div><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)}/></label>;

export default function PrivacySettingsPage() {
  const [settings,setSettings] = useState<Settings>(defaults);
  const [defaultRules,setDefaultRules] = useState<DefaultRule[]>([]);
  const [overrides,setOverrides] = useState<PersonOverride[]>([]);
  const [candidates,setCandidates] = useState<Candidate[]>([]);
  const [newPerson,setNewPerson] = useState("");
  const [audienceOpen,setAudienceOpen] = useState(false);
  const [loading,setLoading] = useState(true);
  const [saving,setSaving] = useState(false);
  const [busyPerson,setBusyPerson] = useState<string | null>(null);
  const [message,setMessage] = useState("");
  const update = <K extends keyof Settings>(field: K,value: Settings[K]) => { setSettings((current) => ({...current,[field]:value})); setMessage(""); };
  const postSubjectIds = useMemo(() => {
    const type = ruleForAudience[settings.default_post_audience_kind];
    return defaultRules.filter((rule) => rule.scope === "post" && rule.rule_type === type && rule.subject_id).map((rule) => rule.subject_id as string);
  }, [defaultRules,settings.default_post_audience_kind]);
  const names = useMemo(() => new Map(candidates.map((person) => [person.id,person.name])),[candidates]);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) { setMessage("Privacy controls are unavailable until Supabase is connected."); setLoading(false); return; }
    let active = true;
    void (async () => {
      const [{data,error},{data:{user}}] = await Promise.all([supabase.rpc("get_privacy_settings_secure"),supabase.auth.getUser()]);
      if (!active) return;
      if (error) setMessage(error.message || "Could not load privacy settings.");
      else if (data) {
        const value = data as { settings?: Partial<Settings>; default_rules?: DefaultRule[]; person_overrides?: PersonOverride[] };
        setSettings({...defaults,...value.settings}); setDefaultRules(value.default_rules || []); setOverrides(value.person_overrides || []);
      }
      if (user) {
        const friendships = await supabase.from("friendships").select("requester_id,addressee_id").eq("status","accepted").or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`).limit(200);
        const ids = [...new Set((friendships.data || []).map((row) => row.requester_id === user.id ? row.addressee_id : row.requester_id))];
        if (ids.length) {
          const profiles = await supabase.from("profiles").select("id,display_name").in("id",ids).order("display_name");
          if (active) setCandidates((profiles.data || []).map((row) => ({id:row.id,name:row.display_name})));
        }
      }
      if (active) setLoading(false);
    })();
    return () => { active=false; };
  },[]);

  async function save() {
    const required = !["private","friends"].includes(settings.default_post_audience_kind);
    if (required && !postSubjectIds.length) return setMessage("Choose at least one default audience subject.");
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return setMessage("Privacy controls are unavailable until Supabase is connected.");
    setSaving(true); setMessage("");
    const postRuleType = ruleForAudience[settings.default_post_audience_kind];
    const normalizedPostRules: DefaultRule[] = postRuleType
      ? settings.default_post_audience_kind === "friends"
        ? [{scope:"post",rule_type:"include_friends",subject_id:null}]
        : postSubjectIds.map((id) => ({scope:"post",rule_type:postRuleType,subject_id:id}))
      : [];
    const normalizedRules = [...defaultRules.filter((rule) => rule.scope !== "post"),...normalizedPostRules];
    const settingsResult = await supabase.rpc("update_privacy_settings_secure",{p_settings:settings});
    const rulesResult = settingsResult.error
      ? { error: null }
      : await supabase.rpc("set_privacy_default_audience_rules_secure",{p_rules:normalizedRules});
    setSaving(false);
    if (!settingsResult.error && !rulesResult.error) setDefaultRules(normalizedRules);
    setMessage(settingsResult.error?.message || rulesResult.error?.message || "Privacy settings saved.");
  }
  async function persistOverride(value: PersonOverride) {
    const supabase = getSupabaseBrowserClient(); if (!supabase) return;
    setBusyPerson(value.person_id); setMessage("");
    const {error} = await supabase.rpc("set_person_privacy_override_secure",{p_override:value});
    setBusyPerson(null);
    if (error) setMessage(error.message || "Could not save person override.");
    else setOverrides((current) => current.some((item) => item.person_id === value.person_id) ? current.map((item) => item.person_id === value.person_id ? value : item) : [...current,value]);
  }
  async function removeOverride(personId: string) {
    const supabase = getSupabaseBrowserClient(); if (!supabase) return;
    setBusyPerson(personId);
    const {error} = await supabase.rpc("remove_person_privacy_override_secure",{p_person:personId});
    setBusyPerson(null);
    if (error) setMessage(error.message || "Could not remove person override.");
    else setOverrides((current) => current.filter((item) => item.person_id !== personId));
  }
  const visibility: Array<[string,string]> = [["everyone","Everyone on RGLRS"],["friends","Friends"],["only_me","Only me"]];
  return <PageShell><MobileHeader title="Privacy" backHref="/settings"/>
    <div className="page-header privacy-heading"><span className="privacy-heading-icon"><ShieldCheck size={24}/></span><div><h1>Privacy controls</h1><p>Set defaults. Blocks and denials always win.</p></div></div>
    {loading ? <div className="feed-loader" aria-label="Loading privacy settings"><span/></div> : <>
      <section className="privacy-section"><div className="settings-title">Profile & discovery</div>
        <Select label="Full profile" value={settings.full_profile_visibility} options={visibility} onChange={(v) => update("full_profile_visibility",v as Visibility)}/>
        <Select label="Profile photo" value={settings.profile_photo_visibility} options={visibility} onChange={(v) => update("profile_photo_visibility",v as Visibility)}/>
        <Select label="Connections" value={settings.connections_visibility} options={visibility} onChange={(v) => update("connections_visibility",v as Visibility)}/>
        <Select label="Username discoverability" value={settings.username_discoverability} options={[["everyone","Everyone"],["friends","Friends"],["nobody","Nobody"]]} onChange={(v) => update("username_discoverability",v)}/>
        <Select label="Email discoverability" value={settings.email_discoverability} options={[["friends","Friends"],["nobody","Nobody"]]} onChange={(v) => update("email_discoverability",v)}/>
      </section>
      <section className="privacy-section"><div className="settings-title">Contact & invitations</div>
        <Select label="Friend requests" value={settings.friend_request_policy} options={[["everyone","Everyone"],["nobody","Nobody"]]} onChange={(v) => update("friend_request_policy",v)}/>
        <Select label="New messages" value={settings.message_policy} options={[["friends","Friends"],["nobody","Nobody"]]} onChange={(v) => update("message_policy",v)}/>
        <Select label="Event invitations" value={settings.event_invite_policy} options={[["everyone","Everyone"],["friends","Friends"],["nobody","Nobody"]]} onChange={(v) => update("event_invite_policy",v)}/>
      </section>
      <section className="privacy-section"><div className="settings-title">Media & sharing defaults</div>
        <button type="button" className="privacy-audience-btn secondary-btn" onClick={() => setAudienceOpen(true)}>Default post audience: {settings.default_post_audience_kind.replace("_"," ")}</button>
        {postSubjectIds.length ? <div style={{ fontSize: 11, color: "var(--muted)", textAlign: "center", marginTop: -4 }}>{postSubjectIds.length} default {postSubjectIds.length === 1 ? "subject" : "subjects"} selected</div> : null}
        <Select label="Event media audience" value={settings.default_event_media_audience} options={[["all_event_members","All event members"],["event_members_except","Event members except"]]} onChange={(v) => update("default_event_media_audience",v)}/>
        <Toggle label="Allow media downloads" hint="Default for new posts." checked={settings.default_media_downloads} onChange={(v) => update("default_media_downloads",v)}/>
        <Toggle label="Allow internal resharing" hint="Audiences and blocks still apply." checked={settings.allow_internal_resharing} onChange={(v) => update("allow_internal_resharing",v)}/>
      </section>
      <section className="privacy-section"><div className="settings-title">Person overrides</div>
        <p style={{fontSize:10,color:"var(--muted)",lineHeight:1.5}}>These controls can make your privacy stricter for a specific friend, including denying access to your What’s Crackin location even while you are sharing.</p>
        <div className="row gap8">
          <select className="input" value={newPerson} onChange={(e) => setNewPerson(e.target.value)}>
            <option value="">Choose a friend…</option>
            {candidates.filter((c) => !overrides.some((o) => o.person_id===c.id)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button type="button" className="secondary-btn" style={{ padding: "0 14px" }} disabled={!newPerson} onClick={() => { const value=emptyOverride(newPerson); setNewPerson(""); void persistOverride(value); }} aria-label="Add person override">
            <UserPlus size={20}/>
          </button>
        </div>
        {overrides.map((item) => <div className="privacy-person-card" key={item.person_id}><div className="row space"><strong>{names.get(item.person_id) || "Person"}</strong><button type="button" className="screen-icon-btn" disabled={busyPerson===item.person_id} onClick={() => void removeOverride(item.person_id)} aria-label="Remove person override"><Trash2 size={20}/></button></div>
          <div className="privacy-person-grid">{overrideFields.map(([field,label]) => <Select key={field} label={label} value={item[field]===null || item[field]===undefined ? "inherit" : String(item[field])} options={field.startsWith("hide_") ? [["inherit","Default"],["true","Hide"],["false","Show"]] : [["inherit","Default"],["true","Allow"],["false","Deny"]]} onChange={(value) => void persistOverride({...item,[field]:value==="inherit" ? null : value==="true"})}/>)}</div>
        </div>)}
      </section>
      {message ? <p className={`form-message ${message.endsWith("saved.") ? "success-message" : "error-message"}`} role="status">{message}</p> : null}
      <button className="primary-btn privacy-save" type="button" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save privacy settings"}</button>
      <AudienceDialog open={audienceOpen} audience={settings.default_post_audience_kind} subjectIds={postSubjectIds} onClose={() => setAudienceOpen(false)} onSave={(audience,ids) => {
        const type=ruleForAudience[audience]; const retained=defaultRules.filter((rule) => rule.scope!=="post");
        const postRules: DefaultRule[] = type ? (audience==="friends" ? [{scope:"post",rule_type:type,subject_id:null}] : ids.map((id) => ({scope:"post",rule_type:type,subject_id:id}))) : [];
        setSettings((current) => ({...current,default_post_audience_kind:audience})); setDefaultRules([...retained,...postRules]); setAudienceOpen(false); setMessage("");
      }}/>
    </>}
  </PageShell>;
}
