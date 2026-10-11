import { AppShell } from "@/components/app/app-shell";
import { aiConfigured } from "@/lib/ai/config";
import { requireMember } from "@/lib/auth";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireMember();
  return (
    <AppShell user={user} aiReady={aiConfigured()}>
      {children}
    </AppShell>
  );
}
