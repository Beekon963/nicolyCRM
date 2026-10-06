"use client";

import { AlertTriangleIcon, MapPinIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { MessageDialog, type Recipient } from "@/components/app/message-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toaster";
import { ASSIGNMENT_STATUS, AVAILABILITY } from "@/lib/labels";
import { buildMessage, type MessageEvent } from "@/lib/messages";
import { cn } from "@/lib/utils";
import { offerStaff } from "../../actions";

export type Candidate = {
  staff_id: string;
  name: string;
  nearest_station: string;
  rank_name: string | null;
  role_ids: string[];
  area_match: boolean;
  availability: "ok" | "maybe" | "ng" | null;
  availability_submitted: boolean;
  double_booking: boolean;
  double_booking_venue: string | null;
  ng_venue: boolean;
  ng_client: boolean;
  ng_reason: string | null;
  avg_confirmed: number | null;
  caution_count: number;
  current_status: keyof typeof ASSIGNMENT_STATUS | null;
  sort_group: number;
  mypage_token: string;
};

type Role = { id: string; name: string; required: number; confirmed: number };

export function CandidatePicker({
  eventId,
  roles,
  candidates,
  template,
  event,
  siteUrl,
}: {
  eventId: string;
  roles: Role[];
  candidates: Candidate[];
  template: string;
  event: MessageEvent;
  siteUrl: string;
}) {
  const router = useRouter();
  const initialRole = roles.find((r) => r.confirmed < r.required) ?? roles[0];
  const [roleId, setRoleId] = useState(initialRole?.id ?? "");
  const [onlyRole, setOnlyRole] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmWarn, setConfirmWarn] = useState(false);
  const [sent, setSent] = useState<Recipient[] | null>(null);
  const [pending, start] = useTransition();
  const role = roles.find((r) => r.id === roleId);

  const list = useMemo(() => candidates.filter((c) => !onlyRole || c.role_ids.includes(roleId)), [candidates, onlyRole, roleId]);
  const picked = candidates.filter((c) => selected.includes(c.staff_id));
  const warned = picked.filter((c) => c.ng_venue || c.ng_client || c.double_booking || c.availability === "ng");

  function offer() {
    start(async () => {
      const r = await offerStaff(eventId, roleId, selected);
      if (!r.ok) return void toast.error(r.message);
      toast.success(r.message);
      setConfirmWarn(false);
      setSent(
        picked.map((c) => ({
          id: c.staff_id,
          name: c.name,
          text: buildMessage(template, event, c, { siteUrl, roleName: role?.name }),
        })),
      );
      setSelected([]);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3 pb-28">
      <div className="flex flex-col gap-2 px-4">
        <p className="text-sm font-medium">打診する役割</p>
        <div className="flex flex-wrap gap-2">
          {roles.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setRoleId(r.id)}
              className={cn(
                "h-11 rounded-full border px-4",
                r.id === roleId ? "border-primary bg-primary text-primary-foreground" : "border-input",
              )}
            >
              {r.name}
              <span className={cn("ml-1 text-sm", r.id !== roleId && r.confirmed < r.required && "text-status-alert")}>
                {r.confirmed}/{r.required}
              </span>
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={onlyRole} onCheckedChange={setOnlyRole} />
          {role?.name ?? "この役割"}ができる人だけ
        </label>
      </div>

      <ul className="divide-y border-y">
        {list.map((c) => {
          const already = c.current_status != null;
          const on = selected.includes(c.staff_id);
          const av = AVAILABILITY[c.availability ?? "none"];
          return (
            <li key={c.staff_id}>
              <label className={cn("flex min-h-16 items-start gap-3 px-4 py-2", already ? "opacity-60" : "cursor-pointer hover:bg-accent", on && "bg-primary/10")}>
                <Checkbox
                  className="mt-1"
                  checked={on}
                  disabled={already}
                  aria-label={`${c.name}を選ぶ`}
                  onCheckedChange={(v) => setSelected((s) => (v ? [...s, c.staff_id] : s.filter((x) => x !== c.staff_id)))}
                />
                <span
                  className={cn(
                    "grid size-9 shrink-0 place-items-center rounded-full border text-lg font-bold",
                    c.availability === "ok" && "border-status-done/40 bg-status-done-bg text-status-done",
                    c.availability === "maybe" && "border-status-waiting/40 bg-status-waiting-bg text-status-waiting",
                    c.availability === "ng" && "border-status-alert/40 bg-status-alert-bg text-status-alert",
                    !c.availability && "text-muted-foreground",
                  )}
                  title={c.availability ? av.label : c.availability_submitted ? "入力なし" : "未提出"}
                >
                  {c.availability ? av.mark : "−"}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1">
                    <Link href={`/staff/${c.staff_id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                      {c.name}
                    </Link>
                    {c.rank_name && <Badge tone="brand">{c.rank_name}</Badge>}
                    {already && <Badge tone={ASSIGNMENT_STATUS[c.current_status!].tone}>{ASSIGNMENT_STATUS[c.current_status!].label}</Badge>}
                    {!c.availability && !c.availability_submitted && <Badge tone="waiting">未提出</Badge>}
                  </span>
                  <span className="flex flex-wrap gap-1 pt-0.5">
                    {c.double_booking && <Badge tone="alert">同日に別現場（{c.double_booking_venue}）</Badge>}
                    {c.ng_venue && <Badge tone="alert">会場NG</Badge>}
                    {c.ng_client && <Badge tone="alert">取引先NG</Badge>}
                    {c.caution_count > 0 && (
                      <Badge tone="alert">
                        <AlertTriangleIcon className="size-3" />
                        注意 {c.caution_count}回
                      </Badge>
                    )}
                  </span>
                  <span className="block text-sm text-muted-foreground">
                    {c.area_match && (
                      <span className="mr-2 inline-flex items-center gap-0.5 font-medium text-status-done">
                        <MapPinIcon className="size-3" />
                        エリア一致
                      </span>
                    )}
                    {[c.nearest_station, c.avg_confirmed != null ? `平均 ${c.avg_confirmed}件` : "実績なし", c.ng_reason].filter(Boolean).join(" / ")}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      {/* 下に固定: 打診する */}
      <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 border-t bg-background/95 p-3 backdrop-blur md:bottom-0 md:left-60">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <span className="flex-1 text-sm">
            {selected.length}人を選択中{role && `（${role.name}）`}
          </span>
          <Button size="lg" disabled={selected.length === 0 || pending} onClick={() => (warned.length ? setConfirmWarn(true) : offer())}>
            {pending ? "打診中…" : "打診する"}
          </Button>
        </div>
      </div>

      <Dialog open={confirmWarn} onOpenChange={setConfirmWarn}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>注意が必要な人が含まれています</DialogTitle>
          </DialogHeader>
          <ul className="list-disc pl-5">
            {warned.map((c) => (
              <li key={c.staff_id}>
                {c.name}:{" "}
                {[c.availability === "ng" && "×（稼働できない日）", c.double_booking && "同日に別現場", c.ng_venue && "会場NG", c.ng_client && "取引先NG"]
                  .filter(Boolean)
                  .join("・")}
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmWarn(false)}>
              選び直す
            </Button>
            <Button onClick={offer} disabled={pending}>
              このまま打診する
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <MessageDialog
        open={sent != null}
        onOpenChange={(o) => !o && setSent(null)}
        title="打診の文面を送る"
        description="1人ずつ「LINEで送る」を押し、LINE で本人を選んで送信してください。送り終わったら閉じてください。"
        recipients={sent ?? []}
      />
    </div>
  );
}
