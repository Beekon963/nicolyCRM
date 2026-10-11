/**
 * フォームの「保存する」の置き場所。スマホでは画面の下（タブの上）に固定して、長いフォームでもすぐ押せるようにする。
 * PC はふつうにフォームの最後に並べる。フォームの左右の余白（px-4）に合わせて端まで広げる
 */
export function StickySubmitBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 -mx-4 border-t bg-background/95 px-4 py-3 backdrop-blur md:static md:mx-0 md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none [&>button]:w-full md:[&>button]:w-auto">
      {children}
    </div>
  );
}
