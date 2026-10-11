import { requireOwner } from "@/lib/auth";

/** オーナーのみ（管理者には「見つかりません」）。読み込み中の画面より先に確かめるので、管理者には 404 が返る */
export default async function OwnerOnlyLayout({ children }: LayoutProps<"/money">) {
  await requireOwner();
  return children;
}
