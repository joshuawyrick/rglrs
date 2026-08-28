import { people } from "@/lib/demo-data";

export function AvatarStack({ count = 5, label }: { count?: number; label?: string }) {
  const avatars = Object.values(people).slice(0, Math.min(count, 6));
  return (
    <div className="avatar-stack-wrap">
      <div className="member-stack">
        {avatars.map((p) => <img key={p.name} src={p.avatar} alt="" />)}
      </div>
      {label ? <span className="stack-label">{label}</span> : null}
    </div>
  );
}
