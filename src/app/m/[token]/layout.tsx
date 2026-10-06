import type { Metadata } from "next";
import Image from "next/image";
import { getMe } from "@/lib/mypage";
import { MypageTabs } from "./mypage-tabs";

/** スタッフ用マイページ（ログイン不要、要件 §4.5）。スマホ前提、1画面1目的、大きなボタン */
export async function generateMetadata({ params }: LayoutProps<"/m/[token]">): Promise<Metadata> {
  const { token } = await params;
  return {
    title: "マイページ | NICOLY",
    robots: { index: false, follow: false, nocache: true },
    referrer: "no-referrer",
    manifest: `/m/${token}/manifest.webmanifest`,
    appleWebApp: { capable: true, title: "NICOLY", statusBarStyle: "default" },
  };
}

export default async function MypageLayout({ children, params }: LayoutProps<"/m/[token]">) {
  const { token } = await params;
  const me = await getMe(token);

  if (!me.ok) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center">
        <Image src="/logo.png" alt="" width={80} height={62} />
        <h1 className="text-xl font-bold">マイページを開けません</h1>
        <p className="text-muted-foreground">{me.error}</p>
      </main>
    );
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col">
      <header className="sticky top-0 z-30 flex items-center gap-2 border-b bg-background/95 px-4 py-2 backdrop-blur">
        <Image src="/logo.png" alt="" width={36} height={28} />
        <p className="flex-1 truncate font-bold">{me.data.name}さんのマイページ</p>
      </header>
      <main className="flex flex-1 flex-col px-4 pt-4 pb-24">{children}</main>
      <MypageTabs token={token} offers={me.data.offers} reports={me.data.reports} />
    </div>
  );
}
