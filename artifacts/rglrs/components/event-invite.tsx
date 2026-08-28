"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { Check, Share2 } from "lucide-react";
import { AvatarStack } from "@/components/avatar-stack";
import { QrDownloads } from "@/components/qr-downloads";
import { getAppUrl } from "@/lib/app-url";

type InviteMeta={id:string;mode:string;expires_at:string|null;max_uses:number|null;use_count:number;revoked_at:string|null;has_pin:boolean};
function localDateTime(value:Date){
  const offset=value.getTimezoneOffset()*60_000;
  return new Date(value.getTime()-offset).toISOString().slice(0,16);
}

export function EventInvite({eventId,eventTitle,eventDate,place,avatars=[]}:{eventId:string;eventTitle:string;eventDate:string;place?:string|null;avatars?:string[]}) {
  const [path,setPath]=useState<string|null>(null);
  const url=path?getAppUrl(path):null;
  const [shared,setShared]=useState(false);
  const [invites,setInvites]=useState<InviteMeta[]>([]);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);

  async function load(){
    const response=await fetch(`/event-invites/events/${eventId}`,{cache:"no-store"});
    const body=await response.json();
    if(response.ok) setInvites(body.invites);
    else setError(body.error);
  }

  useEffect(()=>{void load();},[eventId]);

  async function create(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setBusy(true);setError(null);const form=new FormData(event.currentTarget);
    const expiry=new Date(String(form.get("expires")||""));const now=Date.now();
    if(Number.isNaN(expiry.getTime())||expiry.getTime()<=now||expiry.getTime()>now+365*24*60*60*1000){setBusy(false);return setError("Expiry must be in the future and within one year.");}
    const maxUses=String(form.get("maxUses")||"")?Number(form.get("maxUses")):null;
    if(maxUses!==null&&(!Number.isInteger(maxUses)||maxUses<1||maxUses>10000)){setBusy(false);return setError("Max uses must be between 1 and 10,000.");}
    const response=await fetch(`/event-invites/events/${eventId}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
      mode:form.get("mode"),pin:String(form.get("pin")||"")||null,expiresAt:expiry.toISOString(),
      maxUses,
    })});
    const body=await response.json();setBusy(false);if(!response.ok)return setError(body.error||"Could not create invite.");
    setPath(body.path);await load();
  }

  async function revoke(id:string){
    setBusy(true);
    const response=await fetch(`/event-invites/events/${eventId}`,{method:"DELETE",headers:{"content-type":"application/json"},body:JSON.stringify({inviteId:id})});
    const body=await response.json();
    setBusy(false);
    if(!response.ok)return setError(body.error);
    await load();
  }

  async function shareInvite(){
    if(!url)return;
    try{
      if(navigator.share)await navigator.share({title:eventTitle,text:`Join me on RGLRS for ${eventTitle}`,url});
      else await navigator.clipboard.writeText(url);
      setShared(true);window.setTimeout(()=>setShared(false),1800);
    }catch{}
  }

  return (
    <div className="qr-wrap stack gap12">
      <div className="invite-event-title" style={{ fontSize: 16 }}>{eventTitle}</div>
      <div className="invite-event-meta" style={{ fontSize: 11 }}>{eventDate}<br/>{place||"Location to be announced"}</div>

      {avatars.length ? (
        <div style={{display:"flex",justifyContent:"center",marginTop:12}}>
          <AvatarStack avatars={avatars} count={5}/>
        </div>
      ) : null}

      <form className="stack gap12 card card-pad" style={{marginTop:20,textAlign:"left"}} onSubmit={create}>
        <label>
          <span className="form-label">Participation mode</span>
          <select className="input" name="mode">
            <option value="participate">Participate</option>
            <option value="upload_only">Upload only</option>
            <option value="view_only">View only</option>
            <option value="approval">Approval required</option>
          </select>
        </label>

        <div className="form-two">
          <label>
            <span className="form-label">Expires</span>
            <input className="input" type="datetime-local" name="expires" required min={localDateTime(new Date(Date.now()+60_000))} max={localDateTime(new Date(Date.now()+365*24*60*60*1000))} defaultValue={localDateTime(new Date(Date.now()+7*24*60*60*1000))}/>
          </label>
          <label>
            <span className="form-label">Max uses <em>optional</em></span>
            <input className="input" type="number" min="1" max="10000" name="maxUses"/>
          </label>
        </div>

        <label>
          <span className="form-label">Optional PIN</span>
          <input className="input" type="password" inputMode="numeric" pattern="[0-9]{4,12}" name="pin" autoComplete="new-password" placeholder="4-12 digits"/>
        </label>

        <button className="primary-btn" disabled={busy} style={{ marginTop: 8 }}>
          {busy?"Creating…":"Create private invite"}
        </button>
      </form>

      {error?<div className="form-error" role="alert">{error}</div>:null}

      {url&&path ? (
        <section className="event-qr-print-card invite-print-card" style={{ marginTop: 16 }}>
          <div className="event-qr-print-brand">RGLRS</div>
          <QrDownloads value={url} fileName={`rglrs-${eventId}-invite`} printable/>
          <h3 className="qr-title">Scan to join {eventTitle}</h3>
          <p className="qr-sub">{eventDate}<br/>{place||"Location to be announced"}<br/><br/>Save this link now. For security it won’t be shown again.</p>
          <div className="stack gap8 qr-screen-actions" style={{marginTop:16, width: "100%"}}>
            <button className="secondary-btn" onClick={shareInvite}>
              {shared?<><Check size={18}/> Link copied</>:<><Share2 size={18}/> Share Invite</>}
            </button>
            <Link href={path} className="primary-btn">Preview Join Flow</Link>
          </div>
        </section>
      ) : null}

      {invites.length > 0 && (
        <div className="stack gap8" style={{marginTop:24,textAlign:"left"}}>
          <h2 className="settings-title">Active invites</h2>
          {invites.map((invite)=> (
            <div className="card card-pad" key={invite.id}>
              <div className="row space">
                <div>
                  <div className="friend-name" style={{ fontSize: 13, marginBottom: 4, textTransform: "capitalize" }}>{invite.mode.replaceAll("_"," ")}</div>
                  <div className="friend-sub" style={{ fontSize: 10.5 }}>
                    {invite.use_count}{invite.max_uses?` / ${invite.max_uses}`:""} uses · {invite.expires_at?`expires ${new Date(invite.expires_at).toLocaleDateString()}`:"expiry unavailable"}{invite.has_pin?" · PIN":""}
                  </div>
                </div>
                {invite.revoked_at ? (
                  <span className="pill">Revoked</span>
                ) : (
                  <button className="text-btn" disabled={busy} onClick={()=>revoke(invite.id)}>Revoke</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
