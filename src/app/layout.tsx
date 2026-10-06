import type { Metadata, Viewport } from "next";
import { Toaster } from "@/components/ui/toaster";
import "./globals.css";

export const metadata: Metadata = {
  title: "NICOLY CRM",
  appleWebApp: { capable: true, title: "NICOLY", statusBarStyle: "default" },
  description: "NICOLY 社内CRM",
  // 社内ツールのため検索エンジンに載せない（robots.txt と併用）
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
