import { requireOwner } from "@/lib/auth";

/** ★ 会社の経費はオーナーだけ（管理者には「見つかりません」）。読み込み中の画面より先に確かめるので、管理者には 404 が返る */
export default async function CompanyExpensesLayout({ children }: LayoutProps<"/company-expenses">) {
  await requireOwner();
  return <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col">{children}</div>;
}
