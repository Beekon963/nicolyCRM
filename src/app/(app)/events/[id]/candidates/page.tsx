import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { requireMember } from "@/lib/auth";
import { formatShortJa } from "@/lib/date";
import { getMasters } from "@/lib/data/masters";
import { siteUrl } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { CandidatePicker, type Candidate } from "./candidate-picker";

export const metadata = { title: "候補を探す | NICOLY CRM" };

export default async function CandidatesPage({ params }: PageProps<"/events/[id]/candidates">) {
  await requireMember();
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: ev }, { data: reqs }, { data: asg }, { data: candidates }, { data: tpl }, masters] = await Promise.all([
    supabase
      .from("events")
      .select("id, date, start_time, end_time, meeting_time, meeting_place, belongings, venue:venues(name, address), client:companies(name)")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("event_requirements").select("role_id, required_count").eq("event_id", id),
    supabase.from("assignments").select("role_id, status").eq("event_id", id),
    supabase.rpc("event_candidates", { p_event_id: id }),
    supabase.from("message_templates").select("body").eq("kind", "offer").maybeSingle(),
    getMasters(),
  ]);
  if (!ev) notFound();
  const { data: tokens } = await supabase.from("staff").select("id, mypage_token").in("id", (candidates ?? []).map((c) => c.staff_id));
  const tokenMap = new Map((tokens ?? []).map((t) => [t.id, t.mypage_token]));

  const roles = masters.roles
    .filter((r) => r.is_active || reqs?.some((q) => q.role_id === r.id))
    .map((r) => ({
      id: r.id,
      name: r.name,
      required: reqs?.find((q) => q.role_id === r.id)?.required_count ?? 0,
      confirmed: (asg ?? []).filter((a) => a.role_id === r.id && a.status === "confirmed").length,
    }))
    .filter((r) => r.required > 0 || r.confirmed > 0);

  return (
    <>
      <PageHeader title="候補を探す" description={`${formatShortJa(ev.date)} ${ev.venue?.name ?? ""}（${ev.client?.name ?? ""}）`} back={`/events/${id}`} />
      <p className="px-4 pb-2 text-sm text-muted-foreground">
        並び順: ○ → △ → 未提出 → ×・NG・同日に別現場。同じ順位の中はランク → 平均獲得件数（直近3か月）の順です。
      </p>
      <CandidatePicker
        eventId={id}
        roles={roles}
        candidates={(candidates ?? []).map((c) => ({ ...c, mypage_token: tokenMap.get(c.staff_id) ?? "" })) as Candidate[]}
        template={tpl?.body ?? ""}
        event={{ ...ev, venue: ev.venue }}
        siteUrl={siteUrl()}
      />
    </>
  );
}
