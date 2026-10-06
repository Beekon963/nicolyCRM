import { ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";

export const metadata = { title: "設定 | NICOLY CRM" };

const ITEMS = [
  { href: "/settings/users", label: "ユーザー", description: "管理者の招待・無効化" },
  { href: "/settings/masters/roles", label: "役割", description: "クローザー / キャッチャー / ディレクター など" },
  { href: "/settings/masters/items", label: "獲得項目", description: "実績報告で数える項目" },
  { href: "/settings/masters/ranks", label: "ランク", description: "ランクの並びと基準日当" },
  { href: "/settings/masters/areas", label: "エリア", description: "スタッフの対応エリア・会場のエリア" },
  { href: "/settings/templates", label: "文面テンプレート", description: "打診・確定連絡・前日リマインドなどの文面" },
  { href: "/settings/general", label: "締切・会社情報", description: "稼働可能日の締切日、実績報告の期限、会社情報" },
];

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="設定" description="オーナーだけが変更できます" />
      <ul className="mx-4 divide-y rounded-lg border">
        {ITEMS.map((i) => (
          <li key={i.href}>
            <Link href={i.href} className="flex min-h-16 items-center gap-3 px-4 py-2 hover:bg-accent">
              <div className="flex-1">
                <p className="font-medium">{i.label}</p>
                <p className="text-sm text-muted-foreground">{i.description}</p>
              </div>
              <ChevronRightIcon className="size-5 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
      <p className="mx-4 mt-4 text-sm text-muted-foreground">
        インセンティブ単価・税・源泉・月次目標の設定は Phase 3（お金）で追加します。
      </p>
    </>
  );
}
