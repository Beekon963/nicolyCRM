import { requireOwner } from "@/lib/auth";

/** オーナーのみ（管理者には「見つかりません」）。読み込み中の画面より先に確かめるので、管理者には 404 が返る */
export default async function OwnerOnlyLayout({ children }: LayoutProps<"/money">) {
  await requireOwner();
  // PC の広い画面では幅をおさえる（名前と金額が離れすぎて、となりの行と読みまちがえないように）
  return <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col">{children}</div>;
}
