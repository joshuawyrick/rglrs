"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Crosshair, MapPin, Radio, Shield, UserPlus, UsersRound } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { loadGoogleMaps } from "@/lib/google-maps-client";
import styles from "./whats-crackin.module.css";

type Tab = "map" | "near" | "friends";
type Audience = "friends" | "selected" | "event" | "everyone" | "anonymous";
type Precision = "precise" | "approximate";
type NearbyPoint = {
  pin_id: string;
  user_id: string | null;
  display_name: string | null;
  username: string | null;
  avatar_upload_id: string | null;
  latitude: number;
  longitude: number;
  distance_m: number;
  presence_state: "live" | "checkin";
  captured_at: string;
  place_label: string | null;
  is_friend: boolean;
  is_anonymous: boolean;
  audience: Audience;
};
type ShareState = {
  active?: boolean;
  session_id?: string;
  audience?: Audience;
  precision?: Precision;
  event_id?: string | null;
  share_until?: string | null;
  checkin_ttl_minutes?: number;
  place_label?: string | null;
  last_update?: string | null;
  target_ids?: string[];
};
type Friend = { id: string; name: string };
type EventChoice = { id: string; title: string; ends_at: string | null };
type Coordinates = { lat: number; lng: number; accuracy: number; capturedAt: string };

function currentPosition(): Promise<Coordinates> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("Location is not available on this device."));
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy, capturedAt: new Date(position.timestamp).toISOString() }),
      () => reject(new Error("Allow location access to use What’s Crackin.")),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 20000 },
    );
  });
}
function timeAgo(value: string | null | undefined) {
  if (!value) return "not updated yet";
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}
function distanceLabel(point: NearbyPoint) {
  const miles = point.distance_m / 1609.344;
  if (point.is_anonymous || point.audience === "everyone") {
    if (miles < 1) return "Within 1 mile";
    if (miles < 3) return "1–3 miles away";
    if (miles < 5) return "3–5 miles away";
    if (miles < 10) return "5–10 miles away";
    return "10+ miles away";
  }
  return `${Math.max(0.1, miles).toFixed(miles < 10 ? 1 : 0)} mi away`;
}
function markerSvg(label: string, anonymous = false) {
  const safe = label.replace(/[^A-Z0-9]/gi, "").slice(0, 1).toUpperCase() || "R";
  const dash = anonymous ? 'stroke-dasharray="4 3"' : "";
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><circle cx="24" cy="24" r="21" fill="#10171b" stroke="#44d9cb" stroke-width="3" ${dash}/><text x="24" y="30" text-anchor="middle" font-family="Arial" font-size="17" font-weight="700" fill="#44d9cb">${safe}</text></svg>`)}`;
}

export function WhatsCrackin() {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [tab, setTab] = useState<Tab>("map");
  const [share, setShare] = useState<ShareState>({ active: false, target_ids: [] });
  const [audience, setAudience] = useState<Audience>("friends");
  const [precision, setPrecision] = useState<Precision>("approximate");
  const [duration, setDuration] = useState("60");
  const [checkin, setCheckin] = useState("120");
  const [placeLabel, setPlaceLabel] = useState("");
  const [selectedFriends, setSelectedFriends] = useState<string[]>([]);
  const [eventId, setEventId] = useState("");
  const [publicAck, setPublicAck] = useState(false);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [events, setEvents] = useState<EventChoice[]>([]);
  const [position, setPosition] = useState<Coordinates | null>(null);
  const [points, setPoints] = useState<NearbyPoint[]>([]);
  const [selected, setSelected] = useState<NearbyPoint | null>(null);
  const [radiusMiles, setRadiusMiles] = useState(10);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [mapError, setMapError] = useState("");
  const [connected, setConnected] = useState<Set<string>>(new Set());
  const mapNode = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const lastPushRef = useRef(0);

  const loadShare = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase.rpc("get_my_location_sharing_secure");
    if (error) return setMessage(error.message || "Could not load location sharing.");
    const next = (data || { active: false, target_ids: [] }) as ShareState;
    setShare(next);
    if (next.audience) setAudience(next.audience);
    if (next.precision) setPrecision(next.precision);
    if (next.event_id) setEventId(next.event_id);
    if (next.target_ids) setSelectedFriends(next.target_ids);
    if (next.checkin_ttl_minutes !== undefined) setCheckin(String(next.checkin_ttl_minutes));
    if (next.place_label !== undefined) setPlaceLabel(next.place_label || "");
  }, [supabase]);

  const loadChoices = useCallback(async () => {
    if (!supabase) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const friendshipResult = await supabase.from("friendships").select("requester_id,addressee_id").eq("status","accepted").or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`).limit(300);
    const friendIds = [...new Set((friendshipResult.data || []).map((row) => row.requester_id === user.id ? row.addressee_id : row.requester_id))];
    if (friendIds.length) {
      const profileResult = await supabase.from("profiles").select("id,display_name").in("id",friendIds).order("display_name");
      setFriends((profileResult.data || []).map((profile) => ({ id: profile.id, name: profile.display_name })));
    } else setFriends([]);
    const memberships = await supabase.from("event_members").select("event_id").eq("user_id",user.id).limit(300);
    const eventIds = [...new Set((memberships.data || []).map((row) => row.event_id))];
    if (eventIds.length) {
      const eventResult = await supabase.from("events").select("id,title,ends_at").in("id",eventIds).order("starts_at", { ascending: true });
      setEvents((eventResult.data || []).filter((event) => !event.ends_at || new Date(event.ends_at).getTime() > Date.now()).map((event) => ({ id:event.id, title:event.title, ends_at:event.ends_at })));
    } else setEvents([]);
  }, [supabase]);

  const loadNearby = useCallback(async (where?: Coordinates) => {
    if (!supabase) return;
    const center = where || position;
    if (!center) return;
    const { data, error } = await supabase.rpc("get_whats_crackin_nearby", {
      p_lat:center.lat, p_lng:center.lng, p_radius_m:Math.round(radiusMiles * 1609.344),
    });
    if (error) return setMessage(error.message || "Could not load nearby RGLRS.");
    setPoints((data || []) as NearbyPoint[]);
  }, [position, radiusMiles, supabase]);

  const pushPosition = useCallback(async (where: Coordinates) => {
    if (!supabase) return;
    const now = Date.now();
    if (now - lastPushRef.current < 15000) return;
    lastPushRef.current = now;
    setPosition(where);
    const { error } = await supabase.rpc("update_my_location_secure", {
      p_lat:where.lat,p_lng:where.lng,p_accuracy_m:Math.min(5000,Math.max(0,where.accuracy)),p_captured_at:where.capturedAt,
    });
    if (error) setMessage(error.message || "Could not update your location.");
    else void loadNearby(where);
  }, [loadNearby, supabase]);

  useEffect(() => { void loadShare(); void loadChoices(); }, [loadShare, loadChoices]);
  useEffect(() => {
    void currentPosition().then((where) => { setPosition(where); void loadNearby(where); }).catch(() => undefined);
  }, [loadNearby]);

  useEffect(() => {
    if (!share.active || !navigator.geolocation) return;
    const watch = navigator.geolocation.watchPosition(
      (geo) => void pushPosition({ lat:geo.coords.latitude,lng:geo.coords.longitude,accuracy:geo.coords.accuracy,capturedAt:new Date(geo.timestamp).toISOString() }),
      () => setMessage("Live updates paused. Your last check-in will remain visible only for the time you chose."),
      { enableHighAccuracy:true, maximumAge:15000, timeout:20000 },
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, [pushPosition, share.active]);

  useEffect(() => {
    if (!position) return;
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void loadNearby(); }, 30000);
    return () => window.clearInterval(timer);
  }, [loadNearby, position]);

  useEffect(() => {
    if (tab !== "map" || !mapNode.current || !position) return;
    let cancelled = false;
    void loadGoogleMaps().then((maps) => {
      if (cancelled || !mapNode.current) return;
      setMapError("");
      if (!mapRef.current) mapRef.current = new maps.Map(mapNode.current, { center:{lat:position.lat,lng:position.lng},zoom:13,disableDefaultUI:true,zoomControl:true,gestureHandling:"greedy" });
      else mapRef.current.setCenter({lat:position.lat,lng:position.lng});
      markersRef.current.forEach((marker) => marker.setMap(null));
      markersRef.current = [];
      const me = new maps.Marker({ map:mapRef.current, position:{lat:position.lat,lng:position.lng}, title:"You", zIndex:999, icon:{ path:maps.SymbolPath.CIRCLE,scale:7,fillColor:"#44d9cb",fillOpacity:1,strokeColor:"#ffffff",strokeWeight:2 } });
      markersRef.current.push(me);
      points.forEach((point) => {
        const avatarUrl = point.avatar_upload_id ? `/private-media/avatar/${point.avatar_upload_id}` : markerSvg(point.display_name || "R", point.is_anonymous);
        const marker = new maps.Marker({
          map:mapRef.current,position:{lat:point.latitude,lng:point.longitude},title:point.display_name || "RGLR nearby",
          icon:{url:avatarUrl,scaledSize:new maps.Size(44,44),anchor:new maps.Point(22,22)},
        });
        marker.addListener("click", () => setSelected(point));
        markersRef.current.push(marker);
      });
    }).catch((error) => setMapError(error instanceof Error ? error.message : "Map unavailable."));
    return () => { cancelled=true; };
  }, [points, position, tab]);

  async function startSharing() {
    if (!supabase) return setMessage("Location sharing is unavailable.");
    if (audience === "selected" && !selectedFriends.length) return setMessage("Choose at least one friend.");
    if (audience === "event" && !eventId) return setMessage("Choose an event.");
    if ((audience === "everyone" || audience === "anonymous") && !publicAck) return setMessage("Confirm the public-discovery notice first.");
    setBusy(true); setMessage("");
    try {
      const where = await currentPosition();
      const { error } = await supabase.rpc("start_location_sharing_secure", {
        p_audience:audience,p_precision:audience === "anonymous" ? "approximate" : precision,
        p_event_id:audience === "event" ? eventId : null,p_target_ids:audience === "selected" ? selectedFriends : [],
        p_duration_minutes:duration === "until" ? null : Number(duration),p_checkin_ttl_minutes:Number(checkin),
        p_place_label:placeLabel.trim() || null,p_public_discovery_ack:publicAck,
      });
      if (error) throw error;
      lastPushRef.current = 0;
      await pushPosition(where);
      await loadShare();
      setMessage("You’re on What’s Crackin. RGLRS will label stale positions as last check-ins.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not start location sharing.");
    } finally { setBusy(false); }
  }

  async function stopSharing() {
    if (!supabase) return;
    setBusy(true); setMessage("");
    const { error } = await supabase.rpc("stop_location_sharing_secure");
    setBusy(false);
    if (error) return setMessage(error.message || "Could not stop sharing.");
    setShare({active:false,target_ids:[]}); setPoints((current) => current); setMessage("Location sharing stopped. Your pin was removed immediately.");
  }

  async function connect(point: NearbyPoint) {
    if (!supabase || !point.user_id) return;
    const { error } = await supabase.rpc("create_friend_request_secure", { p_addressee:point.user_id });
    if (error) return setMessage(error.message || "Could not send a connection request.");
    setConnected((current) => new Set(current).add(point.user_id as string));
    setMessage(`Connection request sent to ${point.display_name || "this RGLR"}.`);
  }

  const visiblePoints = tab === "friends" ? points.filter((point) => point.is_friend) : points;
  const sharingLabel = share.active
    ? `${share.audience === "anonymous" ? "Anonymous nearby" : share.audience?.replace("selected","Selected friends").replace("event","Event members").replace("everyone","Everyone on RGLRS").replace("friends","Friends") || "Sharing"} · ${share.last_update ? `updated ${timeAgo(share.last_update)}` : "waiting for GPS"}`
    : "Your location is off";

  return <div className={styles.wrap}>
    <div className={styles.hero}>
      <h1>What’s Crackin</h1>
      <p>See the RGLRS who chose to share nearby. Live means current; older foreground updates are always labeled as a last check-in.</p>
    </div>

    <div className={styles.statusCard}>
      <div className={styles.statusLeft}><span className={share.active ? styles.pulse : styles.badge}><Radio size={12}/></span><div><div className={styles.statusTitle}>{share.active ? "Sharing location" : "Location sharing off"}</div><div className={styles.statusSub}>{sharingLabel}</div></div></div>
      {share.active ? <button type="button" className={styles.danger} onClick={() => void stopSharing()} disabled={busy}>Stop</button> : null}
    </div>

    <section className={styles.shareCard}>
      <div className={styles.shareGrid}>
        <label className={styles.label}>Who can see me
          <select className={styles.select} value={audience} onChange={(e) => { const next=e.target.value as Audience; setAudience(next); if(next==="anonymous")setPrecision("approximate"); }}>
            <option value="friends">Friends</option><option value="selected">Selected friends</option><option value="event">An event</option><option value="everyone">Everyone on RGLRS</option><option value="anonymous">Anonymous nearby</option>
          </select>
        </label>
        <label className={styles.label}>Location precision
          <select className={styles.select} value={precision} disabled={audience==="anonymous"} onChange={(e)=>setPrecision(e.target.value as Precision)}>
            <option value="approximate">Approximate</option><option value="precise">Precise</option>
          </select>
        </label>
        <label className={styles.label}>Share for
          <select className={styles.select} value={duration} onChange={(e)=>setDuration(e.target.value)}><option value="15">15 minutes</option><option value="60">1 hour</option><option value="480">8 hours</option><option value="until">Until I turn it off</option></select>
        </label>
        <label className={styles.label}>Last check-in
          <select className={styles.select} value={checkin} onChange={(e)=>setCheckin(e.target.value)}><option value="0">Hide when not live</option><option value="30">Keep for 30 minutes</option><option value="120">Keep for 2 hours</option><option value="480">Keep for 8 hours</option></select>
        </label>
        <label className={`${styles.label} ${styles.full}`}>Current place label <span style={{fontWeight:400}}>(optional; hidden from public/anonymous discovery)</span>
          <input className={styles.input} value={placeLabel} maxLength={120} onChange={(e)=>setPlaceLabel(e.target.value)} placeholder="MGM Grand, Main Stage, tailgate…"/>
        </label>
        {audience === "selected" ? <div className={`${styles.label} ${styles.full}`}>Selected friends<div className={styles.friendPicker}>{friends.length ? friends.map((friend)=><label className={styles.friendRow} key={friend.id}><input type="checkbox" checked={selectedFriends.includes(friend.id)} onChange={(e)=>setSelectedFriends((current)=>e.target.checked?[...current,friend.id]:current.filter((id)=>id!==friend.id))}/><span>{friend.name}</span></label>) : <span>No accepted friends yet.</span>}</div></div> : null}
        {audience === "event" ? <label className={`${styles.label} ${styles.full}`}>Event
          <select className={styles.select} value={eventId} onChange={(e)=>setEventId(e.target.value)}><option value="">Choose an event…</option>{events.map((event)=><option value={event.id} key={event.id}>{event.title}</option>)}</select>
        </label> : null}
        {(audience === "everyone" || audience === "anonymous") ? <label className={`${styles.check} ${styles.full}`}><input type="checkbox" checked={publicAck} onChange={(e)=>setPublicAck(e.target.checked)}/><span>I understand this can make my location visible to signed-in RGLRS I don’t know. Anonymous mode hides my identity and always uses an approximate map point.</span></label> : null}
        <p className={`${styles.privacyHint} ${styles.full}`}><Shield size={12}/> Blocks and person-specific location denials always win. Exact coordinates stay behind server authorization; approximate/anonymous viewers receive a privacy-shifted point.</p>
      </div>
      <div className={styles.actions} style={{marginTop:12}}>
        <button type="button" className={styles.primary} onClick={() => void startSharing()} disabled={busy}><MapPin size={16}/>{busy ? "Working…" : share.active ? "Update sharing" : "Share my location"}</button>
        <button type="button" className={styles.secondary} onClick={() => void currentPosition().then((where)=>{setPosition(where);void loadNearby(where);}).catch((error)=>setMessage(error.message))}><Crosshair size={16}/>Refresh nearby</button>
      </div>
    </section>

    <div className={styles.tabs}>
      <button type="button" className={`${styles.tab} ${tab==="map"?styles.activeTab:""}`} onClick={()=>setTab("map")}>Map</button>
      <button type="button" className={`${styles.tab} ${tab==="near"?styles.activeTab:""}`} onClick={()=>setTab("near")}>Near You</button>
      <button type="button" className={`${styles.tab} ${tab==="friends"?styles.activeTab:""}`} onClick={()=>setTab("friends")}>Friends</button>
    </div>

    <div className={styles.actions}>
      <span className={styles.badge}><UsersRound size={12}/>{visiblePoints.length} sharing nearby</span>
      <label className={styles.label}>Radius
        <select className={styles.select} value={radiusMiles} onChange={(e)=>setRadiusMiles(Number(e.target.value))}><option value={1}>1 mi</option><option value={5}>5 mi</option><option value={10}>10 mi</option><option value={25}>25 mi</option></select>
      </label>
    </div>

    {message ? <div className="form-message" role="status">{message}</div> : null}

    {tab === "map" ? <div className={styles.mapShell}>
      {position ? <div ref={mapNode} className={styles.map}/> : <div className={styles.mapFallback}>Allow location access to center the map and find nearby RGLRS.</div>}
      {mapError ? <div className={styles.mapFallback}>{mapError}<br/>Near You still works once location access is enabled.</div> : null}
      {selected ? <div className={styles.selectedCard}><Avatar point={selected}/><div className={styles.personBody}><div className={styles.personName}>{selected.display_name || "RGLR nearby"}</div><div className={styles.personMeta}>{selected.presence_state === "live" ? "Live" : "Last check-in"} · {timeAgo(selected.captured_at)} · {distanceLabel(selected)}{selected.place_label ? ` · ${selected.place_label}` : ""}</div></div>{selected.user_id && !selected.is_friend ? <button className={styles.connect} type="button" onClick={()=>void connect(selected)} disabled={connected.has(selected.user_id)}>{connected.has(selected.user_id)?"Sent":"Connect"}</button>:null}</div> : null}
      <div className={styles.mapNote}>Public and anonymous distances are shown as ranges. A stale pin is never presented as live.</div>
    </div> : <PeopleList points={visiblePoints} connected={connected} onConnect={connect}/>} 
  </div>;
}

function Avatar({ point }: { point: NearbyPoint }) {
  if (point.avatar_upload_id) return <img className={styles.avatar} src={`/private-media/avatar/${point.avatar_upload_id}`} alt=""/>;
  return <div className={styles.avatarFallback}>{point.is_anonymous ? "R" : (point.display_name || "R").slice(0,1).toUpperCase()}</div>;
}
function PeopleList({ points, connected, onConnect }: { points: NearbyPoint[]; connected:Set<string>; onConnect:(point:NearbyPoint)=>Promise<void> }) {
  if (!points.length) return <div className={styles.empty}>Nobody you’re allowed to see is sharing nearby right now.</div>;
  return <div className={styles.list}>{points.map((point)=><div className={styles.personCard} key={point.pin_id}><Avatar point={point}/><div className={styles.personBody}><div className={styles.personName}>{point.display_name || "RGLR nearby"}</div><div className={styles.personMeta}>{point.presence_state === "live" ? "Live" : "Last check-in"} · {timeAgo(point.captured_at)} · {distanceLabel(point)}{point.place_label ? ` · ${point.place_label}` : ""}</div></div>{point.user_id && !point.is_friend ? <button className={styles.connect} type="button" onClick={()=>void onConnect(point)} disabled={connected.has(point.user_id)}><UserPlus size={13}/>{connected.has(point.user_id)?"Sent":"Connect"}</button>:null}</div>)}</div>;
}
