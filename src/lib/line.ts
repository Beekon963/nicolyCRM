/**
 * LINE で送る（要件 §4.3）。
 * `https://line.me/R/share?text=` に文面を UTF-8 でパーセントエンコードして付けると、
 * LINE アプリの送信先選択画面が開く。PC 版 LINE では動かないので、PC ではコピーを主ボタンにする。
 */
export function lineShareUrl(text: string): string {
  return `https://line.me/R/share?text=${encodeURIComponent(text)}`;
}

/** スマホ・タブレットか（ブラウザ側で判定。iPad の Safari は Mac と名乗るのでタッチ対応で見分ける） */
export function isMobileDevice(userAgent: string, maxTouchPoints = 0, platform = ""): boolean {
  if (/iPhone|iPad|iPod|Android/i.test(userAgent)) return true;
  return platform === "MacIntel" && maxTouchPoints > 1;
}
