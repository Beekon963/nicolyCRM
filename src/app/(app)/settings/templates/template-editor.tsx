"use client";

import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import { TEMPLATE_KIND } from "@/lib/labels";
import type { Database } from "@/lib/supabase/database.types";
import { renderTemplate, SAMPLE_VALUES, TEMPLATE_VARIABLES } from "@/lib/templates";
import { saveTemplate } from "./actions";

type Kind = Database["public"]["Enums"]["template_kind"];

export function TemplateEditor({ kind, initial }: { kind: Kind; initial: string }) {
  const [body, setBody] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [pending, start] = useTransition();
  const ref = useRef<HTMLTextAreaElement>(null);
  const dirty = body !== saved;
  useUnsavedChanges(dirty);

  function insert(v: string) {
    const el = ref.current;
    const token = `{${v}}`;
    if (!el) return setBody((b) => b + token);
    const { selectionStart: s, selectionEnd: e } = el;
    const next = body.slice(0, s) + token + body.slice(e);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s + token.length, s + token.length);
    });
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{TEMPLATE_KIND[kind].label}</CardTitle>
          <p className="text-sm text-muted-foreground">{TEMPLATE_KIND[kind].description}</p>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Textarea ref={ref} rows={10} value={body} onChange={(e) => setBody(e.target.value)} aria-label={`${TEMPLATE_KIND[kind].label}の文面`} />
          <div className="flex flex-wrap gap-1">
            {TEMPLATE_VARIABLES.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => insert(v)}
                className="h-9 rounded-full border px-3 text-sm text-muted-foreground hover:bg-accent"
              >
                {`{${v}}`}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-muted-foreground">プレビュー（見本の値）</p>
          <pre className="min-h-40 whitespace-pre-wrap rounded-md bg-[#8cabd8]/20 p-3 font-sans text-base">{renderTemplate(body, SAMPLE_VALUES)}</pre>
          <Button
            className="self-end"
            disabled={!dirty || pending}
            onClick={() =>
              start(async () => {
                const r = await saveTemplate(kind, body);
                if (r.ok) {
                  setSaved(body);
                  toast.success(r.message);
                } else toast.error(r.message);
              })
            }
          >
            {pending ? "保存中…" : "保存する"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
