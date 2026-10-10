import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * すべての画面の前に動く処理。
 * - ログイン状態（Supabase のセッション）を更新する
 * - ログインしていない人が管理画面を開いたらログイン画面へ移す（本当の防御は RLS）
 * - マイページ・見るだけリンクは URL の鍵が漏れないよう Referrer を送らない・キャッシュしない
 */
const PUBLIC_PATHS = ["/login", "/auth/", "/m/", "/s/", "/manifest.webmanifest", "/robots.txt", "/icons/", "/logo.png"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // マイページと稼働表の見るだけリンク（ログイン不要。鍵が漏れないよう Referrer を送らない・キャッシュしない）
  if (pathname.startsWith("/m/") || pathname.startsWith("/s/")) {
    const res = NextResponse.next();
    res.headers.set("Referrer-Policy", "no-referrer");
    res.headers.set("Cache-Control", "private, no-store");
    res.headers.set("X-Robots-Tag", "noindex, nofollow");
    return res;
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          Object.entries(headers ?? {}).forEach(([k, v]) => response.headers.set(k, v));
        },
      },
    },
  );

  const { data } = await supabase.auth.getClaims();
  const loggedIn = Boolean(data?.claims?.sub);

  if (!loggedIn && !PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p))) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + request.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }

  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}

export const config = {
  matcher: [
    // 静的ファイル・画像以外
    "/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)",
  ],
};
