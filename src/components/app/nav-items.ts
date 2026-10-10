import {
  BarChart3Icon,
  BuildingIcon,
  CalendarCheckIcon,
  CalendarDaysIcon,
  ClipboardCheckIcon,
  FileClockIcon,
  HomeIcon,
  MapPinIcon,
  MenuIcon,
  ReceiptIcon,
  SettingsIcon,
  UploadIcon,
  UsersIcon,
  WalletIcon,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  ownerOnly?: boolean;
  /** スマホの下部タブに出す */
  tab?: boolean;
  /** PC のサイドバーに出す */
  sidebar?: boolean;
  /** スマホの「その他」に出す */
  more?: boolean;
  /** まだ作っていない画面（フェーズ） */
  phase?: number;
};

// 要件 §5: スマホは下部タブ「ホーム / 現場 / スタッフ / 営業 / その他」、PC はサイドバーに同じ項目＋お金・設定
export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "ホーム", icon: HomeIcon, tab: true, sidebar: true },
  { href: "/events", label: "現場", icon: CalendarDaysIcon, tab: true, sidebar: true },
  { href: "/staff", label: "スタッフ", icon: UsersIcon, tab: true, sidebar: true },
  { href: "/sales", label: "営業", icon: BuildingIcon, tab: true, sidebar: true },
  { href: "/venues", label: "会場", icon: MapPinIcon, sidebar: true, more: true },
  { href: "/results", label: "実績確認", icon: ClipboardCheckIcon, sidebar: true, more: true },
  { href: "/analysis", label: "実績の分析", icon: BarChart3Icon, sidebar: true, more: true },
  { href: "/expenses", label: "交通費・経費の承認", icon: ReceiptIcon, sidebar: true, more: true },
  { href: "/availability", label: "稼働可能日の提出状況", icon: CalendarCheckIcon, sidebar: true, more: true },
  { href: "/money", label: "お金", icon: WalletIcon, ownerOnly: true, sidebar: true, more: true, phase: 3 },
  { href: "/import", label: "データ取り込み", icon: UploadIcon, ownerOnly: true, sidebar: true, more: true },
  { href: "/audit", label: "変更履歴", icon: FileClockIcon, ownerOnly: true, sidebar: true, more: true },
  { href: "/settings", label: "設定", icon: SettingsIcon, ownerOnly: true, sidebar: true, more: true },
];

export const MORE_TAB: NavItem = { href: "/more", label: "その他", icon: MenuIcon, tab: true };

export function visibleItems(role: "owner" | "manager") {
  return NAV_ITEMS.filter((i) => (!i.ownerOnly || role === "owner") && !(i.phase && i.phase > 1));
}

export function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}
