import { auth } from '@/lib/firebase';

/** 管理API呼び出し。JSON は body、multipart は FormData をそのまま渡す。 */
export async function adminApi<T = any>(url: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('ログイン情報を確認できません。再読み込みしてください。');
  const isForm = init.body instanceof FormData;
  const response = await fetch(url, {
    method: init.method || (init.body ? 'POST' : 'GET'),
    headers: { Authorization: `Bearer ${token}`, ...(init.body && !isForm ? { 'Content-Type': 'application/json' } : {}) },
    body: init.body === undefined ? undefined : isForm ? init.body as FormData : JSON.stringify(init.body),
    cache: 'no-store',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data.error || '処理に失敗しました');
  return data as T;
}

export const newOperationId = () => crypto.randomUUID().replace(/-/g, '');

export type AdminReward = {
  id: string;
  name: string;
  description: string;
  required_coins: number;
  image_url: string;
  kind: 'physical' | 'digital' | 'cosmetic';
  stock: number | null;
  exchangeable: boolean;
  preset_id: string;
  digital_file_name: string;
  digital_file_size: number;
  active: boolean;
};

export type AdminGacha = {
  id: string;
  name: string;
  description: string;
  cost: number;
  image_url: string;
  items: { reward_id: string; weight: number }[];
  miss_weight: number;
  miss_refund_coins: number;
  sort_order: number;
  active: boolean;
  recent_stats: { draws: number; wins: number; byReward: Record<string, number> };
};

export const inputClass = 'w-full rounded-xl border-2 border-slate-100 bg-slate-50 px-3 py-2.5 text-sm font-bold outline-none transition-colors focus:border-amber-400 focus:bg-white';
export const labelClass = 'mb-1.5 block text-xs font-black text-slate-500';
