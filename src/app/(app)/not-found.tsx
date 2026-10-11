import { SearchXIcon } from "lucide-react";
import Link from "next/link";
import { StatusScreen } from "@/components/app/status-screen";
import { Button } from "@/components/ui/button";

/** ログイン中に、ない画面・見る権限のない画面を開いたとき（メニューなどはそのまま出す） */
export default function AppNotFound() {
  return (
    <StatusScreen
      icon={<SearchXIcon />}
      title="ページが見つかりません"
      actions={
        <Button asChild>
          <Link href="/">ホームへ</Link>
        </Button>
      }
    >
      消されたか、見る権限のないページです。リンクが古いときは、メニューや上の検索窓から探してください。
    </StatusScreen>
  );
}
