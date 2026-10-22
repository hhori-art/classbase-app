'use client';

import { useState } from 'react';
import { CheckCircle2, Eye, EyeOff, KeyRound, RefreshCw } from 'lucide-react';
import { auth } from '@/lib/firebase';
import { generateInitialPassword } from '@/lib/password';
import { Button, Modal, useConfirm, useToast } from '@/app/components/ui';

type Target = 'student' | 'parent';

type Props = {
  /** 校舎別生徒管理の一覧行（id・student_name・parent_uid などを持つ）。 */
  student: Record<string, any>;
  onClose: () => void;
  /** 変更に成功したとき（一覧の再読み込みなど）。 */
  onChanged?: () => void;
};

const MIN_LENGTH = 6;

/** 校舎管理者・マスターが、生徒または保護者アカウントのパスワードを変更する。 */
export default function AccountPasswordModal({ student, onClose, onChanged }: Props) {
  const toast = useToast();
  const confirm = useConfirm();
  const hasParent = Boolean(student.parent_uid);
  const [target, setTarget] = useState<Target>('student');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [visible, setVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<{ target: Target; password: string; loginId: string } | null>(null);

  const studentName = String(student.student_name || student.name || '名称未設定');
  const targetUserId = target === 'parent' ? String(student.parent_uid || '') : String(student.id || '');
  const targetLoginId = target === 'parent' ? String(student.parent_login_id || '') : String(student.lifetime_id || student.login_id || '');
  const targetLabel = target === 'parent' ? `${studentName}さんの保護者` : studentName;
  const activated = target === 'parent' ? student.parent_isFirstLogin === false : student.isFirstLogin === false;
  const canSubmit = !saving && password.length >= MIN_LENGTH && password === confirmation && Boolean(targetUserId);

  const selectTarget = (next: Target) => {
    setTarget(next);
    setPassword('');
    setConfirmation('');
  };

  const fillGenerated = () => {
    const generated = generateInitialPassword(8);
    setPassword(generated);
    setConfirmation(generated);
    setVisible(true);
  };

  const submit = async () => {
    if (!canSubmit) return;
    if (!(await confirm({
      title: `「${targetLabel}」のパスワードを変更しますか？`,
      message: '変更すると、今ログインしている端末はログアウトされます。',
      confirmLabel: '変更する',
      tone: 'danger',
    }))) return;
    setSaving(true);
    try {
      const token = await auth.currentUser?.getIdToken(true);
      if (!token) throw new Error('ログイン情報を確認できませんでした。再ログインしてください。');
      const response = await fetch('/api/admin/accounts/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ user_id: targetUserId, password }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.ok === false) throw new Error(body.error || 'パスワードを変更できませんでした。');
      setDone({ target, password, loginId: targetLoginId });
      onChanged?.();
    } catch (error: any) {
      toast.error(`パスワード変更に失敗しました: ${error?.message || error}`);
    } finally {
      setSaving(false);
    }
  };

  const inputClass = 'min-h-11 w-full rounded-input border border-line bg-slate-50 px-4 font-mono outline-none focus:border-accent focus:ring-2 focus:ring-accent/30';

  return (
    <Modal
      open
      onClose={onClose}
      dismissible={!saving}
      title="パスワード変更"
      description={studentName}
      footer={done ? (
        <Button fullWidth onClick={onClose}>閉じる</Button>
      ) : (
        <Button variant="danger" fullWidth onClick={() => void submit()} disabled={!canSubmit && !saving} loading={saving} icon={<KeyRound size={16} aria-hidden />}>
          パスワードを変更
        </Button>
      )}
    >
      {done ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm font-bold text-emerald-700"><CheckCircle2 size={18} aria-hidden />変更しました</div>
          <div className="rounded-btn border border-line bg-slate-50 p-4 text-sm">
            <p className="text-xs font-bold text-slate-500">{done.target === 'parent' ? '保護者' : '生徒'}のログイン情報</p>
            <p className="mt-2 font-bold text-slate-600">ID：<span className="font-mono text-base font-bold text-slate-900">{done.loginId || '-'}</span></p>
            <p className="mt-1 font-bold text-slate-600">パスワード：<span className="font-mono text-base font-bold tracking-wider text-slate-900">{done.password}</span></p>
          </div>
          <p className="text-xs font-bold leading-5 text-slate-500">この画面を閉じるとパスワードは再表示できません。本人に伝えてから閉じてください。</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="変更するアカウント">
            {(['student', 'parent'] as Target[]).map(option => (
              <button
                key={option}
                type="button"
                onClick={() => selectTarget(option)}
                disabled={option === 'parent' && !hasParent}
                aria-pressed={target === option}
                className={`min-h-11 rounded-btn border px-3 py-2.5 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-40 ${target === option ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-white text-slate-600 hover:bg-slate-50'}`}
              >
                {option === 'student' ? '生徒アカウント' : hasParent ? '保護者アカウント' : '保護者（未作成）'}
              </button>
            ))}
          </div>
          <p className="rounded-btn bg-slate-50 px-4 py-3 text-xs font-bold text-slate-600">
            ID：<span className="font-mono font-bold text-slate-900">{targetLoginId || '-'}</span>
            <span className="ml-2 text-slate-400">{activated ? '（ログイン済み）' : '（未ログイン）'}</span>
          </p>
          <p className="rounded-btn border border-amber-100 bg-amber-50 px-4 py-3 text-xs font-bold leading-5 text-amber-800">
            本人が設定したパスワードも上書きされます。変更すると、ログイン中の端末はログアウトされ、新しいパスワードでのログインが必要になります。
          </p>
          <label className="block space-y-1">
            <span className="flex items-center justify-between text-xs font-bold text-slate-600">
              新しいパスワード
              <span className="flex gap-3">
                <button type="button" onClick={fillGenerated} className="flex items-center gap-1 text-accent hover:underline"><RefreshCw size={12} aria-hidden />自動作成</button>
                <button type="button" onClick={() => setVisible(value => !value)} className="flex items-center gap-1 text-slate-500 hover:underline">{visible ? <EyeOff size={12} aria-hidden /> : <Eye size={12} aria-hidden />}{visible ? '隠す' : '表示'}</button>
              </span>
            </span>
            <input type={visible ? 'text' : 'password'} autoComplete="new-password" minLength={MIN_LENGTH} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} placeholder={`${MIN_LENGTH}文字以上`} className={inputClass} />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-bold text-slate-600">新しいパスワード（確認）</span>
            <input type={visible ? 'text' : 'password'} autoComplete="new-password" minLength={MIN_LENGTH} maxLength={128} value={confirmation} onChange={event => setConfirmation(event.target.value)} placeholder="同じパスワードを再入力" className={inputClass} />
          </label>
          {confirmation && password !== confirmation && <p className="text-xs font-bold text-rose-600">確認用のパスワードが一致しません。</p>}
        </div>
      )}
    </Modal>
  );
}
