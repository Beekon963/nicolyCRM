import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { requireMember } from "@/lib/auth";
import { getMasters } from "@/lib/data/masters";
import { createClient } from "@/lib/supabase/server";
import { VenueForm } from "../../venue-form";

export const metadata = { title: "会場を編集 | NICOLY CRM" };

export default async function EditVenuePage({ params }: PageProps<"/venues/[id]/edit">) {
  await requireMember();
  const { id } = await params;
  const supabase = await createClient();
  const { data: v } = await supabase.from("venues").select("*").eq("id", id).maybeSingle();
  if (!v) notFound();
  const masters = await getMasters();
  return (
    <>
      <PageHeader title={`${v.name} を編集`} back={`/venues/${id}`} />
      <VenueForm
        initial={{
          id: v.id,
          name: v.name,
          kana: v.kana,
          address: v.address,
          nearest_station: v.nearest_station,
          prefecture: v.prefecture,
          area_id: v.area_id ?? "",
          access_notes: v.access_notes,
          green_room: v.green_room,
          parking: v.parking,
          memo: v.memo,
          is_active: v.is_active,
        }}
        areas={masters.areas.filter((a) => a.is_active || a.id === v.area_id)}
      />
    </>
  );
}
