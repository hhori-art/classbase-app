'use client';

import { useState, type CSSProperties, type ReactNode } from 'react';
import { BookOpen, CalendarDays, Palette, Trash2, Video } from 'lucide-react';
import { Button, Card, EmptyState, ErrorState, IconButton, ListSkeleton, Modal, PageHeader, SectionTitle, Spinner, StatusPill, useConfirm, usePrompt, useToast } from '@/app/components/ui';
import { DEFAULT_STUDENT_APPEARANCE, STUDENT_CARD_STYLES, STUDENT_THEMES, studentAppearanceCssVars, type StudentCardStyle, type StudentThemeId } from '@/lib/student-customization';
import { TERMS } from '@/lib/glossary';
import { formatDate, formatDateTime } from '@/lib/format';

const PORTALS = [
  { id: 'student', label: '生徒（標準テーマ）' },
  { id: 'parent', label: '保護者' },
  { id: 'teacher', label: '講師' },
  { id: 'admin', label: '管理' },
  { id: 'eiken', label: 'Booster' },
] as const;

const SEMANTIC = [
  { name: 'success', label: '成功・完了' },
  { name: 'warning', label: '注意' },
  { name: 'danger', label: '危険・削除' },
  { name: 'info', label: '情報' },
] as const;

function Sample({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button>主ボタン</Button>
        <Button variant="secondary">副ボタン</Button>
        <Button variant="ghost">控えめ</Button>
        <Button variant="danger" icon={<Trash2 size={16} aria-hidden />}>削除</Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <StatusPill tone="accent">受付中</StatusPill>
        <StatusPill tone="warning">未対応</StatusPill>
        <StatusPill tone="info">対応中</StatusPill>
        <StatusPill tone="success">対応済み</StatusPill>
        <StatusPill tone="danger">見送り</StatusPill>
      </div>
      {children}
    </div>
  );
}

/** デザインの決まり（色・形・文字・部品）をまとめて確認する見本帳。 */
export default function UiGuide() {
  const toast = useToast();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const [modalOpen, setModalOpen] = useState(false);
  const studentVars = (theme: StudentThemeId, cardStyle: StudentCardStyle = 'soft') =>
    studentAppearanceCssVars({ ...DEFAULT_STUDENT_APPEARANCE, theme, cardStyle }) as CSSProperties;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="システム設定"
        icon={Palette}
        title="UIガイド"
        description="全アプリ共通の色・形・文字・部品の見本です。新しい画面や直す画面は、ここにある部品を使います。"
      />

      <Card>
        <SectionTitle title="アプリごとの差し色" description="文字・枠・状態の色は全アプリ共通。ボタンなどの差し色だけがアプリごとに変わります。" />
        <div className="grid gap-4 lg:grid-cols-2">
          {PORTALS.map(portal => (
            <div key={portal.id} data-portal={portal.id} style={portal.id === 'student' ? studentVars('aurora') : undefined} className="rounded-card bg-canvas p-4">
              <p className="mb-3 text-sm font-bold text-fg">{portal.label}</p>
              <Sample>{null}</Sample>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <SectionTitle title="状態の色（全アプリ共通）" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {SEMANTIC.map(item => (
            <div key={item.name} className="overflow-hidden rounded-btn border border-line">
              <div className={`h-10 bg-${item.name}`} />
              <div className={`bg-${item.name}-soft px-3 py-2 text-xs font-bold text-${item.name}`}>{item.label}</div>
            </div>
          ))}
        </div>
        {/* Tailwind に使うクラスを知らせる：bg-success bg-warning bg-danger bg-info bg-success-soft bg-warning-soft bg-danger-soft bg-info-soft text-success text-warning text-danger text-info */}
      </Card>

      <Card>
        <SectionTitle title="生徒のテーマ" description="生徒が設定で選んだテーマが、生徒画面の全ページの差し色・地の色になります。" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {(Object.keys(STUDENT_THEMES) as StudentThemeId[]).map(theme => (
            <div key={theme} data-portal="student" style={studentVars(theme)} className="flex flex-col gap-2 rounded-card bg-canvas p-3">
              <p className="text-xs font-bold text-fg">{STUDENT_THEMES[theme].label}{STUDENT_THEMES[theme].premium ? '（限定）' : ''}</p>
              <Button size="sm">参加する</Button>
              <StatusPill tone="accent">受付中</StatusPill>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <SectionTitle title="カードの形（生徒は設定で変えられる）" description="ほかのアプリは「やわらか」で固定です。" />
        <div className="grid gap-4 sm:grid-cols-3">
          {(Object.keys(STUDENT_CARD_STYLES) as StudentCardStyle[]).map(style => (
            <div key={style} data-portal="student" style={studentVars('ocean', style)} className="rounded-card bg-[linear-gradient(135deg,rgb(var(--cb-accent-soft)),rgb(var(--cb-canvas)))] p-4">
              <Card>
                <p className="text-xs font-bold text-accent">{STUDENT_CARD_STYLES[style].label}</p>
                <p className="mt-1 text-base font-bold text-fg">2限 中2 地理D</p>
                <p className="text-sm text-fg-muted">中部地方 ・ 20:35〜21:40</p>
              </Card>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <SectionTitle title="文字" description="書体は Noto Sans JP。本文は標準の太さ、見出しと数字だけ太字にします。" />
        <div className="flex flex-col gap-3">
          <p className="text-2xl font-black text-fg">ページの見出し 24px／極太</p>
          <p className="text-xl font-bold text-fg">区切りの見出し 20px／太字</p>
          <p className="text-base font-bold text-fg">カードの見出し 16px／太字</p>
          <p className="text-sm text-fg">本文 14px／標準。お子さまの出席・録画・宿題の状況を、授業日ごとに確認できます。</p>
          <p className="text-xs text-fg-muted">補足 12px（これより小さい文字は使わない）</p>
          <p className="text-3xl font-black tabular-nums text-accent">87<span className="ml-1 text-sm font-bold text-fg-muted">%</span></p>
        </div>
      </Card>

      <Card>
        <SectionTitle title="読み込み中・データなし・失敗" description="読み込みに失敗したときは、必ず「失敗」の表示を出します（「データなし」と見分けるため）。" />
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="flex flex-col gap-3"><Spinner /><ListSkeleton rows={2} /></div>
          <EmptyState icon={Video} title="この月の録画はまだありません" description="授業のあとに録画が追加されます。" />
          <ErrorState onRetry={() => toast.info('もう一度読み込みます（見本）')} />
        </div>
      </Card>

      <Card>
        <SectionTitle title="ポップアップ・確認・通知" description="ブラウザ標準の alert / confirm / prompt は使わず、これらを使います。" />
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => toast.success('保存しました')}>通知（成功）</Button>
          <Button variant="secondary" onClick={() => toast.error('保存できませんでした。通信状態を確認して、もう一度お試しください。')}>通知（失敗）</Button>
          <Button variant="secondary" onClick={async () => {
            const ok = await confirm({ title: '「中2 理科 物理」の配置を削除しますか？', message: '講師の配置が外れます。元に戻すには配置し直してください。', confirmLabel: '削除する', tone: 'danger' });
            toast.info(ok ? '削除を選びました（見本）' : 'キャンセルしました');
          }}>確認ダイアログ</Button>
          <Button variant="secondary" onClick={async () => {
            const reason = await prompt({ title: '録画の公開を止めます', label: '止める理由', placeholder: '例：音声が入っていない', multiline: true, required: true, confirmLabel: '公開を止める' });
            toast.info(reason === null ? 'キャンセルしました' : `理由：${reason}`);
          }}>入力ダイアログ</Button>
          <Button variant="secondary" onClick={() => setModalOpen(true)}>ポップアップ</Button>
          <IconButton label="カレンダーを開く" variant="secondary"><CalendarDays size={18} aria-hidden /></IconButton>
        </div>
        <Modal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          title="振替先を選ぶ"
          description="同じ単元の授業から選べます。"
          footer={<><Button variant="secondary" onClick={() => setModalOpen(false)}>あとで選ぶ</Button><Button onClick={() => setModalOpen(false)}>この授業にする</Button></>}
        >
          <p>{formatDate('2026-10-22')} 1限 理科（物理）</p>
          <p className="text-fg-muted">更新：{formatDateTime(new Date())}</p>
        </Modal>
      </Card>

      <Card>
        <SectionTitle icon={BookOpen} title="用語" description="同じものは同じ名前で呼びます（lib/glossary.ts）。" />
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {Object.entries({
            授業の録画: TERMS.recording, ご褒美: TERMS.coin, その日の授業: TERMS.lesson, 申し込む単位: TERMS.course,
            '教える人（職員向け）': TERMS.teacher, '教える人（生徒向け）': TERMS.teacherForStudent, 保護者と教室のやりとり: TERMS.parentContact,
            教室からの掲示: TERMS.news, 自分宛ての連絡: TERMS.notification, 前の画面へ: TERMS.back,
          }).map(([what, term]) => (
            <div key={what} className="flex justify-between gap-3 border-b border-line py-1.5"><dt className="text-fg-muted">{what}</dt><dd className="font-bold text-fg">{term}</dd></div>
          ))}
        </dl>
      </Card>
    </div>
  );
}
