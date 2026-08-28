"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Check, UserMinus, UserRound, UsersRound } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { MobileHeader } from "@/components/mobile-header";

const options = [
  { id:"friends", title:"Friends", sub:"All your friends", Icon:UsersRound },
  { id:"circles", title:"Circles", sub:"Choose one or more circles", Icon:UsersRound },
  { id:"events", title:"Events", sub:"Share to an event", Icon:CalendarDays },
  { id:"people", title:"Specific People", sub:"Choose people", Icon:UserRound },
  { id:"except", title:"Everyone Except", sub:"Hide from people", Icon:UserMinus }
];

export default function AudiencePicker() {
  const router = useRouter();
  const [selected,setSelected] = useState("circles");
  return (
    <PageShell>
      <MobileHeader title="Who can see this?" backHref="/create"/>
      <div className="audience-summary">
        {options.map(({id,title,sub,Icon}) => (
          <button key={id} className={`audience-card ${selected===id?"selected":""}`} onClick={()=>setSelected(id)}>
            <div className="row gap10">
              <Icon size={18} color={selected===id?"var(--teal)":"var(--muted)"}/>
              <div><div className="audience-title">{title}</div><div className="audience-sub">{sub}</div>{id==="circles"&&selected===id?<div className="audience-chips"><span className="audience-chip">Family ×</span><span className="audience-chip">Besties ×</span><span className="audience-chip">+ Add circle</span></div>:null}</div>
            </div>
            <span className="audience-check"><Check size={13}/></span>
          </button>
        ))}
      </div>
      <button className="primary-btn" style={{width:"100%"}} onClick={()=>router.push(`/create?audience=${encodeURIComponent(selected==="circles"?"Family + Besties":options.find(x=>x.id===selected)?.title || "Friends")}`)}>Done</button>
    </PageShell>
  );
}
