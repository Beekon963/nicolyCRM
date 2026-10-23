"use client";

import { CheckCircle2Icon, CopyIcon, ImagePlusIcon, Loader2Icon, SendIcon, SparklesIcon, SquareIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { runAiProposal, undoAiProposal } from "@/app/(app)/ai-actions";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import { type AiBlock as Block, type AiMessage as ApiMessage, trimHistory } from "@/lib/ai/history";
import type { Proposal } from "@/lib/ai/proposals";
import { ProposalCard, type CardState } from "./proposal-card";
import { lineShareUrl } from "@/lib/line";
import { copyText, LineIcon, useIsMobile } from "./share-buttons";

/**
 * AI アシスタント（Phase 4-4）。上の「AI」から開く。
 * 質問・文面の下書き・使い方の案内に答え、LINE のスクショなどを読み取って確認カードを出す（「登録する」で登録）。
 * 会話はこの画面の中だけに持つ（ページを移っても残る。「新しい会話」で消える）。
 */

type Item =
  | { id: number; kind: "user"; text: string; images: string[] }
  | { id: number; kind: "assistant"; text: string; tools: string[]; cards: CardState[]; error?: string; streaming: boolean };
type Picked = { preview: string; data: string };

const MAX_IMAGES = 4;

/** 画像を小さくする（長い辺 2400px・約150万画素まで、JPEG）。LINE の縦長のスクショも読めるように */
async function shrink(file: File): Promise<Picked> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, Math.sqrt(1_500_000 / (bmp.width * bmp.height)), 2400 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bmp.width * scale));
  canvas.height = Math.max(1, Math.round(bmp.height * scale));
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const url = canvas.toDataURL("image/jpeg", 0.85);
  return { preview: url, data: url.slice(url.indexOf(",") + 1) };
}

const noop = () => () => {};

export function AiAssistant({ role, ready }: { role: "owner" | "manager"; ready: boolean }) {
  const [open, setOpen] = useState(false);
  // 「LINE の文を貼るだけ」で読み取れなかった文を AI に渡す（window の nicoly:ai-paste。Phase 18）
  const [handoff, setHandoff] = useState<string | null>(null);
  useEffect(() => {
    const onPaste = (e: Event) => {
      const text = (e as CustomEvent<{ text?: string }>).detail?.text;
      if (!text) return;
      setHandoff(text);
      setOpen(true);
    };
    window.addEventListener("nicoly:ai-paste", onPaste);
    return () => window.removeEventListener("nicoly:ai-paste", onPaste);
  }, []);
  // ブラウザで動いているか（サーバーの表示と食い違わないように）
  const inBrowser = useSyncExternalStore(noop, () => true, () => false);
  return (
    <>
      <Button variant="outline" className="h-11 shrink-0 rounded-full px-3" aria-label="AI アシスタント" onClick={() => setOpen(true)}>
        <SparklesIcon className="text-primary" />
        AI
      </Button>
      {/* 上の帯（ぼかし）の中に置くと画面全体に広がらないので、body の直下に出す。閉じても会話は残す */}
      {inBrowser && createPortal(<AiPanel role={role} ready={ready} open={open} onClose={() => setOpen(false)} handoff={handoff} onHandoff={() => setHandoff(null)} />, document.body)}
    </>
  );
}

function AiPanel({ role, ready, open, onClose, handoff, onHandoff }: { role: "owner" | "manager"; ready: boolean; open: boolean; onClose: () => void; handoff: string | null; onHandoff: () => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [history, setHistory] = useState<ApiMessage[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [images, setImages] = useState<Picked[]>([]);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const idRef = useRef(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const mobile = useIsMobile();

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);
  // 渡された文を、開いたときに1回だけ送る（送るのは次の描画のあと）
  const sendRef = useRef<(raw: string) => Promise<void>>(null);
  useEffect(() => {
    if (!open || !handoff || !ready) return;
    const text = handoff;
    onHandoff();
    const t = setTimeout(() => void sendRef.current?.(`次の LINE の文を読み取って、CRM に登録できる形に整理してください。\n\n${text}`), 0);
    return () => clearTimeout(t);
  }, [open, handoff, ready, onHandoff]);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [items]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const updateLast = (fn: (a: Extract<Item, { kind: "assistant" }>) => Extract<Item, { kind: "assistant" }>) =>
    setItems((xs) => xs.map((x, i) => (i === xs.length - 1 && x.kind === "assistant" ? fn(x) : x)));

  const addImages = async (files: FileList | File[]) => {
    const list = [...files].filter((f) => f.type.startsWith("image/")).slice(0, MAX_IMAGES - images.length);
    if (!list.length) return;
    try {
      const picked = await Promise.all(list.map(shrink));
      setImages((cur) => [...cur, ...picked].slice(0, MAX_IMAGES));
    } catch {
      toast.error("画像を読み込めませんでした");
    }
  };

  const send = async (raw: string) => {
    const q = raw.trim();
    if ((!q && !images.length) || busy) return;
    const content: Block[] = [
      ...notes.map((n) => ({ type: "text" as const, text: n })),
      ...images.map((im) => ({ type: "image" as const, source: { type: "base64" as const, media_type: "image/jpeg" as const, data: im.data } })),
      { type: "text", text: q || "この画像の内容を読み取って、CRM に登録できる形に整理してください。" },
    ];
    const userMsg: ApiMessage = { role: "user", content };
    const outgoing = trimHistory([...history, userMsg]);
    setItems((xs) => [
      ...xs,
      { id: ++idRef.current, kind: "user", text: q, images: images.map((i) => i.preview) },
      { id: ++idRef.current, kind: "assistant", text: "", tools: [], cards: [], streaming: true },
    ]);
    setText("");
    setImages([]);
    setNotes([]);
    setBusy(true);
    const abort = new AbortController();
    abortRef.current = abort;
    let added: ApiMessage[] | null = null;
    try {
      const res = await fetch("/api/ai", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: outgoing }), signal: abort.signal });
      if (!res.ok || !res.body) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error ?? "AI に聞けませんでした。少し待ってからもう一度送ってください。");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (!line.trim()) continue;
          let e: { type: string; text?: string; label?: string; proposal?: Proposal; messages?: ApiMessage[]; message?: string };
          try {
            e = JSON.parse(line);
          } catch {
            throw new Error("ログインし直してから、もう一度送ってください。");
          }
          if (e.type === "text") updateLast((a) => ({ ...a, text: a.text + e.text }));
          else if (e.type === "tool") updateLast((a) => ({ ...a, tools: [...a.tools, e.label!] }));
          else if (e.type === "proposal") updateLast((a) => ({ ...a, cards: [...a.cards, { ...e.proposal!, state: "open" }] }));
          else if (e.type === "done") added = e.messages ?? [];
          else if (e.type === "error") throw new Error(e.message);
        }
      }
      if (!added) throw new Error("途中で切れました。もう一度送ってください。");
      setHistory([...outgoing, ...(added as ApiMessage[])]);
    } catch (err) {
      const aborted = abort.signal.aborted;
      updateLast((a) => ({ ...a, error: aborted ? "止めました。" : err instanceof Error ? err.message : "AI に聞けませんでした。" }));
    } finally {
      updateLast((a) => ({ ...a, streaming: false }));
      setBusy(false);
      abortRef.current = null;
    }
  };

  useEffect(() => {
    sendRef.current = send;
  });

  const setCard = (cardId: string, patch: Partial<CardState>) =>
    setItems((xs) => xs.map((x) => (x.kind === "assistant" ? { ...x, cards: x.cards.map((c) => (c.id === cardId ? { ...c, ...patch } : c)) } : x)));
  const note = (s: string) => setNotes((n) => [...n, `［画面の操作］${s}`]);

  const reset = () => {
    abortRef.current?.abort();
    setItems([]);
    setHistory([]);
    setNotes([]);
    setImages([]);
    setText("");
  };

  const suggestions = [
    "今日と明日の欠員を教えて",
    "明日の現場の前日リマインドの文面を作って",
    "LINE のスクショから実績の報告を入れたい",
    "稼働可能日がまだ出ていない人は？",
    "研修の予約のしかたを教えて",
    ...(role === "owner" ? ["今月の売上と粗利は？"] : []),
  ];

  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label="AI アシスタント" className="fixed inset-0 z-50 flex flex-col bg-background md:inset-y-0 md:right-0 md:left-auto md:w-[440px] md:border-l md:shadow-xl">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b px-2 pl-4">
        <SparklesIcon className="size-5 text-primary" />
        <h2 className="flex-1 font-bold">AI アシスタント</h2>
        {items.length > 0 && (
          <Button variant="ghost" size="sm" onClick={reset}>
            新しい会話
          </Button>
        )}
        <button type="button" aria-label="閉じる" className="grid size-11 place-items-center rounded-md hover:bg-accent" onClick={onClose}>
          <XIcon className="size-6" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {!ready ? (
          <div className="flex flex-col gap-3 rounded-lg border border-dashed p-4 text-muted-foreground">
            <p className="font-medium text-foreground">AI はまだ使えません</p>
            {role === "owner" ? (
              <p>Anthropic のキーを Vercel の環境変数（ANTHROPIC_API_KEY）に入れると使えるようになります。手順は操作マニュアルの「AI アシスタント」にあります。</p>
            ) : (
              <p>オーナーに AI の設定を頼んでください。</p>
            )}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col gap-4">
            <p className="text-muted-foreground">
              このアプリのデータの質問、LINE の文面の下書き、使い方の案内ができます。LINE の画面の写真（スクリーンショット）を付けて送ると、読み取って登録の確認を出します（「登録する」を押すまで登録しません）。
              {role === "manager" && "金額は答えません。"}
            </p>
            <div className="flex flex-col gap-2">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="min-h-11 rounded-lg border px-3 py-2 text-left text-base hover:bg-accent"
                  onClick={() => {
                    if (s.includes("スクショ")) {
                      setText("この LINE のスクショの報告を入れてください");
                      fileRef.current?.click();
                    } else void send(s);
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {items.map((it) =>
              it.kind === "user" ? (
                <div key={it.id} className="ml-8 flex flex-col items-end gap-2">
                  {it.images.length > 0 && (
                    <div className="flex flex-wrap justify-end gap-1">
                      {it.images.map((src, i) => (
                        // eslint-disable-next-line @next/next/no-img-element -- 送った画像の小さな表示（data URL）
                        <img key={i} src={src} alt="送った画像" className="h-20 w-auto rounded border object-cover" />
                      ))}
                    </div>
                  )}
                  {it.text && <p className="rounded-2xl rounded-br-sm bg-primary px-3 py-2 break-words whitespace-pre-wrap text-primary-foreground">{it.text}</p>}
                </div>
              ) : (
                <AssistantItem
                  key={it.id}
                  item={it}
                  mobile={mobile}
                  onRun={async (c) => {
                    setCard(c.id, { state: "running" });
                    const r = await runAiProposal(c.kind, c.payload);
                    if (!r.ok) {
                      setCard(c.id, { state: "open" });
                      toast.error(r.message);
                      return;
                    }
                    setCard(c.id, { state: "done", message: r.message, undo: r.data?.undo });
                    note(`確認カード「${c.title}」→ 登録しました（${r.message ?? ""}）`);
                  }}
                  onCancel={(c) => {
                    setCard(c.id, { state: "cancelled" });
                    note(`確認カード「${c.title}」→ 登録をやめました`);
                  }}
                  onUndo={async (c) => {
                    if (!c.undo) return;
                    const r = await undoAiProposal(c.undo);
                    if (!r.ok) return void toast.error(r.message);
                    setCard(c.id, { state: "undone", message: r.message });
                    note(`確認カード「${c.title}」→ 元に戻しました`);
                  }}
                />
              ),
            )}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {ready && (
        <form
          className="shrink-0 border-t px-3 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]"
          onSubmit={(e) => {
            e.preventDefault();
            void send(text);
          }}
        >
          {images.length > 0 && (
            <div className="mb-2 flex gap-2">
              {images.map((im, i) => (
                <div key={i} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element -- 付けた画像の小さな表示（data URL） */}
                  <img src={im.preview} alt="付けた画像" className="size-16 rounded border object-cover" />
                  <button
                    type="button"
                    aria-label="この画像を外す"
                    className="absolute -top-2 -right-2 grid size-6 place-items-center rounded-full bg-foreground text-background"
                    onClick={() => setImages((xs) => xs.filter((_, j) => j !== i))}
                  >
                    <XIcon className="size-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files) void addImages(e.target.files);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              aria-label="画像を付ける"
              disabled={busy || images.length >= MAX_IMAGES}
              className="grid size-11 shrink-0 place-items-center rounded-full border text-muted-foreground disabled:opacity-40"
              onClick={() => fileRef.current?.click()}
            >
              <ImagePlusIcon className="size-5" />
            </button>
            <textarea
              ref={inputRef}
              aria-label="AI に送る文"
              rows={1}
              value={text}
              placeholder="聞きたいこと・頼みたいこと"
              className="max-h-36 min-h-11 flex-1 resize-none rounded-2xl border border-input bg-background px-3 py-2 text-base outline-none focus-visible:border-ring"
              style={{ fieldSizing: "content" } as React.CSSProperties}
              onChange={(e) => setText(e.target.value)}
              onPaste={(e) => {
                const files = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
                if (files.length) {
                  e.preventDefault();
                  void addImages(files);
                }
              }}
              onKeyDown={(e) => {
                // PC は Enter で送る（Shift+Enter で改行。変換中の Enter は送らない）。スマホは改行
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !mobile) {
                  e.preventDefault();
                  void send(text);
                }
              }}
            />
            {busy ? (
              <button type="button" aria-label="止める" className="grid size-11 shrink-0 place-items-center rounded-full bg-foreground text-background" onClick={() => abortRef.current?.abort()}>
                <SquareIcon className="size-4 fill-current" />
              </button>
            ) : (
              <button
                type="submit"
                aria-label="送る"
                disabled={!text.trim() && !images.length}
                className="grid size-11 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground disabled:opacity-40"
              >
                <SendIcon className="size-5" />
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}

function AssistantItem({
  item,
  mobile,
  onRun,
  onCancel,
  onUndo,
}: {
  item: Extract<Item, { kind: "assistant" }>;
  mobile: boolean | null;
  onRun: (c: CardState) => Promise<void>;
  onCancel: (c: CardState) => void;
  onUndo: (c: CardState) => Promise<void>;
}) {
  const text = item.text.trim();
  return (
    <div className="mr-4 flex flex-col gap-2">
      {item.tools.length > 0 && (
        <p className="flex items-center gap-1 text-sm text-muted-foreground">
          {item.streaming && !text ? <Loader2Icon className="size-4 animate-spin" /> : <CheckCircle2Icon className="size-4" />}
          {item.tools.at(-1)}
          {item.tools.length > 1 && `（ほか${item.tools.length - 1}件）`}
        </p>
      )}
      {item.streaming && !text && !item.tools.length && (
        <p className="flex items-center gap-1 text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" />
          考えています…
        </p>
      )}
      {text && <div className="break-words whitespace-pre-wrap">{text}</div>}
      {item.cards.map((c) => (
        <ProposalCard key={c.id} card={c} onRun={onRun} onCancel={onCancel} onUndo={onUndo} />
      ))}
      {item.error && <p className="rounded-md bg-status-alert-bg p-2 text-status-alert">{item.error}</p>}
      {!item.streaming && text.length > 20 && (
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => void copyText(text)}>
            <CopyIcon />
            コピー
          </Button>
          {mobile && (
            <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
              <a href={lineShareUrl(text)} target="_blank" rel="noreferrer">
                <LineIcon />
                LINEで送る
              </a>
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

