'use client';

import { useEffect, useState } from 'react';
import { auth } from '@/lib/firebase';
import { Bell, Mail, MessageCircle, Save, Smartphone } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import LineLinkPanel from '@/app/components/LineLinkPanel';

export default function ParentSettingsPage() {
  const { profile } = useAuth();
  const [prefs, setPrefs] = useState({
    email: false,
    line: false,
    in_app: true,
    class_start: true,
    homework: true,
    announcements: true,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (profile?.notification_preferences) {
      setPrefs(prev => ({ ...prev, ...profile.notification_preferences }));
    }
  }, [profile]);

  const save = async () => {
    setSaving(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/notifications/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(prefs),
      });
      if (!res.ok) throw new Error('failed');
      alert('通知設定を保存しました。');
    } catch {
      alert('保存に失敗しました。');
    } finally {
      setSaving(false);
    }
  };

  const items = [
    { key: 'email', label: 'メール通知', icon: Mail },
    { key: 'line', label: 'LINE通知', icon: MessageCircle },
    { key: 'in_app', label: 'アプリ内通知', icon: Smartphone },
    { key: 'class_start', label: '授業開始通知', icon: Bell },
    { key: 'homework', label: '宿題通知', icon: Bell },
    { key: 'announcements', label: 'お知らせ通知', icon: Bell },
  ] as const;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <p className="text-xs font-black uppercase tracking-wider text-indigo-400">Notification</p>
        <h2 className="text-2xl font-black text-slate-900">通知設定</h2>
      </div>
      <LineLinkPanel
        role="parent"
        lineUserId={profile?.line_user_id}
        description="連携すると、授業開始・欠席連絡・登録依頼・お知らせなどをLINEでも受け取れます。"
        compact
      />
      <div className="rounded-2xl bg-white p-4 shadow-sm">
        {items.map(item => {
          const Icon = item.icon;
          return (
            <label key={item.key} className="flex items-center justify-between border-b border-slate-100 py-4 last:border-b-0">
              <span className="flex items-center gap-3 text-sm font-black text-slate-700">
                <Icon size={18} className="text-indigo-500" />
                {item.label}
              </span>
              <input type="checkbox" checked={prefs[item.key]} onChange={e => setPrefs(prev => ({ ...prev, [item.key]: e.target.checked }))} className="h-5 w-5 accent-indigo-600" />
            </label>
          );
        })}
      </div>
      <button onClick={save} disabled={saving} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 py-4 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-60">
        <Save size={18} /> {saving ? '保存中...' : '保存する'}
      </button>
    </div>
  );
}
