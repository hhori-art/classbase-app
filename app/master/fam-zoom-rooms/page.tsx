'use client';

import { useCallback, useEffect, useState } from 'react';
import { Copy, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import AdminPageHeader from '@/app/components/master/AdminPageHeader';
import { Button, Card, EmptyState, ErrorState, ListSkeleton, Modal, useConfirm, useToast } from '@/app/components/ui';
import { userErrorMessage } from '@/lib/user-error';

type Room = { room_key: string; booth: string; meeting_id: string; updated_at: string | null };
type Draft = { original_key: string; booth: string; room_key: string; meeting_id: string };

/** 推測されにくい教室キー（例：booth-a-r4u7rff8）。 */
function randomRoomKey(booth: string) {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const suffix = Array.from(bytes, byte => alphabet[byte % alphabet.length]).join('');
  const label = booth.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20);
  return `booth-${label || 'x'}-${suffix}`;
}

/**
 * FAMキャンパスの席URL（/zoom/start?room=教室キー）の教室。マスターだけが見て変えられる。
 * 席URLを開いた人は誰でもホストになるので、URLは席の設定以外で共有しない。漏れたら教室キーを作り直す。
 */
export default function FamZoomRoomsPage() {
  const { user, profile } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const isMaster = profile?.role === 'master';
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState('');
  const [origin, setOrigin] = useState('');

  useEffect(() => { setOrigin(window.location.origin); }, []);

  const authed = useCallback(async (url: string, init?: RequestInit) => {
    const token = await user!.getIdToken();
    const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init?.headers || {}) }, cache: 'no-store' });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.ok === false) throw new Error(body.error || '処理できませんでした。');
    return body;
  }, [user]);

  const load = useCallback(async () => {
    if (!user || !isMaster) return;
    setLoading(true);
    setError('');
    try {
      setRooms((await authed('/api/admin/fam-zoom-rooms')).rooms || []);
    } catch (loadError) {
      setError(userErrorMessage(loadError, '読み込めませんでした。'));
    } finally {
      setLoading(false);
    }
  }, [authed, isMaster, user]);

  useEffect(() => { if (isMaster) void load(); else setLoading(false); }, [isMaster, load]);

  const seatUrl = (roomKey: string) => `${origin}/zoom/start?room=${encodeURIComponent(roomKey)}`;

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('コピーしました。');
    } catch {
      toast.error('コピーできませんでした。');
    }
  };

  const save = async () => {
    if (!draft) return;
    if (draft.original_key && draft.original_key !== draft.room_key.trim() && !(await confirm({
      title: '教室キーを変えますか？',
      message: '今の席URLは使えなくなります。FAMキャンパスの席に、新しいURLを設定し直してください。',
      confirmLabel: '変える',
    }))) return;
    setBusy('save');
    try {
      await authed('/api/admin/fam-zoom-rooms', { method: 'POST', body: JSON.stringify({ action: 'save', ...draft }) });
      toast.success('保存しました。');
      setDraft(null);
      await load();
    } catch (saveError) {
      toast.error(userErrorMessage(saveError, '保存できませんでした。'));
    } finally { setBusy(''); }
  };

  const remove = async (room: Room) => {
    if (!(await confirm({
      title: `${room.booth || room.room_key} を削除しますか？`,
      message: 'この席URLは使えなくなります。',
      confirmLabel: '削除する',
      tone: 'danger',
    }))) return;
    setBusy(`delete_${room.room_key}`);
    try {
      await authed('/api/admin/fam-zoom-rooms', { method: 'POST', body: JSON.stringify({ action: 'delete', room_key: room.room_key }) });
      toast.success('削除しました。');
      await load();
    } catch (deleteError) {
      toast.error(userErrorMessage(deleteError, '削除できませんでした。'));
    } finally { setBusy(''); }
  };

  if (!isMaster) {
    return <EmptyState title="マスターだけが使えます" description="この画面は、マスター権限のアカウントでログインして開いてください。" />;
  }

  return (
    <div className="space-y-4">
      <AdminPageHeader
        description="FAMキャンパスの席に設定するURLです。開くと Zoom がホストとして始まります。"
        actions={<Button icon={<Plus size={16} />} onClick={() => setDraft({ original_key: '', booth: '', room_key: randomRoomKey(''), meeting_id: '' })}>教室を追加</Button>}
      />

      <Card className="border-amber-200 bg-amber-50 text-sm leading-relaxed text-amber-900">
        <p>席URLを開いた人は、ログインなしで誰でもホストになります。席の設定以外では共有しないでください。</p>
        <p className="mt-1">URLが漏れたときは「編集」で教室キーを作り直し、FAMキャンパスの席のURLを差し替えてください。</p>
        <p className="mt-1">同じホストのミーティングは同時に開ける数に上限があります。同じ時間帯に複数のブースを使うときは、ホストの割り当てを確認してください。</p>
      </Card>

      {loading ? <ListSkeleton /> : error ? <ErrorState message={error} onRetry={() => void load()} /> : rooms.length === 0 ? (
        <EmptyState title="教室がまだありません" description="「教室を追加」から、ブース名・教室キー・ZoomミーティングIDを登録してください。" />
      ) : (
        <Card padded={false}>
          <ul className="divide-y divide-line">
            {rooms.map(room => (
              <li key={room.room_key} className="grid gap-2 p-4 md:grid-cols-[minmax(0,120px)_minmax(0,140px)_minmax(0,1fr)_auto] md:items-center">
                <p className="font-bold text-fg">{room.booth || '（名前なし）'}</p>
                <p className="font-mono text-sm text-fg-muted">{room.meeting_id}</p>
                <div className="min-w-0">
                  <p className="truncate font-mono text-xs text-fg-muted" title={seatUrl(room.room_key)}>{seatUrl(room.room_key)}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" icon={<Copy size={14} />} onClick={() => void copy(seatUrl(room.room_key))}>URLをコピー</Button>
                  <Button size="sm" variant="secondary" icon={<Pencil size={14} />} onClick={() => setDraft({ original_key: room.room_key, booth: room.booth, room_key: room.room_key, meeting_id: room.meeting_id })}>編集</Button>
                  <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} loading={busy === `delete_${room.room_key}`} onClick={() => void remove(room)}>削除</Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Modal
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        closeOnBackdrop={false}
        title={draft?.original_key ? '教室を編集' : '教室を追加'}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setDraft(null)}>やめる</Button>
            <Button loading={busy === 'save'} onClick={() => void save()}>保存</Button>
          </>
        )}
      >
        {draft && (
          <div className="space-y-4 text-sm">
            <label className="block">
              <span className="font-bold text-fg">ブース名</span>
              <input className="min-h-11 rounded-input border border-line bg-canvas px-3 text-sm text-fg mt-1 w-full" value={draft.booth} placeholder="A" onChange={event => setDraft({ ...draft, booth: event.target.value })} />
            </label>
            <label className="block">
              <span className="font-bold text-fg">ZoomミーティングID</span>
              <input className="min-h-11 rounded-input border border-line bg-canvas px-3 text-sm text-fg mt-1 w-full font-mono" inputMode="numeric" value={draft.meeting_id} placeholder="98332455891" onChange={event => setDraft({ ...draft, meeting_id: event.target.value })} />
              <span className="mt-1 block text-xs text-fg-muted">空白は自動で取り除きます。</span>
            </label>
            <div>
              <span className="font-bold text-fg">教室キー</span>
              <div className="mt-1 flex gap-2">
                <input className="min-h-11 rounded-input border border-line bg-canvas px-3 text-sm text-fg w-full min-w-0 font-mono" value={draft.room_key} onChange={event => setDraft({ ...draft, room_key: event.target.value })} />
                <Button variant="secondary" icon={<RefreshCw size={14} />} onClick={() => setDraft({ ...draft, room_key: randomRoomKey(draft.booth) })}>作り直す</Button>
              </div>
              <span className="mt-1 block text-xs text-fg-muted">席URLの末尾になります。推測されにくい文字列にしてください（英数字・-・_）。</span>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
