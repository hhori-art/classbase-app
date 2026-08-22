'use client';

import { useState } from 'react';
import { addDoc, collection, doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { Loader2, Lock, Power, ShieldCheck, Wrench } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/app/context/AuthContext';
import { useMaintenanceStatus } from '@/app/hooks/useMaintenanceStatus';

export default function SystemControl() {
  const { user, profile } = useAuth();
  const status = useMaintenanceStatus();
  const [saving, setSaving] = useState(false);
  const isMaster = profile?.role === 'master';

  const handleToggleMaintenance = async () => {
    if (!isMaster) {
      alert('メンテナンス切替はマスター管理者のみ実行できます。');
      return;
    }

    const nextValue = !status.is_maintenance;
    const label = nextValue ? 'メンテナンスを開始' : 'メンテナンスを終了';
    if (!confirm(`${label}しますか？\n生徒画面にはリアルタイムで反映されます。`)) return;

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
      alert('メンテナンス状態の更新に失敗しました。');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`rounded-[32px] border p-6 shadow-sm ${status.is_maintenance ? 'border-amber-200 bg-amber-50' : 'border-slate-100 bg-white'}`}>
      <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-4">
          <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ${status.is_maintenance ? 'bg-amber-400 text-slate-950' : 'bg-slate-100 text-slate-600'}`}>
            <Wrench size={26} strokeWidth={2.5} />
          </div>
          <div>
            <p className="text-xs font-black uppercase tracking-wider text-slate-400">Global System Control</p>
            <h2 className="mt-1 text-xl font-black text-slate-900">メンテナンス・フリーズ</h2>
            <p className="mt-2 text-sm font-bold leading-relaxed text-slate-500">
              ONにすると、生徒画面全体をメンテナンス表示で覆い、操作できない状態にします。管理者画面は操作可能なまま残ります。
            </p>
          </div>
        </div>

        <div className="flex flex-col items-stretch gap-3 md:min-w-72">
          <div className={`rounded-2xl px-4 py-3 text-center text-sm font-black ${status.is_maintenance ? 'bg-amber-400 text-slate-950' : 'bg-emerald-50 text-emerald-700'}`}>
            {status.loading ? '状態確認中' : status.is_maintenance ? 'メンテナンス中' : '通常稼働中'}
          </div>
          <button
            type="button"
            onClick={handleToggleMaintenance}
            disabled={!isMaster || saving || status.loading}
            className={`inline-flex items-center justify-center gap-2 rounded-2xl px-5 py-4 text-sm font-black shadow-sm transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 ${
              status.is_maintenance
                ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                : 'bg-slate-900 text-white hover:bg-slate-800'
            }`}
          >
            {saving ? <Loader2 className="animate-spin" size={18} /> : status.is_maintenance ? <Power size={18} /> : <Lock size={18} />}
            {status.is_maintenance ? 'メンテナンスを解除' : 'メンテナンスを開始'}
          </button>
          <p className="flex items-center justify-center gap-1.5 text-[11px] font-bold text-slate-400">
            <ShieldCheck size={13} />
            {isMaster ? 'マスター管理者として操作できます' : 'マスター管理者のみ操作できます'}
          </p>
        </div>
      </div>
    </div>
  );
}
