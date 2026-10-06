import { PageHeader } from "@/components/app/page-header";
import { requireMember } from "@/lib/auth";

export const metadata = { title: "ホーム | NICOLY CRM" };

export default async function HomePage() {
  const user = await requireMember();
  return <PageHeader title="ホーム" description={`${user.name}さん、おつかれさまです`} />;
}
