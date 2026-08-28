export function BrandMark({ size = 36 }: { size?: number }) {
  return <img className="brand-mark" src="/icon.svg" alt="RGLRS" width={size} height={size} />;
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand-logo">
      {!compact && <BrandMark size={38} />}
      <span className="brand-word">RGLRS</span>
    </div>
  );
}
