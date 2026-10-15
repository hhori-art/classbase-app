'use client';

import { useEffect, useState, useRef } from 'react';
import { Loader2, FileUp, CheckCircle, AlertCircle, Download } from 'lucide-react';
import { auth } from '@/lib/firebase';
import CsvSampleDownload from '@/app/components/CsvSampleDownload';
import { generateInitialPassword } from '@/lib/password';
import AccountGuideSheet from '@/app/components/AccountGuideSheet';
import { parseAccountCsv, uniqueImportFileName } from '@/lib/account-import-csv';
import { attendanceSchoolName, resolveAttendanceSchoolCode } from '@/lib/attendance-schools';

interface Props {
  role: 'student' | 'teacher';
  onSuccess: () => void;
}

export default function AccountImportButton({ role, onSuccess }: Props) {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [msg, setMsg] = useState('');
  const [importedAccounts, setImportedAccounts] = useState<any[]>([]);
  const [isPdfExporting, setIsPdfExporting] = useState(false);
  const [pdfProgress, setPdfProgress] = useState({ current: 0, total: 0 });
  const [loginUrl, setLoginUrl] = useState('https://classbase-app.vercel.app');
  const [encoding, setEncoding] = useState<'utf-8' | 'shift_jis'>('utf-8');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pdfRootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoginUrl(window.location.origin);
  }, []);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setStatus('idle');
    setMsg('ファイルを読み込み中...');

    try {
      const text = new TextDecoder(encoding).decode(await file.arrayBuffer());
      await processCSV(text);
    } catch (err: any) {
      console.error(err);
      setStatus('error');
      setMsg(`エラー: ${err.message}`);
      setLoading(false);
    }
  };

  const processCSV = async (csvText: string) => {
    const { headers, rows: dataLines } = parseAccountCsv(csvText);

    setMsg(`${dataLines.length}件のデータを処理中...`);

    const preparedAccounts: any[] = [];
    const errors: string[] = [];
    const seenIds = new Set<string>();
    const token = await auth.currentUser?.getIdToken();
    if (!token) throw new Error('ログイン情報を確認できません。再ログインしてください。');

    for (let rowIndex = 0; rowIndex < dataLines.length; rowIndex += 1) {
      const cols = dataLines[rowIndex];
      
      let userData: any = null;
      let lifetimeId = '';

      if (role === 'teacher') {
        // 講師CSV形式: 校舎番号, 職員番号, 所属校, 契約書種別, 氏名
        // インデックス: 0:校舎番号, 1:職員番号, 2:所属校, 3:契約書種別, 4:氏名
        
        // ヘッダーチェック（簡易）
        const staffIdIndex = headers.indexOf('職員番号');
        const nameIndex = headers.indexOf('氏名');
        const passIndex = headers.findIndex(h => h.includes('パスワード'));
        
        // ヘッダーが見つからない場合は固定インデックスで試行
        const staffId = staffIdIndex > -1 ? cols[staffIdIndex] : cols[1];
        const name = nameIndex > -1 ? cols[nameIndex] : cols[4];
        const schoolId = headers.indexOf('校舎番号') > -1 ? cols[headers.indexOf('校舎番号')] : cols[0];
        const schoolName = headers.indexOf('所属校') > -1 ? cols[headers.indexOf('所属校')] : cols[2];
        const contractType = headers.indexOf('契約書種別') > -1 ? cols[headers.indexOf('契約書種別')] : cols[3];
        const pass = passIndex > -1 ? cols[passIndex] : '';

        if (!staffId || !name) { errors.push(`${rowIndex + 2}行目: 職員番号と氏名は必須です。`); continue; }

        const canonicalSchoolId = resolveAttendanceSchoolCode(schoolId || schoolName);
        if (!canonicalSchoolId) { errors.push(`${rowIndex + 2}行目 ${name}: 校舎番号が一覧にありません。`); continue; }

        lifetimeId = staffId;
        userData = {
          role: 'teacher',
          name: name,
          lifetime_id: staffId, // 職員番号をIDとして使用
          school_id: canonicalSchoolId,
          school_name: attendanceSchoolName(canonicalSchoolId),
          contract_type: contractType,
          initial_password: pass || generateInitialPassword(),
          email: `${staffId}@sozogakuen.co.jp`, // ダミーメール（Auth用）
          updated_at: new Date().toISOString()
        };

      } else {
        const nameIndex = headers.findIndex(h => h.includes('氏名') || h.includes('名前') || h.includes('生徒名'));
        const idIndex = headers.findIndex(h => h.includes('ID') || h.includes('生涯番号') || h.includes('ログインID'));
        const passIndex = headers.findIndex(h => h.includes('パスワード'));
        const gradeIndex = headers.findIndex(h => h.includes('学年'));
        const classroomIndex = headers.findIndex(h => h.includes('教室') || h.includes('クラス'));
        const dayIndex = headers.findIndex(h => h.includes('曜日'));
        const scienceIndex = headers.findIndex(h => h.includes('理科'));
        const socialIndex = headers.findIndex(h => h.includes('社会'));

        const name = nameIndex > -1 ? cols[nameIndex] : cols[0];
        const id = idIndex > -1 ? cols[idIndex] : cols[1];
        const pass = passIndex > -1 ? cols[passIndex] : cols[2];
        
        if (!name || !id) { errors.push(`${rowIndex + 2}行目: IDと氏名は必須です。`); continue; }

        const schoolIndex = headers.findIndex(h => h.includes('校舎番号') || h.includes('教室番号'));
        const schoolId = resolveAttendanceSchoolCode(schoolIndex > -1 ? cols[schoolIndex] : '');
        if (!schoolId) { errors.push(`${rowIndex + 2}行目 ${name}: 校舎番号が一覧にありません。`); continue; }

        lifetimeId = id;
        userData = {
          role: 'student',
          student_name: name,
          name: name,
          lifetime_id: id,
          initial_password: pass || generateInitialPassword(),
          school_id: schoolId,
          school_name: attendanceSchoolName(schoolId),
          updated_at: new Date().toISOString()
        };

        if (gradeIndex > -1 && cols[gradeIndex]) userData.grade = cols[gradeIndex];
        if (classroomIndex > -1 && cols[classroomIndex]) userData.classroom = cols[classroomIndex];
        if (dayIndex > -1 && cols[dayIndex]) userData.day_of_week = cols[dayIndex];
        if (scienceIndex > -1 && cols[scienceIndex]) userData.subject_science = cols[scienceIndex];
        if (socialIndex > -1 && cols[socialIndex]) userData.subject_social = cols[socialIndex];
      }

      if (userData && lifetimeId) {
        if (seenIds.has(lifetimeId)) { errors.push(`${rowIndex + 2}行目 ${lifetimeId}: CSV内でIDが重複しています。`); continue; }
        seenIds.add(lifetimeId);
        const response = await fetch('/api/admin/accounts/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            role,
            display_name: userData.student_name || userData.name,
            login_id: lifetimeId,
            password: userData.initial_password,
            school_id: userData.school_id,
            grade: userData.grade || '',
            classroom: userData.classroom || '',
            subject_science: userData.subject_science || '',
            subject_social: userData.subject_social || '',
            day_of_week: userData.day_of_week || '',
            employment_category: role === 'teacher' ? 'semi_dedicated' : undefined,
            auto_create_parent: false,
          }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) {
          errors.push(`${rowIndex + 2}行目 ${lifetimeId}: ${result.error || '登録できませんでした。'}`);
          continue;
        }
        preparedAccounts.push({ ...userData, id: result.uid, uid: result.uid, email: result.email, initial_password: result.initial_password });
      }
    }

    if (preparedAccounts.length === 0) throw new Error(errors.slice(0, 5).join(' / ') || '登録できるデータがありません。');

    setStatus('success');
    setMsg(`${preparedAccounts.length}件成功${errors.length ? `、${errors.length}件失敗: ${errors.slice(0, 3).join(' / ')}` : ''}`);
    setImportedAccounts(preparedAccounts);
    setLoading(false);
    if (onSuccess) onSuccess();
    
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDownloadIndividualPdfs = async () => {
    if (isPdfExporting || importedAccounts.length === 0 || !pdfRootRef.current) return;
    setIsPdfExporting(true);
    setPdfProgress({ current: 0, total: importedAccounts.length });
    try {
      if (document.fonts?.ready) await document.fonts.ready;
      const pages = Array.from(pdfRootRef.current.querySelectorAll<HTMLElement>('.account-guide-print-page'));
      if (pages.length !== importedAccounts.length) throw new Error('PDF対象の表示数が一致しません');
      const [{ default: html2canvas }, { jsPDF }, { default: JSZip }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
        import('jszip'),
      ]);
      const zip = new JSZip();
      const usedNames = new Set<string>();

      for (let index = 0; index < pages.length; index++) {
        setPdfProgress({ current: index + 1, total: pages.length });
        const account = importedAccounts[index];
        const canvas = await html2canvas(pages[index], {
          scale: 2,
          useCORS: true,
          backgroundColor: '#ffffff',
          logging: false,
        });
        const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, 210, 297, undefined, 'FAST');

        const rawName = account.student_name || account.name || account.lifetime_id;
        const fileName = uniqueImportFileName(rawName, index, usedNames);
        zip.file(fileName, pdf.output('arraybuffer'));
      }

      const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
      const url = URL.createObjectURL(zipBlob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${role === 'student' ? '生徒' : '講師'}アカウント_個別PDF.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error: any) {
      setStatus('error');
      setMsg(`PDF作成エラー: ${error?.message || error}`);
    } finally {
      setIsPdfExporting(false);
      setPdfProgress({ current: 0, total: 0 });
    }
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <input
        type="file"
        accept=".csv"
        className="hidden"
        ref={fileInputRef}
        onChange={handleFileUpload}
        disabled={loading}
      />

      {role === 'student' ? (
        <CsvSampleDownload
          filename="生徒アカウント登録CSV例.csv"
          headers={['氏名', 'ID', 'パスワード', '校舎番号', '学年', '教室', '曜日', '理科', '社会']}
          rows={[
            ['山田 太郎', '100001', '', '112', '中1', '本山', '月', '物理', '地理'],
            ['佐藤 花子', '100002', '', '161', '中2', '元町', '水', '化学', '歴史'],
          ]}
        />
      ) : (
        <CsvSampleDownload
          filename="講師アカウント登録CSV例.csv"
          headers={['校舎番号', '職員番号', '所属校', '契約書種別', '氏名']}
          rows={[
            ['178', 'T1001', '元町', '準専任', '鈴木 一郎'],
            ['170', 'T1002', '本山', '準専任', '田中 花子'],
          ]}
        />
      )}

      <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
        文字コード
        <select value={encoding} onChange={event => setEncoding(event.target.value as 'utf-8' | 'shift_jis')} className="rounded border border-slate-200 bg-white px-2 py-1">
          <option value="utf-8">UTF-8</option>
          <option value="shift_jis">Shift_JIS</option>
        </select>
      </label>
      
      {status === 'idle' && (
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={loading}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-white transition-all shadow-md active:scale-95 ${
            role === 'teacher' 
              ? 'bg-purple-600 hover:bg-purple-700 shadow-purple-200' 
              : 'bg-green-600 hover:bg-green-700 shadow-green-200'
          }`}
        >
          {loading ? <Loader2 className="animate-spin" size={20} /> : <FileUp size={20} />}
          CSVを選択
        </button>
      )}

      {status === 'success' && (
        <div className="flex items-center gap-2 text-green-600 font-bold bg-green-50 px-4 py-2 rounded-lg border border-green-200 animate-in fade-in slide-in-from-bottom-2">
          <CheckCircle size={20} />
          {msg}
        </div>
      )}

      {importedAccounts.length > 0 && (
        <button
          type="button"
          onClick={handleDownloadIndividualPdfs}
          disabled={isPdfExporting}
          className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 font-bold text-white shadow-md transition hover:bg-emerald-700 disabled:cursor-wait disabled:opacity-60"
        >
          {isPdfExporting ? <Loader2 className="animate-spin" size={18} /> : <Download size={18} />}
          {isPdfExporting
            ? `個別PDF作成中 ${pdfProgress.current}/${pdfProgress.total}`
            : `取込アカウントの個別PDFを保存（${importedAccounts.length}件）`}
        </button>
      )}

      {status === 'error' && (
        <div className="flex items-center gap-2 text-red-600 font-bold bg-red-50 px-4 py-2 rounded-lg border border-red-200 animate-in fade-in slide-in-from-bottom-2">
          <AlertCircle size={20} />
          {msg}
        </div>
      )}
      
      {loading && status !== 'error' && status !== 'success' && (
        <div className="mt-2 text-xs text-gray-500 font-bold animate-pulse">
          {msg}
        </div>
      )}


      <div ref={pdfRootRef} className="fixed left-[-10000px] top-0 w-[210mm] bg-white" aria-hidden="true">
        {importedAccounts.map(account => (
          <AccountGuideSheet
            key={account.id}
            account={account}
            school={account.school_name || account.school_id || account.classroom || ''}
            loginUrl={loginUrl}
            showParentCredentials={false}
          />
        ))}
      </div>
    </div>
  );
}
