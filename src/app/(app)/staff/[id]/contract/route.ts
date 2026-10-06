import { notFound, redirect } from "next/navigation";
import { getAppUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/** 契約書PDFを開く（オーナーのみ。1分だけ有効な URL に移す） */
export async function GET(_req: Request, ctx: RouteContext<"/staff/[id]/contract">) {
  const user = await getAppUser();
  if (user?.role !== "owner") notFound();
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data } = await supabase.from("staff_private").select("contract_file_path").eq("staff_id", id).maybeSingle();
  if (!data?.contract_file_path) notFound();
  const { data: signed } = await supabase.storage.from("contracts").createSignedUrl(data.contract_file_path, 60);
  if (!signed) notFound();
  redirect(signed.signedUrl);
}
