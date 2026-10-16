// 景品・ガチャの共通定義（クライアント・サーバー共用）。

export type RewardKind = 'physical' | 'digital' | 'cosmetic';

export const REWARD_KIND_LABELS: Record<RewardKind, string> = {
  physical: '実物（発送・手渡し）',
  digital: 'デジタル（ダウンロード）',
  cosmetic: 'きせかえ・限定バッジ',
};

/** 管理画面で手動登録できる種類（きせかえはプリセットからのみ登録する）。 */
export const MANUAL_REWARD_KINDS: RewardKind[] = ['physical', 'digital'];

/** 実物景品の発送状況。requests（type: exchange）の status に保存する。 */
export const SHIPMENT_STATUSES = ['pending', 'preparing', 'shipped', 'completed', 'rejected'] as const;
export type ShipmentStatus = typeof SHIPMENT_STATUSES[number];

export const SHIPMENT_STATUS_LABELS: Record<ShipmentStatus, string> = {
  pending: '受付',
  preparing: '準備中',
  shipped: '発送・お渡し済み',
  completed: '受け取り完了',
  rejected: '取り消し（返金済み）',
};

/** 管理者が進められる状態遷移。取り消しは受け取り完了前ならいつでも可能。 */
export const SHIPMENT_TRANSITIONS: Record<ShipmentStatus, ShipmentStatus[]> = {
  pending: ['preparing', 'shipped', 'completed', 'rejected'],
  preparing: ['shipped', 'completed', 'rejected'],
  shipped: ['completed', 'rejected'],
  completed: [],
  rejected: [],
};

/** ガチャの排出率は 0.01% 単位で扱い、内部では 10000 = 100% の整数で保存する。 */
export const GACHA_RATE_SCALE = 10000;

export const rateToPercent = (weight: number) => Math.round(weight) / (GACHA_RATE_SCALE / 100);

export const percentToRate = (percent: unknown) => Math.round(Number(percent || 0) * (GACHA_RATE_SCALE / 100));

export const formatPercent = (weight: number) => `${rateToPercent(weight).toLocaleString('ja-JP', { maximumFractionDigits: 2 })}%`;

/** デジタル景品として受け付けるファイル（Vercel の要求サイズ上限に合わせて 4MB まで）。 */
export const DIGITAL_FILE_MAX_BYTES = 4 * 1024 * 1024;

export const DIGITAL_FILE_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'application/zip': 'zip',
  'audio/mpeg': 'mp3',
};

export type PublicReward = {
  id: string;
  name: string;
  description: string;
  required_coins: number;
  image_url: string;
  kind: RewardKind;
  stock: number | null;
  exchangeable: boolean;
  /** lib/reward-presets.ts のプリセット（画像の代わりにアプリ内で描画する）。 */
  preset_id: string;
};

export type PublicGacha = {
  id: string;
  name: string;
  description: string;
  cost: number;
  image_url: string;
  miss_weight: number;
  miss_refund_coins: number;
  items: { reward_id: string; weight: number; name: string; image_url: string; kind: RewardKind; preset_id: string; available: boolean }[];
};
