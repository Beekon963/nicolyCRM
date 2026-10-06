import "server-only";
import { createClient } from "@/lib/supabase/server";

export type GeneralSettings = {
  availabilityDeadlineDay: number;
  reportWindowDays: number;
  companyProfile: { name: string; address: string; phone: string; email: string };
};

const DEFAULTS: GeneralSettings = {
  availabilityDeadlineDay: 20,
  reportWindowDays: 7,
  companyProfile: { name: "NICOLY", address: "", phone: "", email: "" },
};

/** 金額に関係しない設定（オーナー・管理者が読める） */
export async function getGeneralSettings(): Promise<GeneralSettings> {
  const supabase = await createClient();
  const { data } = await supabase.from("settings").select("key, value");
  const map = new Map((data ?? []).map((r) => [r.key, r.value]));
  return {
    availabilityDeadlineDay: Number(map.get("availability_deadline_day") ?? DEFAULTS.availabilityDeadlineDay),
    reportWindowDays: Number(map.get("report_window_days") ?? DEFAULTS.reportWindowDays),
    companyProfile: { ...DEFAULTS.companyProfile, ...((map.get("company_profile") as object | undefined) ?? {}) },
  };
}
