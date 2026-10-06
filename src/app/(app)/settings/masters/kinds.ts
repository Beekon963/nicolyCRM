export const MASTER_KINDS = {
  roles: { title: "役割", description: "アサインや必要人数で使う役割。使わなくなったら無効にします（過去のデータは残ります）。" },
  items: { title: "獲得項目", description: "実績報告で数える項目。並び順は報告画面の順番です。使わなくなったら無効にします（過去のデータは残ります）。" },
  ranks: { title: "ランク", description: "上ほど高いランクです（候補一覧の並び順に使います）。基準日当は、スタッフを登録・取り込みするときの基本日当の初期値になります。" },
  areas: { title: "エリア", description: "スタッフの対応エリアと会場のエリア。一致すると候補一覧に印が付きます。" },
} as const;

export type MasterKind = keyof typeof MASTER_KINDS;

export function isMasterKind(v: string): v is MasterKind {
  return v in MASTER_KINDS;
}

export type MasterRow = {
  id?: string;
  name: string;
  description?: string;
  base_daily_rate?: number | null;
  is_active: boolean;
};
