'use client';

import { useState } from 'react';
import { addDoc, collection, doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { Lock, Power, ShieldCheck, Wrench } from 'lucide-react';
import { Button, useConfirm, useToast } from '@/app/components/ui';
import { db } from '@/lib/firebase';
import { useAuth } from '@/app/context/AuthContext';
import { useMaintenanceStatus } from '@/app/hooks/useMaintenanceStatus';

export default function SystemControl() {
  const { user, profile } = useAuth();
  const status = useMaintenanceStatus();
  const [saving, setSaving] = useState(false);
  const isMaster = profile?.role === 'master';
  const toast = useToast();
  const confirm = useConfirm();

  const handleToggleMaintenance = async () => {
    if (!isMaster) {
      toast.error('メンテナンス切替はマスター管理者のみ実行できます。');
      return;
    }

    const nextValue = !status.is_maintenance;
    const label = nextValue ? 'メンテナンスを開始' : 'メンテナンスを終了';
    if (!(await confirm({
      title: `${label}しますか？`,
      message: '生徒画面にはリアルタイムで反映されます。',
      confirmLabel: nextValue ? '開始する' : '終了する',
      tone: nextValue ? 'danger' : 'default',
    }))) return;

    setSaving(true);
    try {
      const statusRef = doc(db, 'system_status', 'global');
      const payload = {
        is_maintenance: nextValue,
        message: '現在システムメンテナンス中です。恐れ入りますが、終了までしばらくお待ちください。',
        link_url: '/',
        link_label: '理社講座専用サイトへ',
        updated_at: serverTimestamp(),
        updated_by: user?.uid || null,
        updated_by_name: profile?.name || profile?.student_name || user?.displayName || user?.email || 'master',
      };

      try {
        await updateDoc(statusRef, payload);
      } catch (error: any) {
        if (error?.code !== 'not-found') throw error;
        await setDoc(statusRef, {
          ...payload,
          created_at: serverTimestamp(),
          created_by: user?.uid || null,
        }, { merge: true });
      }

      await addDoc(collection(db, 'action_logs'), {
        action: nextValue ? 'maintenance_enabled' : 'maintenance_disabled',
        target_collection: 'system_status',
        target_id: 'global',
        before: { is_maintenance: status.is_maintenance },
        after: { is_maintenance: nextValue },
        actor_id: user?.uid || null,
        actor_role: profile?.role || null,
        actor_name: profile?.name || profile?.student_name || user?.displayName || user?.email || 'master',
        created_at: serverTimestamp(),
      });
    } catch (error) {
      console.error('Maintenance toggle failed:', error);
      toast.error('メンテナンス状態の更新に失敗しました。');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`rounded-card border p-6 shadow-sm ${status.is_maintenance ? 'border-amber-200 bg-amber-50' : 'border-slate-100 bg-white'}`}>
      <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-4">
          <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-btn ${status.is_maintenance ? 'bg-amber-400 text-slate-950' : 'bg-slate-100 text-slate-600'}`}>
            <Wrench size={26} strokeWidth={2.5} aria-hidden />
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Global System Control</p>
            <h2 className="mt-1 text-xl font-bold text-slate-900">メンテナンス・フリーズ</h2>
            <p className="mt-2 text-sm font-bold leading-relaxed text-slate-500">
              ONにすると、生徒画面全体をメンテナンス表示で覆い、操作できない状態にします。管理者画面は操作可能なまま残ります。
            </p>
          </div>
        </div>

        <div className="flex flex-col items-stretch gap-3 md:min-w-72">
          <div className={`rounded-btn px-4 py-3 text-center text-sm font-bold ${status.is_maintenance ? 'bg-amber-400 text-slate-950' : 'bg-emerald-50 text-emerald-700'}`}>
            {status.loading ? '状態確認中' : status.is_maintenance ? 'メンテナンス中' : '通常稼働中'}
          </div>
          <Button
            size="lg"
            variant={status.is_maintenance ? 'primary' : 'danger'}
            onClick={handleToggleMaintenance}
            disabled={!isMaster || status.loading}
            loading={saving}
            icon={status.is_maintenance ? <Power size={18} aria-hidden /> : <Lock size={18} aria-hidden />}
          >
            {status.is_maintenance ? 'メンテナンスを解除' : 'メンテナンスを開始'}
          </Button>
          <p className="flex items-center justify-center gap-1.5 text-xs font-bold text-slate-400">
            <ShieldCheck size={13} aria-hidden />
            {isMaster ? 'マスター管理者として操作できます' : 'マスター管理者のみ操作できます'}
          </p>
        </div>
      </div>
    </div>
  );
}
