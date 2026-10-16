'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/app/context/AuthContext';
import { db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { ArrowLeft, ShoppingBag, Coins, Lock, Loader2, AlertTriangle, Sparkles, Gift, Download, X, Package } from 'lucide-react';
import Link from 'next/link';
import { findBadge } from '@/lib/gamification';
import { formatPercent, SHIPMENT_STATUS_LABELS, type PublicGacha, type PublicReward, type ShipmentStatus } from '@/lib/rewards';
import { useSound } from '@/lib/sound';
import { isStudentFeatureEnabled } from '@/lib/portal-feature-access';
import GachaPerformance, { type GachaDrawResult } from '@/app/components/student/GachaPerformance';
import RewardVisual from '@/app/components/rewards/RewardVisual';
import { findRewardPreset } from '@/lib/reward-presets';

type Tab = 'shop' | 'gacha' | 'mine';

type MyReward = {
  id: string;
  kind: 'digital' | 'physical' | 'cosmetic';
  preset_id?: string;
  reward_name: string;
  reward_image_url: string;
  origin: 'shop' | 'gacha';
  gacha_name: string | null;
  file_name?: string;
  status: string;
  shipping_note?: string;
  created_at: string | null;
};


const newOperationId = () => crypto.randomUUID().replace(/-/g, '');

export default function StudentShopPage() {
  const { user, profile } = useAuth();
  const { play } = useSound(profile?.settings?.sound_se !== false);
  const [tab, setTab] = useState<Tab>('shop');
  const [rewards, setRewards] = useState<PublicReward[]>([]);
  const [gachas, setGachas] = useState<PublicGacha[]>([]);
  const [myRewards, setMyRewards] = useState<MyReward[] | null>(null);
  const [userCoins, setUserCoins] = useState(0);
  // きせかえ・限定バッジ・バーチャル背景は1人1回。持っているものは交換できないように表示する。
  const [ownedPresets, setOwnedPresets] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [shopEnabled, setShopEnabled] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  // 演出中のガチャ。result が届くまでマシンを回し、所持コインは演出後に反映する（結果のネタバレ防止）。
  const [performance, setPerformance] = useState<{ gacha: PublicGacha; result: GachaDrawResult | null; coins: number | null } | null>(null);
  const [notice, setNotice] = useState('');

  const api = useCallback(async (url: string, body?: unknown) => {
    if (!user) throw new Error('ログイン情報を確認できません');
    const token = await user.getIdToken();
    const res = await fetch(url, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data.error || '通信に失敗しました');
    return data;
  }, [user]);

  useEffect(() => {
    const fetchData = async () => {
      if (!user) return;
      try {
        const visibilitySnap = await getDoc(doc(db, 'settings', 'portal_visibility')).catch(() => null);
        const enabled = isStudentFeatureEnabled(visibilitySnap?.exists() ? visibilitySnap.data().student : null, profile, 'shop');
        setShopEnabled(enabled);
        if (!enabled) return;
        const [catalog, userSnap] = await Promise.all([api('/api/rewards'), getDoc(doc(db, 'users', user.uid))]);
        setRewards(catalog.rewards || []);
        setGachas(catalog.gachas || []);
        if (userSnap.exists()) {
          setUserCoins(userSnap.data().coins || 0);
          setOwnedPresets(Array.isArray(userSnap.data().owned_cosmetics) ? userSnap.data().owned_cosmetics : []);
        }
      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    };
    void fetchData();
  }, [user, profile, api]);

  const loadMine = useCallback(async () => {
    try {
      const data = await api('/api/rewards/mine');
      setMyRewards(data.items || []);
    } catch (error) {
      console.error(error);
      setMyRewards([]);
    }
  }, [api]);

  useEffect(() => {
    if (tab === 'mine' && myRewards === null) void loadMine();
  }, [tab, myRewards, loadMine]);

  const badgeNotice = (ids: unknown) => {
    const names = (Array.isArray(ids) ? ids : []).map(id => findBadge(id)).filter(Boolean).map(badge => `${badge!.icon}${badge!.name}`);
    return names.length ? `\n新しいバッジ「${names.join('」「')}」を獲得しました！` : '';
  };

  /** 手に入れたきせかえを、ホーム・設定画面のプロフィールへすぐ反映する。 */
  const registerOwnedPreset = (presetId: string | null | undefined) => {
    const preset = findRewardPreset(presetId);
    if (!preset) return;
    const nextOwned = Array.from(new Set([...ownedPresets, preset.id]));
    setOwnedPresets(nextOwned);
    const earned = Array.isArray(profile?.earned_badges) ? profile!.earned_badges : [];
    window.dispatchEvent(new CustomEvent('classbase:user-profile-updated', {
      detail: { owned_cosmetics: nextOwned, ...(preset.category === 'badge' ? { earned_badges: Array.from(new Set([...earned, preset.id])) } : {}) },
    }));
  };

  const acquiredMessage = (name: string, presetId: string | null | undefined, kind: string) => {
    const preset = findRewardPreset(presetId);
    if (preset?.category === 'badge') return `「${name}」を手に入れました！トロフィーの「バッジ」から装備できます。`;
    if (preset && preset.category !== 'virtual_background') return `「${name}」を手に入れました！設定画面の「見た目」から使えます。`;
    if (kind === 'digital') return `「${name}」を手に入れました！「もらった景品」からダウンロードできます。`;
    return `「${name}」の交換を受け付けました！先生からのお渡しを待ってね。`;
  };

  const handleExchange = async (reward: PublicReward) => {
    if (processingId) return;
    if (userCoins < reward.required_coins) return alert('コインが足りません！');
    if (!confirm(`「${reward.name}」を交換しますか？\n${reward.required_coins}コイン消費します。`)) return;
    setProcessingId(reward.id);
    try {
      const data = await api('/api/coin-transactions', { action: 'reward_exchange', reward_id: reward.id, exchange_id: newOperationId() });
      setUserCoins(typeof data.coins === 'number' ? data.coins : userCoins - reward.required_coins);
      setMyRewards(null);
      play('coin_acquired');
      registerOwnedPreset(reward.preset_id);
      setNotice(`${acquiredMessage(reward.name, reward.preset_id, reward.kind)}${badgeNotice(data.new_badges)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      alert(message === 'insufficient-coins' ? 'コインが足りません！' : message === 'reward-not-available' ? 'この景品は在庫切れか、交換できなくなりました。' : message === 'reward-already-owned' ? 'このアイテムはもう持っています。' : '交換できませんでした。時間をおいてもう一度お試しください。');
    } finally {
      setProcessingId(null);
    }
  };

  const handleDraw = async (gacha: PublicGacha) => {
    if (processingId) return;
    if (userCoins < gacha.cost) return alert('コインが足りません！');
    if (!confirm(`「${gacha.name}」を1回まわしますか？\n${gacha.cost}コイン消費します。`)) return;
    setProcessingId(gacha.id);
    setPerformance({ gacha, result: null, coins: null });
    try {
      const data = await api('/api/rewards/gacha', { gacha_id: gacha.id, draw_id: newOperationId() });
      setPerformance({
        gacha,
        result: { result: data.result, reward: data.reward, refund: data.refund || 0, new_badges: data.new_badges || [] },
        coins: typeof data.coins === 'number' ? data.coins : null,
      });
      if (data.result === 'win') {
        setMyRewards(null);
        registerOwnedPreset(data.reward?.preset_id);
      }
    } catch (error) {
      setPerformance(null);
      setProcessingId(null);
      const message = error instanceof Error ? error.message : '';
      alert(message === 'insufficient-coins' ? 'コインが足りません！' : message === 'gacha-not-available' ? 'このガチャは現在まわせません。' : 'ガチャをまわせませんでした。時間をおいてもう一度お試しください。');
    }
  };

  const closePerformance = () => {
    if (performance?.coins !== null && performance?.coins !== undefined) setUserCoins(performance.coins);
    setPerformance(null);
    setProcessingId(null);
  };

  const download = async (item: MyReward) => {
    setProcessingId(item.id);
    try {
      if (!user) throw new Error('auth');
      const token = await user.getIdToken();
      const res = await fetch('/api/rewards/download', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ grant_id: item.id }),
        cache: 'no-store',
      });
      if (!res.ok) throw new Error('download-failed');
      if ((res.headers.get('content-type') || '').startsWith('image/')) {
        // アプリ内のバーチャル背景はPNGが直接返るので、その場で保存する。
        const url = URL.createObjectURL(await res.blob());
        const link = document.createElement('a');
        link.href = url;
        link.download = item.file_name || 'virtual-background.png';
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
        return;
      }
      const data = await res.json();
      window.location.href = data.url;
    } catch {
      alert('ダウンロードできませんでした。時間をおいてもう一度お試しください。');
    } finally {
      setProcessingId(null);
    }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-yellow-50"><Loader2 className="animate-spin text-yellow-500" size={40}/></div>;

  if (!shopEnabled) {
    return (
      <div className="min-h-screen bg-slate-50 p-6 font-sans flex items-center justify-center">
        <div className="max-w-sm rounded-[32px] bg-white p-8 text-center shadow-sm">
          <AlertTriangle className="mx-auto mb-4 text-slate-400" size={36} />
          <h1 className="text-xl font-black text-slate-800">景品交換は現在利用できません</h1>
          <p className="mt-2 text-sm font-bold text-slate-400">管理者設定で非表示になっています。</p>
          <Link href="/student" className="mt-6 inline-flex rounded-2xl bg-slate-900 px-5 py-3 text-sm font-black text-white">ホームへ戻る</Link>
        </div>
      </div>
    );
  }

  const tabs: { id: Tab; label: string; icon: typeof Gift }[] = [
    { id: 'shop', label: '交換所', icon: ShoppingBag },
    { id: 'gacha', label: 'ガチャ', icon: Sparkles },
    { id: 'mine', label: 'もらった景品', icon: Gift },
  ];

  return (
    <div className="min-h-screen bg-yellow-50/50 p-4 pb-24 font-sans sm:p-8">
      <div className="max-w-5xl mx-auto">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Link href="/student" className="bg-white p-4 rounded-full shadow-sm text-gray-400 hover:text-yellow-600 hover:shadow-md transition-all active:scale-95" aria-label="ホームへ戻る">
              <ArrowLeft size={24} strokeWidth={3} />
            </Link>
            <div>
              <h1 className="text-2xl font-black text-gray-800 flex items-center gap-3 tracking-tight">
                <span className="bg-yellow-400 text-yellow-900 p-2.5 rounded-2xl shadow-lg shadow-yellow-200"><ShoppingBag size={24} strokeWidth={3} /></span>
                コイン交換所
              </h1>
              <p className="text-xs font-bold text-gray-400 mt-1 pl-1">貯めたコインでアイテムGET！</p>
            </div>
          </div>
          <div className="bg-white px-5 py-3 rounded-2xl shadow-md border border-yellow-100 flex flex-col items-end">
            <span className="text-[10px] font-bold text-gray-400">現在の所持コイン</span>
            <div className="flex items-center gap-2 text-2xl font-black text-yellow-500"><Coins className="fill-yellow-400 text-yellow-600" size={24} />{userCoins.toLocaleString()}</div>
          </div>
        </div>

        <nav className="mb-6 grid grid-cols-3 gap-2 rounded-2xl bg-white p-1.5 shadow-sm">
          {tabs.map(item => {
            const Icon = item.icon;
            return (
              <button key={item.id} onClick={() => setTab(item.id)} className={`flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-black transition-all ${tab === item.id ? 'bg-yellow-400 text-yellow-900 shadow' : 'text-gray-400 hover:text-gray-600'}`}>
                <Icon size={16} />{item.label}
              </button>
            );
          })}
        </nav>

        {notice && (
          <div className="mb-6 flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-800 whitespace-pre-line">
            <Gift className="shrink-0" size={20} /><p className="flex-1">{notice}</p>
            <button onClick={() => setNotice('')} aria-label="閉じる"><X size={18} /></button>
          </div>
        )}

        {tab === 'shop' && (rewards.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-[40px] border-4 border-dashed border-gray-100 text-gray-300"><p className="font-bold">現在、交換できる景品はありません</p></div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
            {rewards.map(reward => {
              const soldOut = reward.stock !== null && reward.stock <= 0;
              const owned = Boolean(reward.preset_id && ownedPresets.includes(reward.preset_id));
              const canAfford = userCoins >= reward.required_coins && !soldOut && !owned;
              return (
                <div key={reward.id} className={`bg-white rounded-[24px] shadow-sm border border-gray-100 overflow-hidden flex flex-col transition-all duration-300 ${canAfford ? 'hover:shadow-xl hover:shadow-yellow-100 hover:-translate-y-1' : 'opacity-70 grayscale'}`}>
                  <div className="relative aspect-square bg-gray-50 border-b border-gray-50">
                    <RewardVisual presetId={reward.preset_id} imageUrl={reward.image_url} alt={reward.name} className="h-full w-full" />
                    {reward.kind === 'digital' && <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-sky-600 px-2 py-0.5 text-[10px] font-black text-white"><Download size={10} />ダウンロード</span>}
                    {reward.kind === 'cosmetic' && <span className="absolute left-2 top-2 rounded-full bg-violet-600 px-2 py-0.5 text-[10px] font-black text-white">{findRewardPreset(reward.preset_id)?.category === 'badge' ? '限定バッジ' : 'きせかえ'}</span>}
                    {!canAfford && (
                      <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center text-white backdrop-blur-[1px]">
                        <Lock size={32} className="mb-1" /><span className="text-xs font-bold">{owned ? 'もっているよ' : soldOut ? '在庫切れ' : 'コイン不足'}</span>
                      </div>
                    )}
                  </div>
                  <div className="p-4 flex flex-col flex-1">
                    <h3 className="font-bold text-gray-800 text-sm mb-1 line-clamp-2 min-h-[2.5em]">{reward.name}</h3>
                    {reward.description && <p className="text-[11px] font-bold text-gray-400 line-clamp-2">{reward.description}</p>}
                    {reward.stock !== null && !soldOut && <p className="mt-1 text-[11px] font-black text-rose-500">のこり {reward.stock} 個</p>}
                    <div className="flex items-center justify-between mt-auto pt-3">
                      <div className="flex items-center gap-1 font-black text-yellow-500"><Coins size={16} className="fill-yellow-400" />{reward.required_coins.toLocaleString()}</div>
                      <button onClick={() => handleExchange(reward)} disabled={!canAfford || !!processingId}
                        className={`px-4 py-2 rounded-xl text-xs font-bold shadow-sm transition-all active:scale-95 ${canAfford ? 'bg-yellow-400 text-yellow-900 hover:bg-yellow-300' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}>
                        {processingId === reward.id ? <Loader2 className="animate-spin" size={14}/> : '交換'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ))}

        {tab === 'gacha' && (gachas.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-[40px] border-4 border-dashed border-gray-100 text-gray-300"><p className="font-bold">現在まわせるガチャはありません</p></div>
        ) : (
          <div className="grid gap-5 md:grid-cols-2">
            {gachas.map(gacha => {
              const canAfford = userCoins >= gacha.cost;
              return (
                <article key={gacha.id} className="overflow-hidden rounded-[28px] border border-violet-100 bg-white shadow-sm">
                  <div className="flex items-center gap-4 bg-gradient-to-r from-violet-500 to-fuchsia-500 p-5 text-white">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {gacha.image_url ? <img src={gacha.image_url} alt="" className="h-20 w-20 rounded-2xl object-cover ring-4 ring-white/30" /> : <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-white/20 text-4xl">🎰</div>}
                    <div className="min-w-0">
                      <h2 className="text-xl font-black">{gacha.name}</h2>
                      {gacha.description && <p className="mt-1 text-xs font-bold text-white/80">{gacha.description}</p>}
                      <p className="mt-2 flex items-center gap-1 text-sm font-black"><Coins size={16} />1回 {gacha.cost.toLocaleString()} コイン</p>
                    </div>
                  </div>
                  <div className="p-5">
                    <details className="mb-4 rounded-2xl bg-violet-50 p-3 text-xs">
                      <summary className="cursor-pointer font-black text-violet-800">出てくる景品と確率</summary>
                      <ul className="mt-2 space-y-1.5">
                        {gacha.items.map(item => (
                          <li key={item.reward_id} className="flex items-center gap-2 font-bold text-slate-600">
                            <RewardVisual presetId={item.preset_id} imageUrl={item.image_url} compact className="h-8 w-8 shrink-0 rounded-lg" />
                            <span className="flex-1">{item.name}{item.kind === 'digital' && '（ダウンロード）'}{!item.available && <span className="ml-1 text-rose-500">在庫切れ</span>}{item.available && item.preset_id && ownedPresets.includes(item.preset_id) && <span className="ml-1 text-slate-400">もっている</span>}</span>
                            <span className="font-black">{formatPercent(item.weight)}</span>
                          </li>
                        ))}
                        {gacha.miss_weight > 0 && (
                          <li className="flex items-center justify-between font-bold text-slate-400">
                            <span>はずれ{gacha.miss_refund_coins > 0 && `（${gacha.miss_refund_coins}コイン戻ります）`}</span><span className="font-black">{formatPercent(gacha.miss_weight)}</span>
                          </li>
                        )}
                      </ul>
                      <p className="mt-2 font-bold text-slate-400">在庫切れの景品や、もう持っているきせかえ・限定バッジ・背景が当たった時は、はずれになります。</p>
                    </details>
                    <button onClick={() => handleDraw(gacha)} disabled={!canAfford || !!processingId}
                      className={`flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-lg font-black shadow-lg transition-all active:scale-95 ${canAfford ? 'bg-gradient-to-r from-amber-400 to-orange-500 text-white shadow-orange-200 hover:brightness-105' : 'bg-gray-200 text-gray-400 shadow-none'}`}>
                      {processingId === gacha.id ? <Loader2 className="animate-spin" /> : <Sparkles />}{canAfford ? '1回まわす' : 'コインが足りません'}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ))}

        {tab === 'mine' && (myRewards === null ? (
          <div className="flex justify-center py-16"><Loader2 className="animate-spin text-yellow-500" /></div>
        ) : myRewards.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-[40px] border-4 border-dashed border-gray-100 text-gray-300"><Package className="mx-auto mb-2" size={36} /><p className="font-bold">まだ景品はありません</p></div>
        ) : (
          <div className="space-y-3">
            {myRewards.map(item => (
              <article key={item.id} className="flex items-center gap-4 rounded-[22px] border border-gray-100 bg-white p-4 shadow-sm">
                <RewardVisual presetId={item.preset_id} imageUrl={item.reward_image_url} compact className="h-16 w-16 shrink-0 rounded-2xl" />
                <div className="min-w-0 flex-1">
                  <p className="font-black text-gray-800">{item.reward_name}</p>
                  <p className="text-[11px] font-bold text-gray-400">{item.created_at ? new Date(item.created_at).toLocaleDateString('ja-JP') : ''}・{item.origin === 'gacha' ? `ガチャ「${item.gacha_name || ''}」` : 'コイン交換'}</p>
                  {item.kind === 'physical' && (
                    <p className="mt-1 text-xs font-black text-violet-700">{SHIPMENT_STATUS_LABELS[item.status as ShipmentStatus] || '受付'}{item.shipping_note ? `：${item.shipping_note}` : ''}</p>
                  )}
                </div>
                {item.kind === 'cosmetic' && (
                  <Link href={findRewardPreset(item.preset_id)?.category === 'badge' ? '/student' : '/student/settings'} className="shrink-0 rounded-xl bg-violet-600 px-3 py-2 text-xs font-black text-white">
                    {findRewardPreset(item.preset_id)?.category === 'badge' ? 'トロフィーで装備' : '見た目を変える'}
                  </Link>
                )}
                {item.kind === 'digital' && (
                  <button onClick={() => download(item)} disabled={processingId === item.id} className="flex shrink-0 items-center gap-1 rounded-xl bg-sky-600 px-3 py-2 text-xs font-black text-white disabled:opacity-50">
                    {processingId === item.id ? <Loader2 className="animate-spin" size={14} /> : <Download size={14} />}ダウンロード
                  </button>
                )}
              </article>
            ))}
          </div>
        ))}
      </div>

      {performance && (
        <GachaPerformance
          gacha={performance.gacha}
          result={performance.result}
          badgeText={badgeNotice(performance.result?.new_badges).trim()}
          play={play}
          onClose={closePerformance}
        />
      )}
    </div>
  );
}
