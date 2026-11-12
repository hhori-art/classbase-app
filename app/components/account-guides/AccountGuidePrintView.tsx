'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Download, FileSpreadsheet, Loader2, Printer, X } from 'lucide-react';
import {
  applyRosterNames, buildGuidePages, DEFAULT_GUIDE_PRINT_OPTIONS, GUIDE_PAGE_MARGIN_MM, GUIDE_PRINT_CSS, matchRosterNames, parseRosterTable, rosterKeyOf,
  type GuideAccount, type GuideOrder, type GuidePrintOptions, type RosterMatch,
} from './guide-model';
import { useToast } from '@/app/components/ui/feedback';
import { ChecklistPage, ParentGuidePage, ParentPlaceholderPage, StaffGuidePage, StudentGuidePage } from './GuidePages';
import { userErrorMessage } from '@/lib/user-error';

const ORDER_LABELS: Record<GuideOrder, { label: string; description: string }> = {
  alternate: { label: '生徒用→保護者用を交互', description: '1人ずつ生徒用・保護者用の順に出します' },
  grouped: { label: '生徒用をまとめて→保護者用', description: '配る相手ごとに束を分けたいとき' },
  'student-only': { label: '生徒用だけ', description: '' },
  'parent-only': { label: '保護者用だけ', description: '' },
};

/** CSV ファイルを UTF-8 で読み、文字化けする場合は Shift_JIS（Excel 保存）として読み直す。 */
async function readRosterFile(file: File) {
  const buffer = await file.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('shift_jis').decode(buffer);
  }
}

const safeFileName = (value: string) => value.replace(/[\\/:*?"<>|\u0000-\u001F]/g, '_').trim().slice(0, 80) || 'account';

type Props = {
  accounts: GuideAccount[];
  loginUrl: string;
  /** チェック表・ZIP名に使う発行の名前（例：校舎名・CSVファイル名）。 */
  title: string;
  onClose: () => void;
  /** 同期で除外したアカウントの案内など、操作バーの下に出す内容。 */
  notice?: ReactNode;
  initialOptions?: Partial<GuidePrintOptions>;
};

/** ID書面の印刷プレビュー（body 直下に表示し、印刷時は書面だけを出力する）。 */
export default function AccountGuidePrintView({ accounts, loginUrl, title, onClose, notice, initialOptions }: Props) {
  const toast = useToast();
  const [options, setOptions] = useState<GuidePrintOptions>({ ...DEFAULT_GUIDE_PRINT_OPTIONS, ...initialOptions });
  const [pdfProgress, setPdfProgress] = useState<{ current: number; total: number } | null>(null);
  // 名簿（氏名）は画面のメモリ上だけで使い、保存・送信しない。閉じると消える。
  const [rosterOpen, setRosterOpen] = useState(false);
  const [rosterText, setRosterText] = useState('');
  const [roster, setRoster] = useState<RosterMatch | null>(null);
  const [skipUnnamed, setSkipUnnamed] = useState(false);
  const printAccounts = useMemo(() => {
    if (!roster) return accounts;
    const named = applyRosterNames(accounts, roster.names);
    if (!skipUnnamed) return named;
    const missing = new Set(roster.missing);
    return named.filter(account => account.kind === 'staff' || !missing.has(rosterKeyOf(account)));
  }, [accounts, roster, skipUnnamed]);
  const pages = useMemo(() => buildGuidePages(printAccounts, options), [printAccounts, options]);

  const applyRoster = (source: string) => {
    const result = matchRosterNames(parseRosterTable(source), accounts);
    setRoster(result);
    if (result.matched === 0) toast.error('名簿の中に、書面の生徒IDと一致する行が見つかりませんでした。「生徒ID」と「氏名」の列があるか確認してください。');
  };
  const loadRosterFile = async (file: File | undefined) => {
    if (!file) return;
    const source = await readRosterFile(file);
    setRosterText('');
    applyRoster(source);
  };
  const clearRoster = () => {
    setRoster(null);
    setRosterText('');
    setSkipUnnamed(false);
  };
  const studentCount = printAccounts.filter(account => account.kind === 'student').length;
  const parentCount = printAccounts.filter(account => (account.kind === 'student' && account.parent.status === 'issued') || account.kind === 'parent').length;
  const hasStudents = accounts.some(account => account.kind === 'student');
  const rosterTargetCount = accounts.filter(account => account.kind !== 'staff').length;
  const total = printAccounts.length;

  const exportPdfs = async () => {
    if (pdfProgress) return;
    try {
      if (document.fonts?.ready) await document.fonts.ready;
      const elements = Array.from(document.querySelectorAll<HTMLElement>('#guide-print-root .guide-page'))
        .filter(element => element.dataset.pdfSkip !== 'true' && element.dataset.pdfGroup);
      // 1人分（生徒用＋保護者用）を1つのPDFにまとめる。
      const groups = new Map<string, HTMLElement[]>();
      elements.forEach(element => {
        const key = element.dataset.pdfGroup!;
        groups.set(key, [...(groups.get(key) || []), element]);
      });
      if (groups.size === 0) return;
      const [{ default: html2canvas }, { jsPDF }, { default: JSZip }] = await Promise.all([import('html2canvas'), import('jspdf'), import('jszip')]);
      const zip = new JSZip();
      const usedNames = new Set<string>();
      let done = 0;
      setPdfProgress({ current: 0, total: groups.size });
      for (const [, groupPages] of groups) {
        const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
        for (let index = 0; index < groupPages.length; index++) {
          // 画面外の書面も描画されるよう content-visibility を一時的に解除する。
          groupPages[index].style.contentVisibility = 'visible';
          // html2canvas は zoom に対応しないため、実寸（A4）の書面を撮ってPDFの余白内に縮小して置く。
          const sheet = groupPages[index].querySelector<HTMLElement>('.guide-sheet') || groupPages[index];
          sheet.style.zoom = '1';
          const canvas = await html2canvas(sheet, { scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false });
          sheet.style.zoom = '';
          if (index > 0) pdf.addPage();
          const width = 210 - GUIDE_PAGE_MARGIN_MM * 2;
          const height = width * (297 / 210);
          pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', GUIDE_PAGE_MARGIN_MM, (297 - height) / 2, width, height, undefined, 'FAST');
          groupPages[index].style.contentVisibility = '';
        }
        const baseName = safeFileName(String(groupPages[0].dataset.pdfName || 'account').replace(/_(生徒用|保護者用|講師用|管理者用)$/, ''));
        let fileName = `${String(++done).padStart(3, '0')}_${baseName}_ID書面.pdf`;
        if (usedNames.has(fileName)) fileName = fileName.replace('.pdf', `_${done}.pdf`);
        usedNames.add(fileName);
        zip.file(fileName, pdf.output('arraybuffer'));
        setPdfProgress({ current: done, total: groups.size });
      }
      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${safeFileName(title || 'ID書面')}_個別PDF.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error: any) {
      toast.error(`PDFの作成に失敗しました。${userErrorMessage(error, '')}`);
    } finally {
      setPdfProgress(null);
    }
  };

  // ロゴ画像の読み込みが終わってから印刷する（未読込のまま印刷すると空白になるため）。
  const printNow = async () => {
    const images = Array.from(document.querySelectorAll<HTMLImageElement>('#guide-print-root .guide-page img'));
    await Promise.all(images.map(image => image.complete ? Promise.resolve() : image.decode().catch(() => undefined)));
    window.print();
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div id="guide-print-root" className="guide-print-root fixed inset-0 z-[9999] overflow-y-auto bg-slate-200 print:static print:overflow-visible print:bg-white">
      {/* 中身は固定の印刷用CSSだけ（GUIDE_PRINT_CSS の埋め込みも定数の計算値のみ）で、利用者の入力は入らないため安全。 */}
      <style dangerouslySetInnerHTML={{ __html: `
        @media print { body > *:not(#guide-print-root) { display: none !important; } }
        ${GUIDE_PRINT_CSS}
      ` }} />

      <div className="guide-print-hide sticky top-0 z-50 border-b border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-black text-slate-800"><Printer size={20} className="text-indigo-600" />ID書面プレビュー</h2>
            <p className="mt-0.5 text-xs font-bold text-slate-500">
              {total}名分 ・ 生徒用 {studentCount}枚 ・ 保護者用 {parentCount}枚 ・ 合計 {pages.length}ページ
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => void printNow()} className="flex items-center gap-2 rounded-xl bg-indigo-600 px-6 py-2.5 text-sm font-black text-white hover:bg-indigo-700">
              <Printer size={18} />印刷する
            </button>
            <button onClick={() => void exportPdfs()} disabled={Boolean(pdfProgress)} className="flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-black text-white hover:bg-emerald-700 disabled:cursor-wait disabled:opacity-60">
              {pdfProgress ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
              {pdfProgress ? `PDF作成中 ${pdfProgress.current}/${pdfProgress.total}` : '1人ずつのPDFをZIPで保存'}
            </button>
            <button onClick={onClose} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-black text-slate-600 hover:bg-slate-50">
              <X size={18} />閉じる
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-4 py-3">
          {hasStudents && (Object.keys(ORDER_LABELS) as GuideOrder[]).map(order => (
            <button key={order} onClick={() => setOptions(prev => ({ ...prev, order }))} title={ORDER_LABELS[order].description}
              className={`rounded-full px-3 py-1.5 text-xs font-black ${options.order === order ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
              {ORDER_LABELS[order].label}
            </button>
          ))}
          {hasStudents && options.order === 'alternate' && (
            <label className="flex cursor-pointer items-center gap-2 rounded-full bg-sky-50 px-3 py-1.5 text-xs font-black text-sky-800">
              <input type="checkbox" checked={options.duplex} onChange={event => setOptions(prev => ({ ...prev, duplex: event.target.checked }))} className="h-4 w-4 accent-sky-600" />
              両面印刷（表：生徒用／裏：保護者用）
            </label>
          )}
          <label className="flex cursor-pointer items-center gap-2 rounded-full bg-amber-50 px-3 py-1.5 text-xs font-black text-amber-800">
            <input type="checkbox" checked={options.checklist} onChange={event => setOptions(prev => ({ ...prev, checklist: event.target.checked }))} className="h-4 w-4 accent-amber-600" />
            先頭に配布チェック表を付ける
          </label>
          {rosterTargetCount > 0 && (
            <button onClick={() => setRosterOpen(open => !open)} className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-black ${roster ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100'}`}>
              <FileSpreadsheet size={14} />{roster ? `名簿の氏名を差し込み中（${roster.matched}/${rosterTargetCount}名）` : '名簿から氏名を差し込む'}
            </button>
          )}
          <span className="text-[11px] font-bold text-slate-400">用紙はA4・縦。印刷設定は変えずにそのまま印刷できます。</span>
        </div>
        {rosterOpen && rosterTargetCount > 0 && (
          <div className="space-y-3 border-t border-slate-100 bg-emerald-50/40 px-4 py-3">
            <p className="text-xs font-bold leading-5 text-slate-600">
              手元の名簿（スプレッドシート）の<b>生徒ID</b>と照らし合わせて、書面の氏名だけを差し替えます。
              名簿はこの画面の中だけで使い、<b>サーバーには送信・保存しません</b>（閉じると消えます）。
              1行目に「生徒ID」「氏名」（または「姓」「名」）の見出しを付けてください。
            </p>
            <div className="flex flex-col gap-2 lg:flex-row lg:items-start">
              <textarea
                value={rosterText}
                onChange={event => setRosterText(event.target.value)}
                placeholder={'スプレッドシートの範囲をコピーして貼り付け\n生徒ID\t氏名\n22220001\t山田 太郎'}
                rows={3}
                className="min-h-[72px] flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-xs outline-none focus:border-emerald-400"
              />
              <div className="flex shrink-0 flex-wrap gap-2">
                <button onClick={() => applyRoster(rosterText)} disabled={!rosterText.trim()} className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-black text-white hover:bg-emerald-700 disabled:opacity-40">貼り付けた名簿を反映</button>
                <label className="cursor-pointer rounded-xl border border-emerald-200 bg-white px-4 py-2 text-xs font-black text-emerald-700 hover:bg-emerald-50">
                  CSVファイルを選ぶ
                  <input type="file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values" className="hidden" onChange={event => { void loadRosterFile(event.target.files?.[0]); event.target.value = ''; }} />
                </label>
                {roster && <button onClick={clearRoster} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-black text-slate-600 hover:bg-slate-50">差し込みをやめる</button>}
              </div>
            </div>
            {roster && (
              <div className="space-y-2 text-xs font-bold">
                <p className={roster.missing.length ? 'text-amber-700' : 'text-emerald-700'}>
                  {rosterTargetCount}名中 {roster.matched}名の氏名を差し込みました。
                  {roster.missing.length > 0 && <> 名簿に見つからない生徒ID：{roster.missing.slice(0, 12).join('、')}{roster.missing.length > 12 && ` ほか${roster.missing.length - 12}名`}</>}
                </p>
                {roster.matched > 0 && (
                  <p className="text-slate-500">確認：{Array.from(roster.names.entries()).slice(0, 3).map(([id, name]) => `${id} → ${name}`).join(' ／ ')}</p>
                )}
                {roster.missing.length > 0 && (
                  <label className="flex w-fit cursor-pointer items-center gap-2 text-amber-800">
                    <input type="checkbox" checked={skipUnnamed} onChange={event => setSkipUnnamed(event.target.checked)} className="h-4 w-4 accent-amber-600" />
                    名簿に見つからない生徒は印刷しない
                  </label>
                )}
              </div>
            )}
          </div>
        )}
        {notice && <div className="border-t border-slate-100 px-4 py-3">{notice}</div>}
      </div>

      <div className="guide-print-pages flex min-w-max flex-col items-center gap-8 py-8">
        {pages.map((page, position) => {
          const key = `${page.type}-${'account' in page ? page.account.key : `checklist-${page.page}`}-${position}`;
          switch (page.type) {
            case 'student': return <StudentGuidePage key={key} account={page.account} index={page.index} total={total} loginUrl={loginUrl} />;
            case 'parent': return <ParentGuidePage key={key} account={page.account} index={page.index} total={total} loginUrl={loginUrl} />;
            case 'parent-placeholder': return <ParentPlaceholderPage key={key} account={page.account} index={page.index} total={total} />;
            case 'staff': return <StaffGuidePage key={key} account={page.account} index={page.index} total={total} loginUrl={loginUrl} />;
            case 'checklist': return <ChecklistPage key={key} rows={page.rows} startIndex={page.startIndex} page={page.page} pageCount={page.pageCount} total={total} title={title} />;
            default: return null;
          }
        })}
      </div>
    </div>,
    document.body,
  );
}
