export function AvatarStack({ count = 5, label, avatars }: { count?: number; label?: string; avatars?: string[] }) {
  const sources = avatars ?? [];
  const visible = sources.slice(0, Math.min(count, 6));
  return (
    <div className="avatar-stack-wrap">
      <div className="member-stack">
        {visible.map((src, index) => <img key={`${src}-${index}`} src={src} alt="" />)}
      </div>
      {label ? <span className="stack-label">{label}</span> : null}
    </div>
  );
}
