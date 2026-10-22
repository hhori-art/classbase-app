'use client';

import { useCallback, useEffect, useState } from 'react';
import { Coins, Package, Sparkles, Truck } from 'lucide-react';
import RewardCatalogPanel from '@/app/components/master/rewards/RewardCatalogPanel';
import GachaPanel from '@/app/components/master/rewards/GachaPanel';
import ShipmentPanel from '@/app/components/master/rewards/ShipmentPanel';
import StudentPointsPanel from '@/app/components/master/rewards/StudentPointsPanel';
import { adminApi, type AdminGacha, type AdminReward } from '@/app/components/master/rewards/api';
import { useAuth } from '@/app/context/AuthContext';
import AdminPageHeader from '@/app/components/master/AdminPageHeader';
import AdminTabs from '@/app/components/master/AdminTabs';
import { ErrorState, ListSkeleton } from '@/app/components/ui';

type Tab = 'shipments' | 'points' | 'rewards' | 'gachas';

const TABS: { id: Tab; label: string; icon: typeof Package; description: string }[] = [
  { id: 'shipments', label: '発送管理', icon: Truck, description: '交換・ガチャで当たった実物景品の受付から受け取りまでを管理します。' },
  { id: 'points', label: '生徒のコイン・バッジ', icon: Coins, description: '生徒ごとのコインの増減と、講師からの特別バッジを授与します。' },
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
      console.error(loadError);
      setError(loadError instanceof Error ? loadError.message : '景品を取得できませんでした');
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  useEffect(() => {
    if ((tab === 'rewards' || tab === 'gachas') && !catalogLoaded) void loadCatalog();
  }, [tab, catalogLoaded, loadCatalog]);

  const active = TABS.find(item => item.id === tab)!;
  const isCatalogTab = tab === 'rewards' || tab === 'gachas';

  return (
    <div className="font-sans text-slate-800">
      <AdminPageHeader description={active.description} />

      <AdminTabs
        tabs={TABS.map(({ id, label, icon }) => ({ id, label, icon }))}
        value={tab}
        onChange={setTab}
        urlParam="tab"
        ariaLabel="コイン・景品の管理"
        className="mb-6"
      />

      {tab === 'shipments' && <ShipmentPanel />}
      {tab === 'points' && <StudentPointsPanel isMaster={profile?.role === 'master'} />}
      {isCatalogTab && error && !catalogLoading && (
        <ErrorState className="mb-4" message={error} onRetry={() => void loadCatalog()} />
      )}
      {isCatalogTab && (catalogLoading && !catalogLoaded ? (
        <ListSkeleton rows={4} />
      ) : !catalogLoaded ? null : tab === 'rewards' ? (
        <RewardCatalogPanel rewards={rewards} onChanged={loadCatalog} />
      ) : (
        <GachaPanel gachas={gachas} rewards={rewards} onChanged={loadCatalog} />
      ))}
    </div>
  );
}
