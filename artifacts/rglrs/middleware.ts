import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const publicPaths = new Set(["/welcome", "/login", "/signup", "/forgot-password", "/reset-password", "/auth/callback", "/service-unavailable", "/manifest.webmanifest", "/sw.js"]);

function isPublicPath(pathname: string) {
  const isInvitePreview = /^\/invite\/[A-Za-z0-9_-]{40,100}$/.test(pathname);
  return publicPaths.has(pathname) || isInvitePreview || pathname.startsWith("/event-invites/") || pathname.startsWith("/_next/") || pathname === "/icon.svg" || pathname === "/apple-touch-icon.png";
}

function isJsonApiPath(pathname: string) {
  return pathname.startsWith("/api/") || pathname.startsWith("/event-invites/") || pathname.startsWith("/private-media/") || pathname === "/account-data" || pathname.startsWith("/account-data/");
}

function serviceUnavailable(request: NextRequest) {
  if (isJsonApiPath(request.nextUrl.pathname)) {
    return NextResponse.json({ error: "Service temporarily unavailable" }, { status: 503 });
  }
  return NextResponse.rewrite(new URL("/service-unavailable", request.url), {
    status: 503,
  });
}

function isAuthServiceFailure(error: { name?: string; status?: number } | null) {
  if (!error) return false;
  return error.name === "AuthRetryableFetchError" || (error.status ?? 0) >= 500;
}

export async function middleware(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const pathname = request.nextUrl.pathname;
  if (pathname === "/private-media/cleanup") return NextResponse.next();

  if (!url || !key) {
    if (process.env.NODE_ENV === "production" && !isPublicPath(pathname)) {
      return serviceUnavailable(request);
    }
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet: { name: string; value: string; options: CookieOptions }[]) => {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  let user = null;
  try {
    const result = await supabase.auth.getUser();
    user = result.data.user;
    if (
      process.env.NODE_ENV === "production" &&
      !isPublicPath(pathname) &&
      isAuthServiceFailure(result.error)
    ) {
      return serviceUnavailable(request);
    }
  } catch {
    if (process.env.NODE_ENV === "production" && !isPublicPath(pathname)) {
      return serviceUnavailable(request);
    }
  }
  if (!user && !isPublicPath(pathname)) {
    if (isJsonApiPath(pathname)) {
      const unauthorizedResponse = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      response.cookies.getAll().forEach((cookie) => unauthorizedResponse.cookies.set(cookie));
      return unauthorizedResponse;
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    const redirectResponse = NextResponse.redirect(loginUrl);
    response.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie));
    return redirectResponse;
  }
  if (user && (pathname === "/login" || pathname === "/signup" || pathname === "/welcome")) {
    const homeResponse = NextResponse.redirect(new URL("/", request.url));
    response.cookies.getAll().forEach((cookie) => homeResponse.cookies.set(cookie));
    return homeResponse;
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};