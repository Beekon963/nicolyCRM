import { AppShell } from "@/components/app/app-shell";
import { requireMember } from "@/lib/auth";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireMember();
  return <AppShell user={user}>{children}</AppShell>;
}
