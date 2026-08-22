'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { auth, db } from '@/lib/firebase';
import { collection, getDocs, doc, deleteDoc, query, orderBy, writeBatch } from 'firebase/firestore';
import { Users, Search, Plus, Edit, Trash2, ArrowLeft, GraduationCap, UserCheck, Save, X, Loader2, FileUp, Shield, Printer } from 'lucide-react';
import Link from 'next/link';
import CsvSampleDownload from '@/app/components/CsvSampleDownload';
import LastLoginCell from '@/app/components/LastLoginCell';
import AccountGuideSheet, { ACCOUNT_GUIDE_PRINT_CSS } from '@/app/components/AccountGuideSheet';
import { EMPLOYMENT_CATEGORY_LABELS, normalizeEmploymentCategory } from '@/lib/employment-category';

// ユーザー型定義
interface UserData {
  id: string; // Firestore Doc ID
  uid?: string;
  role: 'student' | 'teacher' | 'master' | 'attendance_admin';
  student_name?: string; 
  name?: string;         
  lifetime_id: string;   // ログインID
  email?: string;        // 既存データ対応（メールアドレス）
  grade?: string;
  classroom?: string;
  subject_science?: string;
  subject_social?: string;
  day_of_week?: string;
  initial_password?: string;
  isFirstLogin?: boolean;
  last_login?: unknown;
  last_login_at?: unknown;
  created_at?: string;
  parent_uid?: string;
  parent_name?: string;
  parent_login_id?: string;
  parent_initial_password?: string;
  parent_email?: string;
  student_ids?: string[];
  school_id?: string;
  school?: string;
  middle_school?: string;
  course_start_month?: string;
  employment_category?: 'dedicated' | 'semi_dedicated';
  enabled_programs?: string[];
  prescribed_work_start?: string;
  prescribed_work_end?: string;
  prescribed_break_minutes?: number;
  prescribed_work_days?: number[];
}

const normalizedUserRole = (role: unknown) => ['attendance_admin', 'attendance_only', 'attendance_manager'].includes(String(role || '').toLowerCase()) ? 'teacher' : String(role || 'student');

export default function UserManagementPage() {
  const [users, setUsers] = useState<UserData[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<UserData[]>([]);
  const [loading, setLoading] = useState(true);
  const [isMounted, setIsMounted] = useState(false);
  
  const [activeTab, setActiveTab] = useState<'student' | 'teacher' | 'master'>('student');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isPasswordSyncing, setIsPasswordSyncing] = useState(false);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserData | null>(null);
  
  // ★書面印刷用のState
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const [printAccounts, setPrintAccounts] = useState<UserData[]>([]);
  const [qrBaseUrl, setQrBaseUrl] = useState('');

  const [formData, setFormData] = useState<Partial<UserData> & { displayName: string }>({
    role: 'student',
    displayName: '',
    lifetime_id: '',
    initial_password: '',
    grade: '',
    classroom: '',
    subject_science: '',
    subject_social: '',
    day_of_week: '',
    employment_category: 'semi_dedicated',
    enabled_programs: [],
    prescribed_work_start: '09:00',
    prescribed_work_end: '18:00',
    prescribed_break_minutes: 60,
    prescribed_work_days: [1, 2, 3, 4, 5],
  });

  const csvSample = activeTab === 'student'
    ? {
        filename: 'ユーザー管理_生徒登録CSV例.csv',
        headers: ['氏名', 'ID', 'パスワード', '理科', '社会'],
        rows: [
          ['山田 太郎', '100001', '', '物理', '地理'],
          ['佐藤 花子', '100002', '', '化学', '歴史'],
        ],
      }
    : activeTab === 'teacher'
      ? {
          filename: 'ユーザー管理_講師登録CSV例.csv',
          headers: ['氏名', 'ID', 'パスワード', '専任区分', '理社講座'],
          rows: [
            ['鈴木 一郎', 'T1001', '', '準専任', 'あり'],
            ['田中 花子', 'T1002', '', '専任', 'なし'],
          ],
        }
      : {
          filename: 'ユーザー管理_管理者登録CSV例.csv',
          headers: ['氏名', 'ID', 'パスワード'],
          rows: [
            ['管理 太郎', 'M1001', ''],
          ],
        };

  // URLの取得 (QRコード用) と マウント確認
  useEffect(() => {
    setIsMounted(true);
    if (typeof window !== 'undefined') {
      setQrBaseUrl(window.location.origin);
    }
  }, []);

  // データ取得
  const fetchUsers = async () => {
    setLoading(true);
    try {
      const q = query(collection(db, 'users'), orderBy('created_at', 'desc'));
      const snap = await getDocs(q);
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as UserData));
      setUsers(list);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  useEffect(() => { fetchUsers(); }, []);

  // フィルタリング
  useEffect(() => {
    let result = users.filter(u => normalizedUserRole(u.role) === activeTab);
    if (searchQuery) {
      const lower = searchQuery.toLowerCase();
      result = result.filter(u => 
        (u.student_name || u.name || '').toLowerCase().includes(lower) ||
        String(u.lifetime_id || u.email || '').toLowerCase().includes(lower) ||
        (u.grade || '').includes(lower) ||
        (u.classroom || '').includes(lower) ||
        (u.subject_science || '').includes(lower) ||
        (u.subject_social || '').includes(lower)
      );
    }
    setFilteredUsers(result);
    const visibleIds = new Set(result.map(user => user.id));
    setSelectedIds(current => new Set(Array.from(current).filter(id => visibleIds.has(id))));
  }, [users, activeTab, searchQuery]);

  // ▼▼▼ 重複削除機能 ▼▼▼
  const handleDeduplicate = async () => {
    if (!confirm('氏名とIDが同一の重複データを検索し、最新の1件を残して削除しますか？')) return;
    
    setLoading(true);
    try {
      const uniqueMap = new Map<string, UserData>();
      const duplicates: string[] = [];

      users.forEach(u => {
        const key = u.lifetime_id || u.email;
        if (!key) return;
        if (uniqueMap.has(key)) {
          duplicates.push(u.id);
        } else {
          uniqueMap.set(key, u);
        }
      });

      if (duplicates.length === 0) {
        alert('重複データは見つかりませんでした。');
      } else {
        const batch = writeBatch(db);
        duplicates.forEach(id => batch.delete(doc(db, 'users', id)));
        await batch.commit();
        alert(`${duplicates.length} 件の重複データを削除しました。`);
        fetchUsers();
      }
    } catch (e: any) {
      alert('エラー: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  const syncPrintedPasswords = async (ids: string[]) => {
    const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
    if (uniqueIds.length === 0) return { synced_count: 0, error_count: 0, errors: [] };
    const token = await auth.currentUser?.getIdToken();
    if (!token) throw new Error('ログイン情報を確認できませんでした。再ログインしてください。');

    const res = await fetch('/api/admin/accounts/sync-printed-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ user_ids: uniqueIds }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(data.error || 'パスワード同期に失敗しました');
    }
    return data;
  };

  const handleOpenPrintModal = async () => {
    const requestedIds = Array.from(selectedIds);
    if (requestedIds.length === 0) return alert('印刷するユーザーを選択してください。');
    const selectedUsers = users.filter(user => selectedIds.has(user.id));
    const linkedParentIds = selectedUsers
      .filter(user => user.role === 'student')
      .map(user => user.parent_uid || users.find(candidate => Array.isArray(candidate.student_ids) && candidate.student_ids.includes(user.id))?.id || '')
      .filter(Boolean);
    const syncIds = Array.from(new Set([...requestedIds, ...linkedParentIds]));

    setIsPasswordSyncing(true);
    try {
      const result = await syncPrintedPasswords(syncIds);
      if (result.error_count > 0) {
        const details = (result.errors || [])
          .slice(0, 5)
          .map((item: any) => `${item.login_id || item.user_id}: ${item.error}`)
          .join('\n');
        throw new Error(`書面とログインのパスワードを同期できないアカウントがあります。\n${details}`);
      }
      const resultByOldId = new Map((result.results || []).map((item: any) => [String(item.old_user_id || ''), item]));
      const resultByNewId = new Map((result.results || []).map((item: any) => [String(item.user_id || ''), item]));
      const migratedId = new Map<string, string>((result.results || []).map((item: any) => [
        String(item.old_user_id || ''),
        String(item.user_id || ''),
      ] as [string, string]));
      const updatedUsers = users.map(user => {
        const synced: any = resultByOldId.get(user.id) || resultByNewId.get(user.id);
        const updated = synced ? {
          ...user,
          id: synced.user_id,
          uid: synced.user_id,
          email: synced.email,
          initial_password: synced.initial_password,
          isFirstLogin: true,
        } : { ...user };
        if (updated.parent_uid && migratedId.has(updated.parent_uid)) {
          updated.parent_uid = migratedId.get(updated.parent_uid) || updated.parent_uid;
        }
        if (Array.isArray(updated.student_ids)) {
          updated.student_ids = updated.student_ids.map(id => migratedId.get(id) || id);
        }
        return updated;
      });
      const syncedSelectedIds = requestedIds.map(id => {
        const synced: any = resultByOldId.get(id) || resultByNewId.get(id);
        return String(synced?.user_id || id);
      });
      const syncedSelectedSet = new Set(syncedSelectedIds);
      const preparedPrintAccounts = updatedUsers
        .filter(user => syncedSelectedSet.has(user.id))
        .map(user => {
          const linkedParent = updatedUsers.find(candidate => (
            candidate.id === user.parent_uid ||
            (Array.isArray(candidate.student_ids) && candidate.student_ids.includes(user.id))
          ));
          return {
            ...user,
            parent_name: linkedParent?.name || linkedParent?.parent_name || user.parent_name || '',
            parent_login_id: linkedParent?.lifetime_id || linkedParent?.email || user.parent_login_id || '',
            parent_initial_password: linkedParent?.initial_password || user.parent_initial_password || '',
            parent_email: linkedParent?.email || user.parent_email || '',
          };
        });
      if (preparedPrintAccounts.length === 0) {
        throw new Error('印刷対象のアカウント情報を作成できませんでした。');
      }
      setUsers(updatedUsers);
      setSelectedIds(new Set(syncedSelectedIds));
      setPrintAccounts(preparedPrintAccounts);
      setIsPrintModalOpen(true);
    } catch (e: any) {
      alert(`印刷前のパスワード確認に失敗しました。\n${e.message || e}`);
    } finally {
      setIsPasswordSyncing(false);
    }
  };

  // ▼▼▼ CSVインポート機能 ▼▼▼
  const handleCSVImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!confirm(`「${file.name}」を取り込みますか？\n現在のタブ「${activeTab === 'student' ? '生徒' : activeTab === 'teacher' ? '講師' : '管理者'}」として登録されます。\n既存のIDは上書き更新されます。`)) {
      e.target.value = ''; return;
    }

    setIsImporting(true);
    const reader = new FileReader();
    reader.readAsText(file, 'UTF-8');

    reader.onload = async (event) => {
      try {
        const text = event.target?.result as string;
        const rows = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
        const headers = rows[0].split(',').map(h => h.trim());
        
        const idxName = headers.findIndex(h => h.includes('氏名'));
        const idxID = headers.findIndex(h => h.includes('ID'));
        const idxPass = headers.findIndex(h => h.includes('パスワード'));
        const idxScience = headers.findIndex(h => h.includes('理科'));
        const idxSocial = headers.findIndex(h => h.includes('社会'));
        const idxEmployment = headers.findIndex(h => h.includes('専任区分') || h.includes('雇用区分'));
        const idxScienceSocial = headers.findIndex(h => h.includes('理社講座'));

        if (idxName === -1 || idxID === -1) throw new Error('CSVヘッダーに「氏名」「ID」が必要です');

        let count = 0;
        const errors: string[] = [];
        const token = await auth.currentUser?.getIdToken();
        if (!token) throw new Error('ログイン情報を確認できませんでした。再ログインしてください。');

        for (let i = 1; i < rows.length; i++) {
          const cols = rows[i].split(',');
          if (cols.length < 2) continue;

          const name = cols[idxName]?.trim();
          const loginId = cols[idxID]?.trim();
          const pass = idxPass !== -1 ? cols[idxPass]?.trim() : '';
          const valScience = idxScience !== -1 ? cols[idxScience]?.trim() : null;
          const valSocial = idxSocial !== -1 ? cols[idxSocial]?.trim() : null;
          const valEmployment = idxEmployment !== -1 ? cols[idxEmployment]?.trim() : '準専任';
          const valScienceSocial = idxScienceSocial !== -1 ? cols[idxScienceSocial]?.trim() : '';

          if (!name || !loginId) continue;

          const existingUser = users.find(user => user.lifetime_id === loginId || user.email === loginId);
          const response = await fetch('/api/admin/accounts/create', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              user_id: existingUser?.id,
              role: activeTab,
              display_name: name,
              login_id: loginId,
              password: pass,
              subject_science: valScience || '',
              subject_social: valSocial || '',
              employment_category: normalizeEmploymentCategory(valEmployment, activeTab),
              enabled_programs: activeTab === 'teacher' && ['あり', '有', 'yes', 'true', '1', '○'].includes(String(valScienceSocial || '').toLowerCase()) ? ['science_social'] : [],
              auto_create_parent: false,
            }),
          });
          const result = await response.json().catch(() => ({}));
          if (!response.ok || !result.ok) {
            errors.push(`${name}: ${result.error || '登録できませんでした'}`);
            continue;
          }
          count++;
        }

        const errorText = errors.length > 0
          ? `\n失敗: ${errors.length}件\n${errors.slice(0, 5).join('\n')}`
          : '';
        alert(`${count} 件のユーザーをインポート/更新しました${errorText}`);
        fetchUsers();
      } catch (e: any) {
        alert('インポートエラー: ' + e.message);
      } finally {
        setIsImporting(false);
        e.target.value = '';
      }
    };
  };

  // 保存処理
  const handleSave = async () => {
    if (!formData.displayName || !formData.lifetime_id) return alert('名前とログインIDは必須です');
    
    if (!editingUser) {
      const exists = users.some(u => (u.lifetime_id === formData.lifetime_id) || (u.email === formData.lifetime_id));
      if (exists) return alert('このIDは既に使用されています');
    }

    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('ログイン情報を確認できませんでした。再ログインしてください。');
      const response = await fetch('/api/admin/accounts/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          user_id: editingUser?.id,
          role: formData.role,
          display_name: formData.displayName,
          login_id: formData.lifetime_id,
          password: formData.initial_password,
          grade: formData.grade,
          classroom: formData.classroom,
          subject_science: formData.subject_science,
          subject_social: formData.subject_social,
          day_of_week: formData.day_of_week,
          employment_category: formData.employment_category || 'semi_dedicated',
          enabled_programs: formData.enabled_programs || [],
          prescribed_work_start: formData.prescribed_work_start || '09:00',
          prescribed_work_end: formData.prescribed_work_end || '18:00',
          prescribed_break_minutes: Number(formData.prescribed_break_minutes ?? 60),
          prescribed_work_days: formData.prescribed_work_days || [1, 2, 3, 4, 5],
          auto_create_parent: false,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error || '登録できませんでした');
      alert(editingUser ? '更新しました' : '登録しました');
      setIsModalOpen(false);
      fetchUsers();
    } catch (e: any) { alert('保存エラー: ' + e.message); }
  };

  // ハンドラ
  const handleOpenModal = (user?: UserData) => {
    if (user) {
      setEditingUser(user);
      setFormData({ 
        ...user, 
        displayName: user.student_name || user.name || '',
        lifetime_id: user.lifetime_id || user.email || '', 
        subject_science: user.subject_science || '',
        subject_social: user.subject_social || '',
        employment_category: normalizeEmploymentCategory(user.employment_category, user.role) || 'semi_dedicated',
        enabled_programs: Array.isArray(user.enabled_programs) ? user.enabled_programs.filter(value => value === 'science_social') : [],
        prescribed_work_start: user.prescribed_work_start || '09:00',
        prescribed_work_end: user.prescribed_work_end || '18:00',
        prescribed_break_minutes: Number(user.prescribed_break_minutes ?? 60),
        prescribed_work_days: Array.isArray(user.prescribed_work_days) ? user.prescribed_work_days : [1, 2, 3, 4, 5],
      });
    } else {
      setEditingUser(null);
      setFormData({
        role: activeTab,
        displayName: '',
        lifetime_id: '',
        initial_password: '',
        grade: activeTab === 'student' ? '中1' : '',
        classroom: '',
        subject_science: '',
        subject_social: '',
        day_of_week: '',
        employment_category: 'semi_dedicated',
        enabled_programs: [],
        prescribed_work_start: '09:00',
        prescribed_work_end: '18:00',
        prescribed_break_minutes: 60,
        prescribed_work_days: [1, 2, 3, 4, 5],
      });
    }
    setIsModalOpen(true);
  };
  const handleSelectAll = (c: boolean) => setSelectedIds(c ? new Set(filteredUsers.map(u => u.id)) : new Set());
  const handleSelectOne = (id: string, c: boolean) => { const n = new Set(selectedIds); c ? n.add(id) : n.delete(id); setSelectedIds(n); };
  
  const handleBulkDelete = async () => {
    if (!confirm(`${selectedIds.size}件削除しますか？`)) return;
    setIsBulkDeleting(true);
    const batch = writeBatch(db);
    selectedIds.forEach(id => batch.delete(doc(db, 'users', id)));
    await batch.commit();
    setUsers(prev => prev.filter(u => !selectedIds.has(u.id)));
    setSelectedIds(new Set());
    setIsBulkDeleting(false);
  };
  const handleDelete = async (id: string) => { if(confirm('削除しますか？')) { await deleteDoc(doc(db, 'users', id)); setUsers(prev => prev.filter(u => u.id !== id)); }};

  // =========================================================================
  // ★ 印刷用のコンポーネント (React Portalでbody直下にレンダリングさせます)
  // =========================================================================
  const PrintModal = () => {
    if (!isMounted || typeof document === 'undefined') return null;

    return createPortal(
      <div id="print-root" className="fixed inset-0 z-[9999] bg-gray-200 overflow-y-auto print:static print:bg-white print:overflow-visible">
        
        {/* === 印刷の時だけ適用される最強のCSS === */}
        <style dangerouslySetInnerHTML={{__html: `
          @media print {
            @page { size: A4 portrait; margin: 0; }
            body > *:not(#print-root) { display: none !important; }
            #print-root {
              position: static !important;
              display: block !important;
              width: 100% !important;
              height: auto !important;
              overflow: visible !important;
              background-color: white !important;
            }
            .print-hide { display: none !important; }
            .print-page {
              display: block !important;
              position: relative !important;
              page-break-after: always !important;
              break-after: page !important;
              page-break-inside: avoid !important;
              width: 210mm !important;
              height: 297mm !important;
              padding: 12mm 18mm !important; 
              margin: 0 !important;
              box-sizing: border-box !important;
              box-shadow: none !important;
              border: none !important;
              background-color: white !important;
            }
            .print-page:last-child {
              page-break-after: auto !important;
              break-after: auto !important;
            }
            .print-footer {
              position: absolute !important;
              bottom: 12mm !important;
              left: 18mm !important;
              right: 18mm !important;
            }
            * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          }
          ${ACCOUNT_GUIDE_PRINT_CSS}
        `}} />

        {/* コントロールバー (印刷時は非表示) */}
        <div className="print-hide sticky top-0 z-50 bg-white border-b border-gray-300 p-4 shadow-sm flex justify-between items-center">
          <h2 className="font-bold text-gray-800 text-lg flex items-center gap-2">
            <Printer size={20} className="text-indigo-600"/> 印刷プレビュー ({printAccounts.length}名分)
          </h2>
          <div className="flex gap-3">
            <button onClick={() => window.print()} className="bg-indigo-600 text-white px-6 py-2 rounded-xl font-bold hover:bg-indigo-700 flex items-center gap-2 shadow-sm transition-transform active:scale-95">
              <Printer size={18}/> 印刷する
            </button>
            <button onClick={() => { setIsPrintModalOpen(false); setPrintAccounts([]); }} className="bg-white text-gray-600 border border-gray-300 px-5 py-2 rounded-xl font-bold hover:bg-gray-50 flex items-center gap-2 transition-colors">
              <X size={18}/> 閉じる
            </button>
          </div>
        </div>
        
        {/* 用紙のコンテナ */}
        <div className="py-8 flex flex-col items-center gap-8 print:block print:p-0 print:gap-0 font-sans">
          {printAccounts.map((user) => {
            return (
              <AccountGuideSheet
                key={user.id}
                account={user}
                school={user.school_id || user.school || user.classroom || ''}
                loginUrl={qrBaseUrl || 'https://classbase-app.vercel.app'}
              />
            );
          })}
        </div>
      </div>,
      document.body // ★ Portalを使ってbodyの直下にレンダリング
    );
  };

  return (
    <>
      {/* 印刷モーダル (Portal) の呼び出し */}
      {isPrintModalOpen && <PrintModal />}

      {/* --- メイン画面 (プレビュー時・印刷時は画面上から消す) --- */}
      <div className={`min-h-screen bg-gray-50 p-6 pb-20 ${isPrintModalOpen ? 'hidden' : 'block'}`}>
        <div className="max-w-6xl mx-auto">
          
          {/* ヘッダー */}
          <div className="flex flex-col md:flex-row items-center justify-between mb-8 gap-4">
            <div className="flex items-center gap-4 w-full md:w-auto">
              <Link href="/master" className="bg-white p-2 rounded-full shadow hover:bg-gray-100 text-gray-600 transition-colors">
                <ArrowLeft size={20} />
              </Link>
              <div>
                <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
                  <Users className="text-blue-600" /> ID書面・印刷
                </h1>
                <p className="text-xs text-gray-500">初期ID・初期パスワード・初回ログイン状態の確認と案内書面の印刷</p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 w-full md:w-auto items-center">
               <div className="relative flex-1 md:w-64">
                 <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16}/>
                 <input 
                   type="text" 
                   placeholder="名前・ID・科目で検索" 
                   className="w-full pl-9 pr-4 py-2 border rounded-full focus:ring-2 focus:ring-blue-500 outline-none"
                   value={searchQuery}
                   onChange={e => setSearchQuery(e.target.value)}
                 />
               </div>
            </div>
          </div>

          {/* タブ切り替えと操作ボタン */}
          <div className="flex flex-col sm:flex-row justify-between items-end sm:items-center mb-4 gap-4 border-b border-gray-200 pb-2">
            <div className="flex w-full gap-2 overflow-x-auto sm:w-auto">
              <button onClick={() => setActiveTab('student')} className={`flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-6 py-3 text-sm font-bold -mb-2.5 transition-colors ${activeTab === 'student' ? 'border-blue-600 text-blue-600 bg-blue-50/50' : 'border-transparent text-gray-500'}`}>
                <GraduationCap size={18}/> 生徒 ({users.filter(u => u.role === 'student').length})
              </button>
              <button onClick={() => setActiveTab('teacher')} className={`flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-6 py-3 text-sm font-bold -mb-2.5 transition-colors ${activeTab === 'teacher' ? 'border-purple-600 text-purple-600 bg-purple-50/50' : 'border-transparent text-gray-500'}`}>
                <UserCheck size={18}/> 講師 ({users.filter(u => normalizedUserRole(u.role) === 'teacher').length})
              </button>
              <button onClick={() => setActiveTab('master')} className={`flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-6 py-3 text-sm font-bold -mb-2.5 transition-colors ${activeTab === 'master' ? 'border-gray-800 text-gray-800 bg-gray-100' : 'border-transparent text-gray-500'}`}>
                <Shield size={18}/> 管理者 ({users.filter(u => u.role === 'master').length})
              </button>
            </div>
            
            <div className="flex gap-2 flex-wrap justify-end">
              <span className="self-center text-xs font-bold text-slate-400">左端のチェックで印刷対象を選択</span>
              <button
                onClick={handleOpenPrintModal}
                disabled={isPasswordSyncing || selectedIds.size === 0}
                className="flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-bold text-indigo-600 transition-colors hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {isPasswordSyncing ? <Loader2 size={16} className="animate-spin" /> : <Printer size={16}/>} {' '}
                {isPasswordSyncing ? 'パスワード確認中' : `ID書面を印刷（${selectedIds.size}件）`}
              </button>
            </div>
          </div>

          {/* リスト表示 */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            {loading ? (
              <div className="p-20 flex justify-center"><Loader2 className="animate-spin text-gray-400"/></div>
            ) : filteredUsers.length === 0 ? (
              <div className="p-10 text-center text-gray-400">データが見つかりません</div>
            ) : (
              <div className="overflow-x-auto [scrollbar-gutter:stable]">
                <table className="w-full min-w-[1180px] whitespace-nowrap text-left text-sm">
                  <thead className="bg-gray-50 text-gray-600 font-bold border-b border-gray-200">
                    <tr>
                      <th className="p-4 w-10"><input type="checkbox" className="w-4 h-4" onChange={(e) => handleSelectAll(e.target.checked)} checked={filteredUsers.length > 0 && selectedIds.size === filteredUsers.length}/></th>
                      <th className="p-4 w-40">氏名</th>
                      <th className="p-4 w-64">ログインID</th>
                      <th className="p-4">パスワード</th>
                      <th className="p-4">初回ログイン</th>
                      <th className="p-4">最終ログイン</th>
                      {activeTab === 'teacher' && <><th className="p-4">専任区分</th><th className="p-4">表示機能</th></>}
                      
                      {activeTab === 'student' && (
                        <>
                          <th className="p-4">学年</th>
                          <th className="p-4">教室</th>
                          <th className="p-4">理科</th>
                          <th className="p-4">社会</th>
                        </>
                      )}
                      
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredUsers.map((user) => (
                      <tr key={user.id} className={`hover:bg-gray-50 transition-colors ${selectedIds.has(user.id) ? 'bg-blue-50/30' : ''}`}>
                        <td className="p-4"><input type="checkbox" className="w-4 h-4 cursor-pointer" checked={selectedIds.has(user.id)} onChange={(e) => handleSelectOne(user.id, e.target.checked)}/></td>
                        
                        <td className="p-4 font-bold text-gray-800">
                          <div className="flex items-center gap-2">
                            <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${
                              user.role === 'student' ? 'bg-blue-400' :
                              normalizedUserRole(user.role) === 'teacher' ? 'bg-purple-400' : 'bg-gray-700'
                            }`}>
                              {(user.student_name || user.name || '?')[0]}
                            </div>
                            <span className="max-w-[180px] truncate" title={user.student_name || user.name || '未設定'}>
                              {user.student_name || user.name || <span className="text-gray-400">未設定</span>}
                            </span>
                          </div>
                        </td>

                        <td className="p-4 font-mono font-medium text-gray-700">
                          <span className="block max-w-[260px] truncate" title={user.lifetime_id || user.email || ''}>
                            {user.lifetime_id || user.email || <span className="text-gray-300">-</span>}
                          </span>
                        </td>

                        <td className="p-4 text-gray-400 text-xs font-mono">{user.initial_password || '********'}</td>
                        <td className="p-4">
                          <FirstLoginBadge value={user.isFirstLogin} />
                        </td>
                        <td className="p-4">
                          <LastLoginCell value={user.last_login_at || user.last_login} />
                        </td>
                        {activeTab === 'teacher' && (() => {
                          const category = normalizeEmploymentCategory(user.employment_category, user.role) || 'semi_dedicated';
                          return <><td className="p-4"><span className={`rounded-full px-3 py-1 text-xs font-black ${category === 'dedicated' ? 'bg-indigo-100 text-indigo-700' : 'bg-amber-100 text-amber-800'}`}>{EMPLOYMENT_CATEGORY_LABELS[category]}</span></td><td className="p-4 text-xs font-black text-slate-600">{Array.isArray(user.enabled_programs) && user.enabled_programs.includes('science_social') ? '理社講座＋勤怠' : '勤怠のみ'}</td></>;
                        })()}
                        
                        {activeTab === 'student' && (
                          <>
                            <td className="p-4"><span className="px-2 py-1 rounded bg-gray-100 text-xs font-bold text-gray-600">{user.grade || '-'}</span></td>
                            <td className="p-4 text-gray-600">{user.classroom || '-'}</td>
                            <td className="p-4 text-gray-600 font-bold">{user.subject_science || '-'}</td>
                            <td className="p-4 text-gray-600 font-bold">{user.subject_social || '-'}</td>
                          </>
                        )}
                        
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 編集モーダル */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl overflow-hidden">
            <div className="bg-gray-800 text-white p-4 flex justify-between items-center">
              <h2 className="font-bold flex items-center gap-2">{editingUser ? '編集' : '新規登録'}</h2>
              <button onClick={() => setIsModalOpen(false)}><X size={20}/></button>
            </div>
            <div className="p-6 space-y-4">
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-bold text-gray-500">権限</label>
                  <select 
                    className="w-full p-2 border rounded mt-1 bg-gray-50" 
                    value={formData.role} 
                    onChange={e => setFormData({...formData, role: e.target.value as any})} 
                    disabled={!!editingUser}
                  >
                    <option value="student">生徒</option>
                    <option value="teacher">講師</option>
                    <option value="master">管理者</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-500">ID (ログイン用)</label>
                  <input className="w-full p-2 border rounded mt-1 font-mono" value={formData.lifetime_id} onChange={e => setFormData({...formData, lifetime_id: e.target.value})}/>
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-gray-500">氏名</label>
                <input className="w-full p-2 border rounded mt-1" value={formData.displayName} onChange={e => setFormData({...formData, displayName: e.target.value})}/>
              </div>
              
              <div>
                <label className="text-xs font-bold text-gray-500">パスワード</label>
                <input className="w-full p-2 border rounded mt-1 font-mono bg-gray-50" value={formData.initial_password} onChange={e => setFormData({...formData, initial_password: e.target.value})} placeholder="空欄ならランダム発行"/>
              </div>

              {formData.role === 'teacher' && (
                <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-4">
                  <label className="text-xs font-bold text-indigo-700">専任区分</label>
                  <select className="mt-1 w-full rounded-lg border border-indigo-200 bg-white p-2 font-bold" value={formData.employment_category || 'semi_dedicated'} onChange={e => setFormData({ ...formData, employment_category: e.target.value as 'dedicated' | 'semi_dedicated' })}>
                    <option value="dedicated">専任</option>
                    <option value="semi_dedicated">準専任</option>
                  </select>
                  <label className="mt-3 flex cursor-pointer items-center gap-3 rounded-lg bg-white p-3 text-sm font-bold text-slate-700"><input type="checkbox" checked={formData.enabled_programs?.includes('science_social') || false} onChange={event => setFormData({ ...formData, enabled_programs: event.target.checked ? ['science_social'] : [] })} className="h-5 w-5 accent-indigo-600" /><span>理社講座を表示する<span className="block text-[10px] text-slate-400">OFFの場合は勤怠だけ表示</span></span></label>
                  {formData.employment_category === 'dedicated' && <div className="mt-3 rounded-lg bg-white p-3"><div className="grid grid-cols-3 gap-2"><label className="text-[10px] font-black text-slate-500">規定開始<input type="time" value={formData.prescribed_work_start || '09:00'} onChange={event => setFormData({ ...formData, prescribed_work_start: event.target.value })} className="mt-1 w-full rounded border p-2 text-xs" /></label><label className="text-[10px] font-black text-slate-500">規定終了<input type="time" value={formData.prescribed_work_end || '18:00'} onChange={event => setFormData({ ...formData, prescribed_work_end: event.target.value })} className="mt-1 w-full rounded border p-2 text-xs" /></label><label className="text-[10px] font-black text-slate-500">休憩（分）<input type="number" min="0" max="240" step="5" value={formData.prescribed_break_minutes ?? 60} onChange={event => setFormData({ ...formData, prescribed_break_minutes: Number(event.target.value) })} className="mt-1 w-full rounded border p-2 text-xs" /></label></div><div className="mt-2 flex flex-wrap gap-1">{['日', '月', '火', '水', '木', '金', '土'].map((label, day) => <label key={day} className={`cursor-pointer rounded border px-2 py-1 text-[10px] font-black ${(formData.prescribed_work_days || []).includes(day) ? 'bg-indigo-600 text-white' : 'text-slate-500'}`}><input type="checkbox" className="sr-only" checked={(formData.prescribed_work_days || []).includes(day)} onChange={event => setFormData({ ...formData, prescribed_work_days: event.target.checked ? [...(formData.prescribed_work_days || []), day].sort() : (formData.prescribed_work_days || []).filter(value => value !== day) })} />{label}</label>)}</div></div>}
                </div>
              )}
              
              {formData.role === 'student' && (
                <div className="p-4 bg-blue-50/50 rounded-xl space-y-4 border border-blue-100">
                  <div className="grid grid-cols-2 gap-4">
                     <div>
                       <label className="text-xs font-bold text-gray-500">学年</label>
                       <select className="w-full p-2 border rounded mt-1" value={formData.grade} onChange={e => setFormData({...formData, grade: e.target.value})}>
                         <option value="">選択</option><option>中1</option><option>中2</option><option>中3</option>
                       </select>
                     </div>
                     <div>
                       <label className="text-xs font-bold text-gray-500">教室</label>
                       <input className="w-full p-2 border rounded mt-1" value={formData.classroom} onChange={e => setFormData({...formData, classroom: e.target.value})}/>
                     </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-bold text-gray-500">理科科目</label>
                      <input 
                        className="w-full p-2 border rounded mt-1" 
                        value={formData.subject_science} 
                        onChange={e => setFormData({...formData, subject_science: e.target.value})}
                        placeholder="例: 地学"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-gray-500">社会科目</label>
                      <input 
                        className="w-full p-2 border rounded mt-1" 
                        value={formData.subject_social} 
                        onChange={e => setFormData({...formData, subject_social: e.target.value})}
                        placeholder="例: 歴史A"
                      />
                    </div>
                  </div>
                </div>
              )}
              
              <button onClick={handleSave} className="w-full bg-blue-600 text-white py-3 rounded-lg font-bold hover:bg-blue-700 shadow mt-4 flex justify-center items-center gap-2">
                <Save size={18}/> 保存
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function FirstLoginBadge({ value }: { value: unknown }) {
  const completed = value === false;
  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-[11px] font-black ${completed ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
      {completed ? '初回ログイン済み' : '初回変更待ち'}
    </span>
  );
}
