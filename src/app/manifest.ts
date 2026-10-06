import type { MetadataRoute } from "next";

/** 管理画面の PWA 設定（ホーム画面に追加できる）。マイページは /m/[鍵]/manifest.webmanifest */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "NICOLY CRM",
    short_name: "NICOLY",
    description: "NICOLY 社内CRM",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    lang: "ja",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
