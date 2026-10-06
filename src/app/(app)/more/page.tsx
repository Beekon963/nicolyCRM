import { ChevronRightIcon, LogOutIcon } from "lucide-react";
import Link from "next/link";
import { visibleItems } from "@/components/app/nav-items";
import { PageHeader } from "@/components/app/page-header";
import { requireMember } from "@/lib/auth";

export const metadata = { title: "その他 | NICOLY CRM" };

export default async function MorePage() {
  const user = await requireMember();
  const items = visibleItems(user.role).filter((i) => i.more);
  return (
    <>
      <PageHeader title="その他" description={`${user.name}（${user.role === "owner" ? "オーナー" : "管理者"}）`} />
      <ul className="mx-4 divide-y rounded-lg border">
        {items.map((i) => (
          <li key={i.href}>
            <Link href={i.href} className="flex h-14 items-center gap-3 px-4 hover:bg-accent">
              <i.icon className="size-5 text-muted-foreground" />
              <span className="flex-1">{i.label}</span>
              <ChevronRightIcon className="size-5 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
      <form action="/auth/signout" method="post" className="mx-4 mt-6">
        <button className="flex h-12 w-full items-center justify-center gap-2 rounded-lg border text-muted-foreground">
          <LogOutIcon className="size-5" />
          ログアウト
        </button>
      </form>
    </>
  );
}
