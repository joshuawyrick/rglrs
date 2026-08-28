import Link from "next/link";
import { ChevronLeft } from "lucide-react";

export function MobileHeader({
  title,
  backHref,
  right
}: {
  title: string;
  backHref?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="screen-header">
      <div className="screen-header-side">
        {backHref ? (
          <Link className="screen-icon-btn" href={backHref} aria-label="Back">
            <ChevronLeft size={21} />
          </Link>
        ) : null}
      </div>
      <div className="screen-header-title">{title}</div>
      <div className="screen-header-side right">{right}</div>
    </div>
  );
}
