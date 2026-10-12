"use client";

import { useRouter } from "next/navigation";
import { ReportConverter, type ConverterFormat } from "@/components/app/report-converter";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import type { NameDict } from "@/lib/report-convert";
import { saveItemAlias } from "../../alias-actions";

export function ConvertClient({
  clients,
  clientId,
  dict,
  formats,
  defaults,
  canLearn,
}: {
  clients: { id: string; name: string }[];
  clientId: string;
  dict: NameDict;
  formats: ConverterFormat[];
  defaults: { date: string; weekday: string; venue: string; workers: string[]; clientName: string };
  canLearn: boolean;
}) {
  const router = useRouter();
  return (
    <div className="flex flex-col gap-4 rounded-2xl border bg-card p-4 shadow-card">
      <div className="flex flex-col gap-1 sm:max-w-sm">
        <Label htmlFor="convert-client">取引先</Label>
        <NativeSelect id="convert-client" value={clientId} onChange={(e) => router.replace(`/results/convert?client=${e.target.value}`)}>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      {/* 取引先を変えたら作り直す（貼った文・選び直しは消える） */}
      <ReportConverter
        key={clientId}
        dict={dict}
        formats={formats}
        defaults={defaults}
        onSaveAlias={canLearn ? (alias, name) => saveItemAlias(clientId || null, alias, name) : undefined}
      />
    </div>
  );
}
