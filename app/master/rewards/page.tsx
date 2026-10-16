'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Coins, Loader2, Package, Sparkles, Truck } from 'lucide-react';
import RewardCatalogPanel from '@/app/components/master/rewards/RewardCatalogPanel';
import GachaPanel from '@/app/components/master/rewards/GachaPanel';
import ShipmentPanel from '@/app/components/master/rewards/ShipmentPanel';
import StudentPointsPanel from '@/app/components/master/rewards/StudentPointsPanel';
import { adminApi, type AdminGacha, type AdminReward } from '@/app/components/master/rewards/api';
import { useAuth } from '@/app/context/AuthContext';

type Tab = 'shipments' | 'points' | 'rewards' | 'gachas';

const TABS: { id: Tab; label: string; icon: typeof Package; description: string }[] = [
  { id: 'shipments', label: '発送管理', icon: Truck, description: '交換・ガチャで当たった実物景品の受付から受け取りまでを管理します。' },
  { id: 'points', label: '生徒のポイント・バッジ', icon: Coins, description: '生徒ごとのコインの増減と、先生からの特別バッジを授与します。' },
  { id: 'rewards', label: '景品', icon: Package, description: '交換所に並べる景品（実物・ダウンロード）を登録します。' },
  { id: 'gachas', label: 'ガチャ', icon: Sparkles, description: '1回のコイン数・景品・排出率を設定します。' },
];

export default function RewardsManagementPage() {
  const { profile } = useAuth();
  const [tab, setTab] = useState<Tab>('shipments');
  const [rewards, setRewards] = useState<AdminReward[]>([]);
  const [gachas, setGachas] = useState<AdminGacha[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogLoaded, setCatalogLoaded] = useState(false);
  const [error, setError] = useState('');

  const loadCatalog = useCallback(async () => {
    setCatalogLoading(true);
    setError('');
    try {
      const [rewardData, gachaData] = await Promise.all([
        adminApi<{ rewards: AdminReward[] }>('/api/admin/rewards'),
        adminApi<{ gachas: AdminGacha[] }>('/api/admin/gachas'),
      ]);
      setRewards(rewardData.rewards || []);
      setGachas(gachaData.gachas || []);
      setCatalogLoaded(true);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '景品を取得できませんでした');
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  useEffect(() => {
    if ((tab === 'rewards' || tab === 'gachas') && !catalogLoaded) void loadCatalog();
  }, [tab, catalogLoaded, loadCatalog]);

  const active = TABS.find(item => item.id === tab)!;

  return (
    <div className="min-h-screen bg-[#F8F9FA] p-4 pb-32 font-sans text-slate-800 sm:p-6">
      <div className="mx-auto max-w-7xl">
        <header className="mb-6 flex items-center gap-4">
          <Link href="/master" className="rounded-full bg-white p-3 text-slate-500 shadow-sm hover:text-slate-800" aria-label="管理画面へ戻る"><ArrowLeft size={22} /></Link>
          <div>
            <h1 className="text-2xl font-black">ポイント・景品・ガチャ</h1>
            <p className="mt-1 text-xs font-bold text-slate-400">{active.description}</p>
          </div>
        </header>

        <nav className="mb-6 flex gap-2 overflow-x-auto pb-1">
          {TABS.map(item => {
            const Icon = item.icon;
            return (
              <button key={item.id} onClick={() => setTab(item.id)} className={`flex shrink-0 items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-black ${tab === item.id ? 'bg-slate-900 text-white shadow-lg' : 'bg-white text-slate-500 shadow-sm hover:text-slate-800'}`}>
                <Icon size={16} />{item.label}
              </button>
            );
          })}
        </nav>

        {error && <p className="mb-4 rounded-2xl bg-rose-50 p-4 text-sm font-bold text-rose-700">{error}</p>}

        {tab === 'shipments' && <ShipmentPanel />}
        {tab === 'points' && <StudentPointsPanel isMaster={profile?.role === 'master'} />}
        {(tab === 'rewards' || tab === 'gachas') && (catalogLoading && !catalogLoaded ? (
          <div className="flex justify-center py-20"><Loader2 className="animate-spin text-amber-500" size={36} /></div>
        ) : tab === 'rewards' ? (
          <RewardCatalogPanel rewards={rewards} onChanged={loadCatalog} />
        ) : (
          <GachaPanel gachas={gachas} rewards={rewards} onChanged={loadCatalog} />
        ))}
      </div>
    </div>
  );
}
