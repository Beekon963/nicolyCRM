import { requireOwner } from "@/lib/auth";

/** 設定はオーナーのみ（管理者には「見つかりません」） */
export default async function SettingsLayout({ children }: LayoutProps<"/settings">) {
  await requireOwner();
  return children;
}
