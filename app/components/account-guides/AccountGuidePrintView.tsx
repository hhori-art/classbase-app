'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Download, Loader2, Printer, X } from 'lucide-react';
import {
  buildGuidePages, DEFAULT_GUIDE_PRINT_OPTIONS, GUIDE_PRINT_CSS,
  type GuideAccount, type GuideOrder, type GuidePrintOptions,
} from './guide-model';
import { ChecklistPage, ParentGuidePage, ParentPlaceholderPage, StaffGuidePage, StudentGuidePage } from './GuidePages';

const ORDER_LABELS: Record<GuideOrder, { label: string; description: string }> = {
  alternate: { label: '生徒用→保護者用を交互', description: '1人ずつ生徒用・保護者用の順に出します' },
  grouped: { label: '生徒用をまとめて→保護者用', description: '配る相手ごとに束を分けたいとき' },
  'student-only': { label: '生徒用だけ', description: '' },
  'parent-only': { label: '保護者用だけ', description: '' },
};

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
  const [options, setOptions] = useState<GuidePrintOptions>({ ...DEFAULT_GUIDE_PRINT_OPTIONS, ...initialOptions });
  const [pdfProgress, setPdfProgress] = useState<{ current: number; total: number } | null>(null);
  const pages = useMemo(() => buildGuidePages(accounts, options), [accounts, options]);
  const studentCount = accounts.filter(account => account.kind === 'student').length;
  const parentCount = accounts.filter(account => (account.kind === 'student' && account.parent.status === 'issued') || account.kind === 'parent').length;
  const hasStudents = studentCount > 0;
  const total = accounts.length;

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
          const canvas = await html2canvas(groupPages[index], { scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false });
          if (index > 0) pdf.addPage();
          pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
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
      alert(`PDFの作成に失敗しました。\n${error?.message || error}`);
    } finally {
      setPdfProgress(null);
    }
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div id="guide-print-root" className="guide-print-root fixed inset-0 z-[9999] overflow-y-auto bg-slate-200 print:static print:overflow-visible print:bg-white">
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
            <button onClick={() => window.print()} className="flex items-center gap-2 rounded-xl bg-indigo-600 px-6 py-2.5 text-sm font-black text-white hover:bg-indigo-700">
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
          <span className="text-[11px] font-bold text-slate-400">印刷設定は「A4・縦・余白なし・倍率100%」にしてください。</span>
        </div>
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
