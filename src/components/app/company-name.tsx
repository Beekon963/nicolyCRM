import { Fragment } from "react";

const LEGAL = /(株式会社|有限会社|合同会社|合資会社|合名会社|一般社団法人|一般財団法人|（株）|\(株\)|（有）|\(有\))/;

/**
 * 会社名。「株式会社」などは途中で折り返さない（「株式 / 会社」のように切れると読みにくいため）。
 * 会社名の本体と「株式会社」のあいだでは折り返してよい
 */
export function CompanyName({ name }: { name: string }) {
  const parts = name.split(LEGAL).filter(Boolean);
  if (parts.length < 2) return <>{name}</>;
  return (
    <>
      {parts.map((p, i) => (
        <Fragment key={i}>
          {i > 0 && <wbr />}
          {LEGAL.test(p) ? <span className="whitespace-nowrap">{p}</span> : p}
        </Fragment>
      ))}
    </>
  );
}
