'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/app/context/AuthContext';
import { db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { ShoppingBag, Coins, Lock, Loader2, AlertTriangle, Sparkles, Gift, Download, X, Package } from 'lucide-react';
import { findBadge } from '@/lib/gamification';
import { formatPercent, SHIPMENT_STATUS_LABELS, type PublicGacha, type PublicReward, type ShipmentStatus } from '@/lib/rewards';
import { useSound } from '@/lib/sound';
import { isStudentFeatureEnabled } from '@/lib/portal-feature-access';
import GachaPerformance, { type GachaDrawResult } from '@/app/components/student/GachaPerformance';
import RewardVisual from '@/app/components/rewards/RewardVisual';
import { findRewardPreset } from '@/lib/reward-presets';
import { formatDate } from '@/lib/format';
import { ButtonLink, Card, EmptyState, ErrorState, IconButton, ListSkeleton, PageHeader, Spinner, useConfirm, useToast } from '@/app/components/ui';

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
  const [loadError, setLoadError] = useState(false);
  const [mineError, setMineError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const toast = useToast();
  const confirm = useConfirm();

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
      setLoadError(false);
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
        setLoadError(true);
      } finally {
        setLoading(false);
      }
    };
    void fetchData();
  }, [user, profile, api, reloadKey]);

  const retryLoad = () => {
    setLoading(true);
    setReloadKey(key => key + 1);
  };

  const loadMine = useCallback(async () => {
    setMineError(false);
    try {
      const data = await api('/api/rewards/mine');
      setMyRewards(data.items || []);
    } catch (error) {
      console.error(error);
      setMineError(true);
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
    if (userCoins < reward.required_coins) return toast.error('コインが足りません！');
    if (!(await confirm({ title: `「${reward.name}」を交換しますか？`, message: `${reward.required_coins}コイン消費します。`, confirmLabel: '交換する' }))) return;
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
      toast.error(message === 'insufficient-coins' ? 'コインが足りません！' : message === 'reward-not-available' ? 'この景品は在庫切れか、交換できなくなりました。' : message === 'reward-already-owned' ? 'このアイテムはもう持っています。' : '交換できませんでした。時間をおいてもう一度お試しください。');
    } finally {
      setProcessingId(null);
    }
  };

  const handleDraw = async (gacha: PublicGacha) => {
    if (processingId) return;
    if (userCoins < gacha.cost) return toast.error('コインが足りません！');
    if (!(await confirm({ title: `「${gacha.name}」を1回まわしますか？`, message: `${gacha.cost}コイン消費します。`, confirmLabel: 'まわす' }))) return;
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
      toast.error(message === 'insufficient-coins' ? 'コインが足りません！' : message === 'gacha-not-available' ? 'このガチャは現在まわせません。' : 'ガチャをまわせませんでした。時間をおいてもう一度お試しください。');
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
      toast.error('ダウンロードできませんでした。時間をおいてもう一度お試しください。');
    } finally {
      setProcessingId(null);
    }
  };

  if (loading) return <div className="flex justify-center py-24"><Spinner size={36} /></div>;

  if (loadError) {
    return (
      <div className="mx-auto max-w-5xl space-y-5 px-4 py-6">
        <PageHeader tone="hero" title="コイン交換所" icon={ShoppingBag} backHref="/student" />
        <ErrorState onRetry={retryLoad} />
      </div>
    );
  }

  if (!shopEnabled) {
    return (
      <div className="mx-auto flex max-w-sm items-center justify-center px-4 py-12">
        <Card className="w-full text-center">
          <AlertTriangle className="mx-auto mb-4 text-fg-muted" size={36} aria-hidden />
          <h1 className="text-xl font-black text-fg">景品交換は現在利用できません</h1>
          <p className="mt-2 text-sm text-fg-muted">管理者設定で非表示になっています。</p>
          <ButtonLink href="/student" className="mt-6">ホームへ戻る</ButtonLink>
        </Card>
      </div>
    );
  }

  const tabs: { id: Tab; label: string; icon: typeof Gift }[] = [
    { id: 'shop', label: '交換所', icon: ShoppingBag },
    { id: 'gacha', label: 'ガチャ', icon: Sparkles },
    { id: 'mine', label: 'もらった景品', icon: Gift },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-6 sm:px-8">
      <PageHeader
        tone="hero"
        title="コイン交換所"
        description="貯めたコインでアイテムGET！"
        icon={ShoppingBag}
        backHref="/student"
        actions={(
          <div className="flex flex-col items-end rounded-card bg-surface px-5 py-3 shadow-card">
            <span className="text-xs font-bold text-fg-muted">現在の所持コイン</span>
            <div className="flex items-center gap-2 text-2xl font-black text-amber-500"><Coins className="fill-yellow-400 text-amber-600" size={24} aria-hidden />{userCoins.toLocaleString()}</div>
          </div>
        )}
      />

      <nav className="cb-card grid grid-cols-3 gap-2 p-1.5" aria-label="交換所のメニュー">
        {tabs.map(item => {
          const Icon = item.icon;
          return (
            <button key={item.id} type="button" onClick={() => setTab(item.id)} aria-pressed={tab === item.id} className={`flex min-h-11 items-center justify-center gap-1.5 rounded-btn text-sm font-bold transition-colors ${tab === item.id ? 'bg-accent text-accent-ink shadow-sm' : 'text-fg-muted hover:bg-accent-soft hover:text-accent'}`}>
              <Icon size={16} aria-hidden />{item.label}
            </button>
          );
        })}
      </nav>

      {notice && (
        <div role="status" className="flex items-start gap-3 rounded-card border border-success/25 bg-success-soft p-4 text-sm font-medium text-success whitespace-pre-line">
          <Gift className="mt-2.5 shrink-0" size={20} aria-hidden /><p className="flex-1 pt-2">{notice}</p>
          <IconButton label="閉じる" size="sm" onClick={() => setNotice('')} className="text-success hover:bg-success/10 hover:text-success"><X size={18} /></IconButton>
        </div>
      )}

      {tab === 'shop' && (rewards.length === 0 ? (
        <EmptyState icon={ShoppingBag} title="現在、交換できる景品はありません" className="py-16" />
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:gap-6 md:grid-cols-3 lg:grid-cols-4">
          {rewards.map(reward => {
            const soldOut = reward.stock !== null && reward.stock <= 0;
            const owned = Boolean(reward.preset_id && ownedPresets.includes(reward.preset_id));
            const canAfford = userCoins >= reward.required_coins && !soldOut && !owned;
            return (
              <div key={reward.id} className={`cb-card flex flex-col overflow-hidden transition-all duration-300 ${canAfford ? 'hover:-translate-y-1 hover:shadow-xl hover:shadow-amber-100' : 'opacity-70 grayscale'}`}>
                <div className="relative aspect-square border-b border-line bg-canvas">
                  <RewardVisual presetId={reward.preset_id} imageUrl={reward.image_url} alt={reward.name} className="h-full w-full" />
                  {reward.kind === 'digital' && <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-info px-2 py-0.5 text-[11px] font-bold text-white"><Download size={10} aria-hidden />ダウンロード</span>}
                  {reward.kind === 'cosmetic' && <span className="absolute left-2 top-2 rounded-full bg-violet-600 px-2 py-0.5 text-[11px] font-bold text-white">{findRewardPreset(reward.preset_id)?.category === 'badge' ? '限定バッジ' : 'きせかえ'}</span>}
                  {!canAfford && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 text-white backdrop-blur-[1px]">
                      <Lock size={32} className="mb-1" aria-hidden /><span className="text-xs font-bold">{owned ? 'もっているよ' : soldOut ? '在庫切れ' : 'コイン不足'}</span>
                    </div>
                  )}
                </div>
                <div className="flex flex-1 flex-col p-4">
                  <h3 className="mb-1 line-clamp-2 min-h-[2.5em] text-sm font-bold text-fg">{reward.name}</h3>
                  {reward.description && <p className="line-clamp-2 text-xs text-fg-muted">{reward.description}</p>}
                  {reward.stock !== null && !soldOut && <p className="mt-1 text-xs font-bold text-danger">のこり {reward.stock} 個</p>}
                  <div className="mt-auto flex items-center justify-between gap-2 pt-3">
                    <div className="flex items-center gap-1 font-bold text-amber-500"><Coins size={16} className="fill-yellow-400" aria-hidden />{reward.required_coins.toLocaleString()}</div>
                    <button type="button" onClick={() => handleExchange(reward)} disabled={!canAfford || !!processingId}
                      className={`inline-flex min-h-9 items-center justify-center rounded-btn px-4 text-xs font-bold shadow-sm transition-all active:scale-95 ${canAfford ? 'bg-yellow-400 text-yellow-900 hover:bg-yellow-300' : 'cursor-not-allowed bg-slate-200 text-slate-400'}`}>
                      {processingId === reward.id ? <Loader2 className="animate-spin" size={14} aria-label="処理中" /> : '交換'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ))}

      {tab === 'gacha' && (gachas.length === 0 ? (
        <EmptyState icon={Sparkles} title="現在まわせるガチャはありません" className="py-16" />
      ) : (
        <div className="grid gap-5 md:grid-cols-2">
          {gachas.map(gacha => {
            const canAfford = userCoins >= gacha.cost;
            return (
              <article key={gacha.id} className="cb-card overflow-hidden">
                <div className="flex items-center gap-4 bg-gradient-to-r from-violet-500 to-fuchsia-500 p-5 text-white">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {gacha.image_url ? <img src={gacha.image_url} alt="" className="h-20 w-20 rounded-btn object-cover ring-4 ring-white/30" /> : <div className="flex h-20 w-20 items-center justify-center rounded-btn bg-white/20 text-4xl" aria-hidden>🎰</div>}
                  <div className="min-w-0">
                    <h2 className="text-xl font-black">{gacha.name}</h2>
                    {gacha.description && <p className="mt-1 text-xs font-medium text-white/85">{gacha.description}</p>}
                    <p className="mt-2 flex items-center gap-1 text-sm font-bold"><Coins size={16} aria-hidden />1回 {gacha.cost.toLocaleString()} コイン</p>
                  </div>
                </div>
                <div className="p-5">
                  <details className="mb-4 rounded-btn bg-violet-50 p-3 text-xs">
                    <summary className="flex min-h-9 cursor-pointer items-center font-bold text-violet-800">出てくる景品と確率</summary>
                    <ul className="mt-2 space-y-1.5">
                      {gacha.items.map(item => (
                        <li key={item.reward_id} className="flex items-center gap-2 font-medium text-slate-600">
                          <RewardVisual presetId={item.preset_id} imageUrl={item.image_url} compact className="h-8 w-8 shrink-0 rounded-input" />
                          <span className="flex-1">{item.name}{item.kind === 'digital' && '（ダウンロード）'}{!item.available && <span className="ml-1 text-danger">在庫切れ</span>}{item.available && item.preset_id && ownedPresets.includes(item.preset_id) && <span className="ml-1 text-fg-muted">もっている</span>}</span>
                          <span className="font-bold">{formatPercent(item.weight)}</span>
                        </li>
                      ))}
                      {gacha.miss_weight > 0 && (
                        <li className="flex items-center justify-between font-medium text-fg-muted">
                          <span>はずれ{gacha.miss_refund_coins > 0 && `（${gacha.miss_refund_coins}コイン戻ります）`}</span><span className="font-bold">{formatPercent(gacha.miss_weight)}</span>
                        </li>
                      )}
                    </ul>
                    <p className="mt-2 text-fg-muted">在庫切れの景品や、もう持っているきせかえ・限定バッジ・背景が当たった時は、はずれになります。</p>
                  </details>
                  <button type="button" onClick={() => handleDraw(gacha)} disabled={!canAfford || !!processingId}
                    className={`flex min-h-14 w-full items-center justify-center gap-2 rounded-btn text-lg font-bold shadow-lg transition-all active:scale-95 ${canAfford ? 'bg-gradient-to-r from-amber-400 to-amber-500 text-white shadow-amber-200 hover:brightness-105' : 'bg-slate-200 text-slate-400 shadow-none'}`}>
                    {processingId === gacha.id ? <Loader2 className="animate-spin" aria-hidden /> : <Sparkles aria-hidden />}{canAfford ? '1回まわす' : 'コインが足りません'}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ))}

      {tab === 'mine' && (mineError ? (
        <ErrorState onRetry={() => { setMineError(false); setMyRewards(null); }} />
      ) : myRewards === null ? (
        <ListSkeleton rows={3} />
      ) : myRewards.length === 0 ? (
        <EmptyState icon={Package} title="まだ景品はありません" description="交換所やガチャで手に入れた景品がここに並びます。" className="py-16" />
      ) : (
        <div className="space-y-3">
          {myRewards.map(item => (
            <article key={item.id} className="cb-card flex items-center gap-4 p-4">
              <RewardVisual presetId={item.preset_id} imageUrl={item.reward_image_url} compact className="h-16 w-16 shrink-0 rounded-btn" />
              <div className="min-w-0 flex-1">
                <p className="font-bold text-fg">{item.reward_name}</p>
                <p className="text-xs text-fg-muted">{item.created_at ? formatDate(item.created_at, { withYear: true, withWeekday: false }) : ''}・{item.origin === 'gacha' ? `ガチャ「${item.gacha_name || ''}」` : 'コイン交換'}</p>
                {item.kind === 'physical' && (
                  <p className="mt-1 text-xs font-bold text-accent">{SHIPMENT_STATUS_LABELS[item.status as ShipmentStatus] || '受付'}{item.shipping_note ? `：${item.shipping_note}` : ''}</p>
                )}
              </div>
              {item.kind === 'cosmetic' && (
                <ButtonLink size="sm" href={findRewardPreset(item.preset_id)?.category === 'badge' ? '/student' : '/student/settings'} className="shrink-0">
                  {findRewardPreset(item.preset_id)?.category === 'badge' ? 'トロフィーで装備' : '見た目を変える'}
                </ButtonLink>
              )}
              {item.kind === 'digital' && (
                <button type="button" onClick={() => download(item)} disabled={processingId === item.id} className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-btn bg-info px-3 text-xs font-bold text-white disabled:opacity-50">
                  {processingId === item.id ? <Loader2 className="animate-spin" size={14} aria-hidden /> : <Download size={14} aria-hidden />}ダウンロード
                </button>
              )}
            </article>
          ))}
        </div>
      ))}

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
