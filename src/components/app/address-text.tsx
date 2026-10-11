import { Fragment } from "react";

const NUMBER = /([0-9０-９]+(?:[-－‐−ー][0-9０-９]+)+)/;

/** 住所。「1-0-0」のような番地は途中で折り返さない（「南幸1- / 0-0」のように切れると読みにくいため） */
export function AddressText({ address }: { address: string }) {
  const parts = address.split(NUMBER).filter(Boolean);
  return (
    <>
      {parts.map((p, i) => (
        <Fragment key={i}>{NUMBER.test(p) ? <span className="whitespace-nowrap">{p}</span> : p}</Fragment>
      ))}
    </>
  );
}
