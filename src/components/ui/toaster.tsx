"use client";

import { Toaster as Sonner } from "sonner";

/**
 * 画面上の通知。「元に戻す」はここに出す（要件 §9-7）。
 * 画面の下には「送信する」「保存」「打診する」など押すボタンが並ぶので、上の帯（検索）のすぐ下に出す
 * （下に出すと、出ているあいだボタンが押せなかった。PC ではマウスが乗ると消えないので、ずっと押せなかった）
 */
export function Toaster() {
  return (
    <Sonner
      position="top-center"
      offset={{ top: "calc(4.5rem + env(safe-area-inset-top))" }}
      mobileOffset={{ top: "calc(4.5rem + env(safe-area-inset-top))" }}
      toastOptions={{ classNames: { toast: "text-base", actionButton: "!h-9 !px-3 !text-sm" } }}
      duration={5000}
    />
  );
}

export { toast } from "sonner";
