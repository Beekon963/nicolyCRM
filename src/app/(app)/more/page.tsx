import { ChevronRightIcon, LogOutIcon } from "lucide-react";
import Link from "next/link";
import { CountBadge } from "@/components/app/count-badge";
import { NAV_GROUPS, visibleItems } from "@/components/app/nav-items";
import { PageHeader } from "@/components/app/page-header";
import { requireMember } from "@/lib/auth";
import { getMenuCounts } from "@/lib/data/home";

export const metadata = { title: "その他 | NICOLY CRM" };

export default async function MorePage() {
  const user = await requireMember();
  const items = visibleItems(user.role).filter((i) => i.more);
  const counts = await getMenuCounts();
  return (
    <>
      <PageHeader title="その他" description={`${user.name}（${user.role === "owner" ? "オーナー" : "管理者"}）`} />
      {/* 見出しごとにまとめる（毎日の作業 / 管理 / 設定・記録） */}
      <div className="flex flex-col gap-5">
        {NAV_GROUPS.map((g) => {
          const list = items.filter((i) => i.group === g.key);
          if (!list.length) return null;
          return (
            <section key={g.key} className="mx-4">
              <h2 className="mb-1.5 px-1 text-sm font-semibold text-muted-foreground">{g.label}</h2>
              <ul className="divide-y overflow-hidden rounded-2xl border bg-card shadow-card">
                {list.map((i) => (
                  <li key={i.href}>
                    <Link href={i.href} className="flex h-14 items-center gap-3 px-4 transition-colors hover:bg-accent">
                      <span className="grid size-9 place-items-center rounded-xl bg-brand-50">
                        <i.icon className="size-5 text-primary" />
                      </span>
                      <span className="flex-1 font-medium">{i.label}</span>
                      {/* 待っている件数（締切を過ぎたものは赤、それ以外は黄） */}
                      {counts[i.href] && <CountBadge count={counts[i.href].count} late={counts[i.href].late} label={i.label} />}
                      <ChevronRightIcon className="size-5 text-[#98a2b3]" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      <form action="/auth/signout" method="post" className="mx-4 mt-6">
        <button className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border bg-card font-medium text-muted-foreground shadow-card hover:bg-accent">
          <LogOutIcon className="size-5" />
          ログアウト
        </button>
      </form>
    </>
  );
}
