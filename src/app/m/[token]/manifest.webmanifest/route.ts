/** マイページをホーム画面に追加したとき、本人のページが開くようにする（開始URLに鍵を含める） */
export async function GET(_req: Request, ctx: RouteContext<"/m/[token]/manifest.webmanifest">) {
  const { token } = await ctx.params;
  const start = `/m/${encodeURIComponent(token)}`;
  return Response.json(
    {
      name: "NICOLY マイページ",
      short_name: "NICOLY",
      start_url: start,
      scope: start,
      display: "standalone",
      background_color: "#ffffff",
      theme_color: "#ffffff",
      lang: "ja",
      icons: [
        { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
        { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    },
    { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" } },
  );
}
