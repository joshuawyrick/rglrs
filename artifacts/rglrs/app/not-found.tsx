import Link from "next/link";
import { BrandMark } from "@/components/brand";

export default function NotFoundPage() {
  return (
    <main className="splash-shell">
      <BrandMark size={82} />
      <h1>Page not found</h1>
      <p>This page doesn’t exist or is no longer available.</p>
      <Link href="/" className="primary-btn" style={{ marginTop: 24, minWidth: 150 }}>
        Go home
      </Link>
    </main>
  );
}