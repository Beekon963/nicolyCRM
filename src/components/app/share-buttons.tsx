"use client";

import { CopyIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import { isMobileDevice, lineShareUrl } from "@/lib/line";
import { cn } from "@/lib/utils";

/** スマホかどうか（PC 版 LINE では共有 URL が動かないので、PC ではコピーを主ボタンにする） */
export function useIsMobile() {
  const [mobile, setMobile] = useState<boolean | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 端末の判定はブラウザでしかできない
    setMobile(isMobileDevice(navigator.userAgent, navigator.maxTouchPoints, navigator.platform));
  }, []);
  return mobile;
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("コピーしました");
    return true;
  } catch {
    toast.error("コピーできませんでした。文面を長押ししてコピーしてください。");
    return false;
  }
}

/**
 * 「LINEで送る」「コピー」ボタン（要件 §4.3）。onSent は送った（つもりの）ときに呼ぶ。
 */
export function ShareButtons({
  text,
  onSent,
  className,
  size = "default",
}: {
  text: string;
  onSent?: () => void;
  className?: string;
  size?: "default" | "sm";
}) {
  const mobile = useIsMobile();
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {mobile && (
        <Button asChild variant="line" size={size}>
          <a href={lineShareUrl(text)} target="_blank" rel="noreferrer" onClick={() => onSent?.()}>
            <LineIcon />
            LINEで送る
          </a>
        </Button>
      )}
      <Button
        type="button"
        variant={mobile ? "outline" : "default"}
        size={size}
        onClick={async () => {
          if (await copyText(text)) onSent?.();
        }}
      >
        <CopyIcon />
        コピー
      </Button>
    </div>
  );
}

export function LineIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5 fill-current">
      <path d="M12 2.5C6.2 2.5 1.5 6.3 1.5 11c0 4.2 3.7 7.7 8.8 8.4.3.1.8.2.9.5.1.3.1.7 0 1l-.1.9c0 .3-.2 1 .9.5s6.1-3.6 8.3-6.2c1.5-1.7 2.2-3.4 2.2-5.1 0-4.7-4.7-8.5-10.5-8.5z" />
    </svg>
  );
}
