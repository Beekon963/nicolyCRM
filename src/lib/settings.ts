import "server-only";
import { createClient } from "@/lib/supabase/server";

export type GeneralSettings = {
  availabilityDeadlineDay: number;
  reportWindowDays: number;
  /** 日当は交通費込み（マイページから交通費を申請しない。Phase 12） */
  transportIncluded: boolean;
  companyProfile: { name: string; address: string; phone: string; email: string };
};

const DEFAULTS: GeneralSettings = {
  availabilityDeadlineDay: 10,
  reportWindowDays: 7,
  transportIncluded: false,
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
    transportIncluded: map.has("transport_included") ? map.get("transport_included") === true : DEFAULTS.transportIncluded,
    companyProfile: { ...DEFAULTS.companyProfile, ...((map.get("company_profile") as object | undefined) ?? {}) },
  };
}
