import Link from "next/link";
import { BrandMark } from "@/components/brand";

export default function ServiceUnavailablePage() {
  return (
    <div className="splash-shell">
      <BrandMark size={82} />
      <h1>We’ll be right back</h1>
      <p>RGLRS could not safely connect to its private data service.</p>
      <Link href="/" className="primary-btn" style={{ marginTop: 24, minWidth: 150 }}>
        Try again
      </Link>
    </div>
  );
}