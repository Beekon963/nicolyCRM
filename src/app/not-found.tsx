import Image from "next/image";
import Link from "next/link";
import { StatusScreen } from "@/components/app/status-screen";
import { Button } from "@/components/ui/button";

export const metadata = { title: "ページが見つかりません | NICOLY" };

/** URL がどの画面にも当たらないとき（ログインしていない人にも出る） */
export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center">
      <Image src="/logo.png" alt="NICOLY" width={72} height={56} className="mb-2" />
      <StatusScreen
        title="ページが見つかりません"
        className="pt-4"
        actions={
          <Button asChild>
            <Link href="/">トップへ</Link>
          </Button>
        }
      >
        URL がまちがっているか、ページがなくなっています。スタッフの方は、LINE で届いたマイページの URL を開き直してください。
      </StatusScreen>
    </main>
  );
}
