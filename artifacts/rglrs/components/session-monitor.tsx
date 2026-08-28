"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const publicPaths = new Set(["/login", "/signup", "/forgot-password", "/reset-password", "/auth/callback", "/welcome", "/service-unavailable"]);

export function SessionMonitor() {
  const router = useRouter();
  const pathname = usePathname();
  const redirecting = useRef(false);
  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      // Some GoTrue versions emit USER_DELETED even though older client typings omit it.
      if ((event === "SIGNED_OUT" || (event as string) === "USER_DELETED") && !publicPaths.has(pathname) && !redirecting.current) {
        redirecting.current = true;
        router.replace("/login?expired=1");
        router.refresh();
      }
    });
    return () => subscription.unsubscribe();
  }, [pathname, router]);
  return null;
}