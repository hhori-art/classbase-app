import type { ReactNode } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  Bell, BookOpenCheck, CalendarCheck, CalendarX2, Camera, Coins, KeyRound, LineChart, Lock, PlayCircle,
  QrCode, ShieldCheck, Smartphone, UserRound, Users, Video,
} from 'lucide-react';
import { CHECKLIST_ROWS_PER_PAGE, issuedDateLabel, passwordChunks, type GuideAccount } from './guide-model';

// ID書面のデザイン。1枚 = A4 縦 1ページ。生徒用（アンバー）と保護者用（ネイビー）は
// 色・見出し・左端の帯で一目で区別できるようにする。

const SUPPORT_TEXT = 'お問い合わせ：創造学園アプリ サポート窓口（078-321-4123）';

type Theme = { strip: string; stripText: string; tag: string; soft: string; border: string; accent: string; ink: string };

const STUDENT_THEME: Theme = {
  strip: 'linear-gradient(180deg, #f59e0b 0%, #f97316 100%)', stripText: '#fff7ed',
  tag: '#f59e0b', soft: '#fffbeb', border: '#fcd34d', accent: '#d97706', ink: '#78350f',
};
const PARENT_THEME: Theme = {
  strip: 'linear-gradient(180deg, #1e3a8a 0%, #0f766e 100%)', stripText: '#e0f2fe',
  tag: '#1e3a8a', soft: '#eff6ff', border: '#bfdbfe', accent: '#1d4ed8', ink: '#172554',
};
const STAFF_THEME: Theme = {
  strip: 'linear-gradient(180deg, #047857 0%, #334155 100%)', stripText: '#ecfdf5',
  tag: '#047857', soft: '#ecfdf5', border: '#a7f3d0', accent: '#047857', ink: '#064e3b',
};

type PageProps = { account: GuideAccount; index: number; total: number; loginUrl: string };

const loginUrlOf = (url: string) => (url || 'https://classbase-app.vercel.app').replace(/\/+$/, '');

/** 左端の帯。束ねた書面をめくっても生徒用・保護者用が分かるよう縦書きで繰り返す。 */
function EdgeStrip({ theme, label, sub }: { theme: Theme; label: string; sub: string }) {
  return (
    <div className="absolute inset-y-0 left-0 flex w-[11mm] flex-col items-center justify-around py-[8mm]" style={{ background: theme.strip, color: theme.stripText }}>
      {[0, 1, 2].map(item => (
        <span key={item} className="text-[13pt] font-black tracking-[0.35em]" style={{ writingMode: 'vertical-rl' }}>
          {label}<span className="text-[8pt] tracking-[0.2em] opacity-80"> {sub}</span>
        </span>
      ))}
    </div>
  );
}

function Page({ children, account, kind }: { children: ReactNode; account?: GuideAccount; kind: string; theme: Theme }) {
  return (
    <article
      className="guide-page relative overflow-hidden bg-white text-slate-900 shadow-xl"
      data-pdf-group={account?.key || ''}
      data-pdf-name={account ? `${account.name}_${kind}` : ''}
      data-pdf-skip={account ? undefined : 'true'}
    >
      {children}
    </article>
  );
}

function Header({ theme, tag, title, sub, index, total, school }: { theme: Theme; tag: string; title: string; sub: string; index: number; total: number; school: string }) {
  return (
    <header className="flex items-start justify-between gap-4">
      <div className="flex items-center gap-[4mm]">
        <div className="rounded-[3mm] px-[4mm] py-[2.2mm] text-white shadow-sm" style={{ background: theme.tag }}>
          <p className="text-[24pt] font-black leading-none tracking-[0.12em]">{tag}</p>
        </div>
        <div>
          <p className="text-[8.5pt] font-black tracking-[0.25em]" style={{ color: theme.accent }}>{sub}</p>
          <h1 className="text-[17pt] font-black leading-tight" style={{ color: theme.ink }}>{title}</h1>
        </div>
      </div>
      <div className="shrink-0 text-right text-[8pt] font-bold leading-relaxed text-slate-500">
        <p>発行日 {issuedDateLabel()}</p>
        {school && <p>{school}</p>}
        <p className="font-mono">No. {index} / {total}</p>
      </div>
    </header>
  );
}

function PasswordBlocks({ value, theme, size = 'lg' }: { value: string; theme: Theme; size?: 'lg' | 'md' }) {
  if (!value) return <p className="text-[11pt] font-black text-rose-600">（パスワードを再発行してください）</p>;
  return (
    <div>
      <p className="flex flex-wrap gap-[1.6mm]" aria-label={value}
        style={{ fontFamily: '"Verdana", "Arial", ui-monospace, Menlo, monospace', fontVariantNumeric: 'tabular-nums' }}>
        {passwordChunks(value).map((chunk, index) => (
          <span key={index} className={`rounded-[1.6mm] border-[0.4mm] bg-white font-black tracking-[0.18em] ${size === 'lg' ? 'px-[2.4mm] py-[1mm] text-[20pt]' : 'px-[2mm] py-[0.6mm] text-[15pt]'}`}
            style={{ borderColor: theme.border, color: '#0f172a' }}>{chunk}</span>
        ))}
      </p>
      <p className="mt-[1.2mm] text-[7.5pt] font-bold text-slate-500">※4文字ずつ区切っています。入力するときにスペースはいりません。</p>
    </div>
  );
}

function LoginIdValue({ value, size = 'lg' }: { value: string; size?: 'lg' | 'md' }) {
  return (
    <p className={`font-black tracking-[0.12em] text-slate-950 ${size === 'lg' ? 'text-[28pt]' : 'text-[21pt]'}`}
      style={{ fontFamily: '"Verdana", "Arial", ui-monospace, Menlo, monospace' }}>{value || '-'}</p>
  );
}

function QrBox({ url, theme, caption, size = 30 }: { url: string; theme: Theme; caption: string; size?: number }) {
  return (
    <div className="flex shrink-0 flex-col items-center rounded-[3mm] border-[0.5mm] bg-white p-[2.5mm] text-center" style={{ borderColor: theme.border }}>
      <QRCodeSVG value={url} size={Math.round(size * 3.78)} style={{ width: `${size}mm`, height: `${size}mm` }} />
      <p className="mt-[1.5mm] flex items-center gap-1 text-[7.5pt] font-black" style={{ color: theme.ink }}><QrCode size={11} />{caption}</p>
    </div>
  );
}

function Footer({ theme, label, account, index, total }: { theme: Theme; label: string; account?: GuideAccount; index?: number; total?: number }) {
  return (
    <footer className="absolute bottom-[9mm] left-[19mm] right-[12mm] flex items-end justify-between border-t-[0.4mm] pt-[2mm]" style={{ borderColor: theme.border }}>
      <div className="text-[7.5pt] font-bold leading-relaxed text-slate-500">
        <p>{SUPPORT_TEXT}</p>
        {account && <p className="font-mono">{label} ・ No.{index}/{total} ・ {[account.school, account.grade, account.name].filter(Boolean).join(' ・ ')}</p>}
      </div>
      <p className="text-[12pt] font-black tracking-[0.2em]" style={{ color: theme.ink }}>創造学園エディック</p>
    </footer>
  );
}

function Steps({ theme, items }: { theme: Theme; items: { icon: ReactNode; title: string; body: string }[] }) {
  return (
    <ol className="grid grid-cols-3 gap-[3mm]">
      {items.map((item, index) => (
        <li key={item.title} className="relative rounded-[3mm] border-[0.4mm] bg-white p-[3mm] pt-[4mm]" style={{ borderColor: theme.border }}>
          <span className="absolute -top-[3mm] left-[3mm] flex h-[6.5mm] w-[6.5mm] items-center justify-center rounded-full text-[10pt] font-black text-white" style={{ background: theme.tag }}>{index + 1}</span>
          <p className="flex items-center gap-[1.5mm] text-[10pt] font-black" style={{ color: theme.ink }}>{item.icon}{item.title}</p>
          <p className="mt-[1mm] text-[8pt] font-bold leading-relaxed text-slate-600">{item.body}</p>
        </li>
      ))}
    </ol>
  );
}

function FeatureGrid({ theme, items, columns = 4 }: { theme: Theme; items: { icon: ReactNode; title: string; body: string }[]; columns?: 2 | 4 }) {
  return (
    <div className={`grid gap-[2.5mm] ${columns === 4 ? 'grid-cols-4' : 'grid-cols-2'}`}>
      {items.map(item => (
        <div key={item.title} className="rounded-[3mm] p-[2.8mm]" style={{ background: theme.soft }}>
          <div className="flex items-center gap-[1.5mm] text-[9.5pt] font-black" style={{ color: theme.ink }}>{item.icon}{item.title}</div>
          <p className="mt-[1mm] text-[7.5pt] font-bold leading-relaxed text-slate-600">{item.body}</p>
        </div>
      ))}
    </div>
  );
}

const iconProps = { size: 15, strokeWidth: 2.6 };

export function StudentGuidePage({ account, index, total, loginUrl }: PageProps) {
  const theme = STUDENT_THEME;
  const url = loginUrlOf(loginUrl);
  const course = [account.grade, account.dayOfWeek && `${account.dayOfWeek}曜日`, account.science && `理科：${account.science}`, account.social && `社会：${account.social}`].filter(Boolean);
  return (
    <Page account={account} kind="生徒用" theme={theme}>
      <EdgeStrip theme={theme} label="生徒用" sub="STUDENT" />
      <div className="absolute inset-0 pb-[9mm] pl-[19mm] pr-[12mm] pt-[11mm]">
        <Header theme={theme} tag="生徒用" title="創造学園アプリ ログインカード" sub="FOR STUDENTS" index={index} total={total} school={account.school} />

        <section className="mt-[6mm]">
          <p className="text-[22pt] font-black leading-tight text-slate-900">{account.name}<span className="ml-2 text-[14pt]">さんへ</span></p>
          <p className="mt-[1.5mm] text-[10pt] font-bold leading-relaxed text-slate-600">
            きみ専用のアカウントができました！ 下のログインIDとパスワードで「創造学園アプリ」に入れます。
          </p>
        </section>

        <section className="mt-[5mm] overflow-hidden rounded-[5mm] border-[1mm]" style={{ borderColor: theme.tag, background: `linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)` }}>
          <div className="flex items-center justify-between px-[5mm] py-[2mm] text-white" style={{ background: theme.tag }}>
            <p className="flex items-center gap-[2mm] text-[10pt] font-black tracking-[0.2em]"><UserRound size={16} strokeWidth={3} />STUDENT LOGIN CARD</p>
            <p className="text-[9pt] font-black">ログインするときに使います</p>
          </div>
          <div className="flex gap-[5mm] p-[5mm]">
            <div className="min-w-0 flex-1 space-y-[4mm]">
              <div>
                <p className="flex items-center gap-[1.5mm] text-[9pt] font-black" style={{ color: theme.accent }}><UserRound {...iconProps} />ログインID</p>
                <LoginIdValue value={account.loginId} />
              </div>
              <div>
                <p className="mb-[1mm] flex items-center gap-[1.5mm] text-[9pt] font-black" style={{ color: theme.accent }}><KeyRound {...iconProps} />はじめのパスワード</p>
                <PasswordBlocks value={account.password} theme={theme} />
              </div>
            </div>
            <QrBox url={url} theme={theme} caption="カメラでよみとってね" size={32} />
          </div>
          <p className="border-t-[0.4mm] px-[5mm] py-[1.8mm] font-mono text-[9pt] font-black" style={{ borderColor: theme.border, color: theme.ink }}>{url}</p>
        </section>

        <h2 className="mb-[3.5mm] mt-[6mm] text-[11pt] font-black" style={{ color: theme.ink }}>はじめてログインするとき</h2>
        <Steps theme={theme} items={[
          { icon: <QrCode {...iconProps} />, title: 'QRをよみとる', body: 'スマホやタブレットのカメラで上のQRコードをよみとるか、URLを入力します。' },
          { icon: <KeyRound {...iconProps} />, title: 'IDとパスワード', body: 'ログインIDとはじめのパスワードを入力して「ログイン」をおします。' },
          { icon: <Lock {...iconProps} />, title: '新しいパスワード', body: '自分だけの新しいパスワードを決めます。忘れないようにメモしておこう。' },
        ]} />

        <h2 className="mb-[2.5mm] mt-[6mm] text-[11pt] font-black" style={{ color: theme.ink }}>アプリでできること</h2>
        <FeatureGrid theme={theme} items={[
          { icon: <Video {...iconProps} />, title: '授業に参加', body: 'ボタンひとつでオンライン授業に入れます。' },
          { icon: <PlayCircle {...iconProps} />, title: '録画で復習', body: '授業の録画を見て、何度でも復習できます。' },
          { icon: <Camera {...iconProps} />, title: '宿題を提出', body: 'ノートを撮影して、宿題を提出できます。' },
          { icon: <Coins {...iconProps} />, title: 'コインを集める', body: 'がんばるとコインやバッジがもらえます。' },
        ]} />

        {course.length > 0 && (
          <div className="mt-[4mm] flex flex-wrap items-center gap-[1.5mm]">
            <span className="text-[8.5pt] font-black text-slate-500">受講情報</span>
            {course.map(item => <span key={item} className="rounded-full px-[2.5mm] py-[0.6mm] text-[8.5pt] font-black" style={{ background: theme.soft, color: theme.ink }}>{item}</span>)}
          </div>
        )}

        <section className="mt-[5mm] rounded-[3mm] border-[0.5mm] border-dashed p-[3mm]" style={{ borderColor: theme.border }}>
          <p className="flex items-center gap-[1.5mm] text-[10pt] font-black" style={{ color: theme.ink }}><ShieldCheck {...iconProps} />やくそく</p>
          <ul className="mt-[1.5mm] grid grid-cols-2 gap-x-[4mm] gap-y-[0.8mm] text-[8.5pt] font-bold text-slate-700">
            <li>✔ パスワードは友だちに教えない</li>
            <li>✔ この紙はおうちの人と大切にしまう</li>
            <li>✔ ログインできないときは先生に相談</li>
            <li>✔ 大文字・小文字・数字をよく見て入力</li>
          </ul>
        </section>
      </div>
      <Footer theme={theme} label="生徒用" account={account} index={index} total={total} />
    </Page>
  );
}

export function ParentGuidePage({ account, index, total, loginUrl }: PageProps) {
  const theme = PARENT_THEME;
  const url = loginUrlOf(loginUrl);
  const standalone = account.kind === 'parent';
  const childName = standalone ? account.childName : account.name;
  const loginId = standalone ? account.loginId : account.parent.loginId;
  const password = standalone ? account.password : account.parent.password;
  return (
    <Page account={account} kind="保護者用" theme={theme}>
      <EdgeStrip theme={theme} label="保護者用" sub="PARENTS" />
      <div className="absolute inset-0 pb-[9mm] pl-[19mm] pr-[12mm] pt-[11mm]">
        <Header theme={theme} tag="保護者用" title="保護者アカウントのご案内" sub="FOR PARENTS / GUARDIANS" index={index} total={total} school={account.school} />

        <section className="mt-[6mm]">
          <p className="text-[16pt] font-black text-slate-900">
            {childName ? <>{childName}<span className="ml-1 text-[12pt]">さんの</span>保護者様</> : <>{account.name}<span className="ml-1 text-[12pt]">様</span></>}
          </p>
          <p className="mt-[2mm] text-[9.5pt] font-medium leading-[1.85] text-slate-700">
            平素より創造学園をご利用いただき、誠にありがとうございます。保護者様専用のアカウントをご用意いたしました。
            下記のログインIDと初期パスワードで「創造学園アプリ」にログインし、お子様の受講状況の確認や教室へのご連絡にご利用ください。
          </p>
        </section>

        <section className="mt-[5mm] overflow-hidden rounded-[3mm] border-[0.6mm]" style={{ borderColor: theme.tag }}>
          <div className="flex items-center justify-between px-[5mm] py-[2mm] text-white" style={{ background: theme.tag }}>
            <p className="flex items-center gap-[2mm] text-[10pt] font-black tracking-[0.15em]"><Users size={16} strokeWidth={2.6} />保護者アカウント</p>
            <p className="text-[8.5pt] font-bold">お子様とは別のアカウントです</p>
          </div>
          <div className="flex gap-[5mm] p-[5mm]">
            <table className="min-w-0 flex-1 border-separate border-spacing-y-[2.5mm]">
              <tbody>
                <tr>
                  <th className="w-[30mm] pr-[3mm] text-left align-top text-[9pt] font-black" style={{ color: theme.accent }}>ログインID</th>
                  <td>
                    <LoginIdValue value={loginId} size="md" />
                    {!standalone && <p className="text-[7.5pt] font-bold text-slate-500">お子様のログインIDの末尾に「P」が付いたものです。</p>}
                  </td>
                </tr>
                <tr>
                  <th className="pr-[3mm] text-left align-top text-[9pt] font-black" style={{ color: theme.accent }}>初期パスワード</th>
                  <td><PasswordBlocks value={password} theme={theme} size="md" /></td>
                </tr>
              </tbody>
            </table>
            <QrBox url={url} theme={theme} caption="ログイン画面を開く" size={28} />
          </div>
          <p className="border-t-[0.4mm] px-[5mm] py-[1.8mm] font-mono text-[9pt] font-bold" style={{ borderColor: theme.border, color: theme.ink }}>{url}</p>
        </section>

        <h2 className="mb-[2.5mm] mt-[6mm] text-[11pt] font-black" style={{ color: theme.ink }}>保護者アカウントでできること</h2>
        <FeatureGrid theme={theme} columns={2} items={[
          { icon: <CalendarCheck {...iconProps} />, title: '出席・受講状況の確認', body: '授業への参加状況や受講中の講座を確認できます。' },
          { icon: <CalendarX2 {...iconProps} />, title: '欠席・振替のご連絡', body: '欠席のご連絡や振替の手続きをアプリから行えます。' },
          { icon: <Bell {...iconProps} />, title: '教室からのお知らせ', body: '休講や行事などのお知らせを受け取れます。' },
          { icon: <LineChart {...iconProps} />, title: '学習状況の確認', body: '宿題の提出や学習の記録を確認できます。' },
        ]} />

        {!standalone && (
          <section className="mt-[4mm] flex items-center gap-[4mm] rounded-[3mm] p-[3mm]" style={{ background: theme.soft }}>
            <BookOpenCheck size={22} style={{ color: theme.accent }} className="shrink-0" />
            <div className="text-[8.5pt] font-bold leading-relaxed text-slate-700">
              <p><b style={{ color: theme.ink }}>お子様のログインID：</b><span className="font-mono text-[10pt] font-black">{account.loginId || '-'}</span></p>
              <p>お子様には別紙「<b>生徒用</b>」をお渡しください（お子様のパスワードは生徒用に記載しています）。</p>
            </div>
          </section>
        )}

        <h2 className="mb-[3.5mm] mt-[6mm] text-[11pt] font-black" style={{ color: theme.ink }}>初回ログインの手順</h2>
        <Steps theme={theme} items={[
          { icon: <Smartphone {...iconProps} />, title: 'ログイン画面を開く', body: 'QRコードを読み取るか、上記URLをブラウザに入力してください。' },
          { icon: <KeyRound {...iconProps} />, title: 'IDとパスワードを入力', body: '保護者用のログインIDと初期パスワードを入力してください。' },
          { icon: <Lock {...iconProps} />, title: 'パスワードを変更', body: '画面の案内に沿って、新しいパスワードを設定してください。' },
        ]} />

        <section className="mt-[5mm] text-[8pt] font-bold leading-relaxed text-slate-600">
          <p className="mb-[1mm] text-[9pt] font-black" style={{ color: theme.ink }}>ご注意</p>
          <p>・ログインIDとパスワードは第三者に知られないよう、大切に保管してください。</p>
          <p>・本書面を紛失された場合や、ログインできない場合は教室までお問い合わせください。</p>
        </section>
      </div>
      <Footer theme={theme} label="保護者用" account={account} index={index} total={total} />
    </Page>
  );
}

/** 両面印刷で表裏をそろえるための裏面（保護者アカウントがない・ご利用中の場合）。 */
export function ParentPlaceholderPage({ account, index, total }: Omit<PageProps, 'loginUrl'>) {
  const theme = PARENT_THEME;
  const activated = account.parent.status === 'activated';
  const isStudent = account.kind === 'student';
  return (
    <Page account={account} kind="保護者用" theme={theme}>
      <EdgeStrip theme={theme} label="保護者用" sub="PARENTS" />
      <div className="absolute inset-0 flex flex-col items-center justify-center pl-[19mm] pr-[12mm] text-center">
        <Users size={40} style={{ color: theme.border }} />
        <p className="mt-[4mm] text-[13pt] font-black" style={{ color: theme.ink }}>
          {!isStudent ? '（裏面は空白です）' : activated ? '保護者アカウントはすでにご利用中です' : '保護者アカウントは発行されていません'}
        </p>
        {isStudent && (
          <p className="mt-[2mm] text-[9pt] font-bold leading-relaxed text-slate-500">
            {activated ? 'パスワードは変更していません。ログインできない場合は教室までお問い合わせください。' : '必要な場合は教室までお問い合わせください。'}
          </p>
        )}
        <p className="mt-[6mm] text-[7.5pt] font-bold text-slate-400">この面は両面印刷で表裏をそろえるためのページです。</p>
      </div>
      <Footer theme={theme} label="保護者用" account={account} index={index} total={total} />
    </Page>
  );
}

export function StaffGuidePage({ account, index, total, loginUrl }: PageProps) {
  const theme = STAFF_THEME;
  const url = loginUrlOf(loginUrl);
  const manualUrl = `${url}/manual`;
  return (
    <Page account={account} kind={`${account.staffLabel}用`} theme={theme}>
      <EdgeStrip theme={theme} label={`${account.staffLabel}用`} sub="STAFF" />
      <div className="absolute inset-0 pb-[9mm] pl-[19mm] pr-[12mm] pt-[11mm]">
        <Header theme={theme} tag={`${account.staffLabel}用`} title="創造学園アプリ アカウントのご案内" sub="FOR STAFF" index={index} total={total} school={account.school} />
        <section className="mt-[6mm]">
          <p className="text-[18pt] font-black text-slate-900">{account.name}<span className="ml-2 text-[12pt]">{account.isTeacher ? '先生' : '様'}</span></p>
          <p className="mt-[2mm] text-[9.5pt] font-medium leading-[1.85] text-slate-700">
            {account.isTeacher
              ? '本アカウントは、創造学園での勤務に関する打刻・勤務詳細・交通費等を登録するためのものです。担当する業務にかかわらず、下記の職員番号と初期パスワードでログインしてください。'
              : '創造学園アプリの管理者アカウントをご用意しました。下記のIDと初期パスワードでログインしてください。'}
          </p>
        </section>
        <section className="mt-[5mm] overflow-hidden rounded-[3mm] border-[0.6mm]" style={{ borderColor: theme.tag }}>
          <div className="flex gap-[5mm] p-[5mm]">
            <div className="min-w-0 flex-1 space-y-[4mm]">
              <div>
                <p className="text-[9pt] font-black" style={{ color: theme.accent }}>{account.isTeacher ? 'ログインID（職員番号）' : 'ログインID'}</p>
                <LoginIdValue value={account.loginId} size="md" />
              </div>
              <div>
                <p className="mb-[1mm] text-[9pt] font-black" style={{ color: theme.accent }}>初期パスワード</p>
                <PasswordBlocks value={account.password} theme={theme} size="md" />
              </div>
            </div>
            <QrBox url={url} theme={theme} caption="ログイン画面を開く" size={28} />
          </div>
          <p className="border-t-[0.4mm] px-[5mm] py-[1.8mm] font-mono text-[9pt] font-bold" style={{ borderColor: theme.border, color: theme.ink }}>{url}</p>
        </section>
        <h2 className="mb-[3.5mm] mt-[6mm] text-[11pt] font-black" style={{ color: theme.ink }}>初回ログインの手順</h2>
        <Steps theme={theme} items={[
          { icon: <Smartphone {...iconProps} />, title: 'ログイン画面を開く', body: 'QRコードを読み取るか、上記URLを開きます。' },
          { icon: <KeyRound {...iconProps} />, title: 'IDとパスワード', body: account.isTeacher ? '職員番号と初期パスワードを入力します。' : 'ログインIDと初期パスワードを入力します。' },
          { icon: <Lock {...iconProps} />, title: 'パスワードを変更', body: '画面の案内に沿って新しいパスワードを設定します。' },
        ]} />
        {account.isTeacher && (
          <section className="mt-[6mm] flex items-center gap-[5mm] rounded-[3mm] p-[4mm]" style={{ background: theme.soft }}>
            <div className="min-w-0 flex-1">
              <p className="text-[10.5pt] font-black" style={{ color: theme.ink }}>講師向け 勤怠登録マニュアル</p>
              <ol className="mt-[2mm] space-y-[1mm] text-[8.5pt] font-bold leading-relaxed text-slate-700">
                <li>1. 勤務開始時に「出勤する」、勤務終了時に「退勤する」を押します。</li>
                <li>2. 退勤後、「詳細・交通費を入力」から業務区分と時間を登録します。</li>
                <li>3. 入力内容を確認し、「保存して完了」を押します。</li>
              </ol>
              <p className="mt-[2mm] break-all font-mono text-[7.5pt] font-bold" style={{ color: theme.ink }}>{manualUrl}</p>
            </div>
            <QrBox url={manualUrl} theme={theme} caption="マニュアル（ログイン不要）" size={24} />
          </section>
        )}
        <section className="mt-[5mm] text-[8pt] font-bold leading-relaxed text-slate-600">
          <p>・IDとパスワードは第三者に知られないよう、大切に保管してください。</p>
          <p>・ログインできない場合は、大文字・小文字と数字をご確認ください。</p>
        </section>
      </div>
      <Footer theme={theme} label={`${account.staffLabel}用`} account={account} index={index} total={total} />
    </Page>
  );
}

/** 大量発行時の配布チェック表（生徒用・保護者用の受け渡しを記録する）。 */
export function ChecklistPage({ rows, startIndex, page, pageCount, total, title }: { rows: GuideAccount[]; startIndex: number; page: number; pageCount: number; total: number; title: string }) {
  const theme = STAFF_THEME;
  const blankRows = Math.max(0, CHECKLIST_ROWS_PER_PAGE - rows.length);
  return (
    <Page kind="配布チェック表" theme={theme}>
      <div className="absolute inset-0 px-[12mm] pb-[10mm] pt-[11mm]">
        <header className="flex items-end justify-between border-b-[0.6mm] border-slate-800 pb-[2mm]">
          <div>
            <p className="text-[8pt] font-black tracking-[0.2em] text-slate-500">DISTRIBUTION CHECKLIST</p>
            <h1 className="text-[16pt] font-black text-slate-900">ID書面 配布チェック表</h1>
            {title && <p className="text-[9pt] font-bold text-slate-600">{title}</p>}
          </div>
          <div className="text-right text-[8.5pt] font-bold text-slate-600">
            <p>発行日 {issuedDateLabel()}</p>
            <p>全{total}名 ・ {page}/{pageCount}ページ</p>
          </div>
        </header>
        <table className="mt-[3mm] w-full border-collapse text-[8.5pt]">
          <thead>
            <tr className="bg-slate-100 text-left">
              {['No.', '学年', '氏名', '生徒ID', '保護者ID', '生徒用', '保護者用', '備考'].map(head => (
                <th key={head} className="border border-slate-300 px-[1.5mm] py-[1.2mm] font-black text-slate-700">{head}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, offset) => (
              <tr key={row.key} className="h-[8.6mm]">
                <td className="w-[10mm] border border-slate-300 px-[1.5mm] font-mono">{startIndex + offset + 1}</td>
                <td className="w-[13mm] border border-slate-300 px-[1.5mm]">{row.grade}</td>
                <td className="border border-slate-300 px-[1.5mm] font-bold">{row.name}</td>
                <td className="w-[24mm] border border-slate-300 px-[1.5mm] font-mono">{row.kind === 'parent' ? '-' : row.loginId}</td>
                <td className="w-[24mm] border border-slate-300 px-[1.5mm] font-mono">
                  {row.kind === 'parent' ? row.loginId : row.parent.status === 'issued' ? row.parent.loginId : row.parent.status === 'activated' ? '利用中' : '-'}
                </td>
                <td className="w-[13mm] border border-slate-300 text-center text-[11pt] text-slate-300">□</td>
                <td className="w-[17mm] border border-slate-300 text-center text-[11pt] text-slate-300">{row.kind === 'parent' || (row.kind === 'student' && row.parent.status === 'issued') ? '□' : ''}</td>
                <td className="w-[28mm] border border-slate-300" />
              </tr>
            ))}
            {Array.from({ length: rows.length === 0 ? 0 : blankRows }, (_, offset) => (
              <tr key={`blank-${offset}`} className="h-[8.6mm]">{Array.from({ length: 8 }, (__, cell) => <td key={cell} className="border border-slate-200" />)}</tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="mt-[20mm] text-center text-[9pt] font-bold text-slate-400">（両面印刷の位置合わせ用の白紙です）</p>}
      </div>
    </Page>
  );
}
