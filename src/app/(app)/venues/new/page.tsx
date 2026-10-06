import { PageHeader } from "@/components/app/page-header";
import { requireMember } from "@/lib/auth";
import { getMasters } from "@/lib/data/masters";
import { VenueForm } from "../venue-form";

export const metadata = { title: "会場を登録 | NICOLY CRM" };

export default async function NewVenuePage() {
  await requireMember();
  const masters = await getMasters();
  return (
    <>
      <PageHeader title="会場を登録" back="/venues" />
      <VenueForm areas={masters.areas.filter((a) => a.is_active)} />
    </>
  );
}
