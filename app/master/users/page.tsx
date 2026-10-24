'use client';

import { useState, useEffect } from 'react';
import { auth, db } from '@/lib/firebase';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { Search, GraduationCap, UserCheck, Save, FileUp, Shield, Printer, History, RefreshCw, Loader2 } from 'lucide-react';
import CsvSampleDownload from '@/app/components/CsvSampleDownload';
import LastLoginCell from '@/app/components/LastLoginCell';
import AccountGuidePrintView from '@/app/components/account-guides/AccountGuidePrintView';
import { toGuideAccount } from '@/app/components/account-guides/guide-model';
import { describeSyncErrors, syncPrintedPasswords, type PrintedPasswordSkip } from '@/lib/client-printed-password-sync';
import { EMPLOYMENT_CATEGORY_LABELS, normalizeEmploymentCategory } from '@/lib/employment-category';
import { ATTENDANCE_SCHOOL_OPTION_GROUPS, attendanceSchoolName, resolveAttendanceSchoolCode } from '@/lib/attendance-schools';
import AdminPageHeader from '@/app/components/master/AdminPageHeader';
import AdminTabs from '@/app/components/master/AdminTabs';
import { Button, EmptyState, ErrorState, ListSkeleton, Modal, buttonClass, useConfirm, useToast } from '@/app/components/ui';
import { formatDate, formatDateTime } from '@/lib/format';
import { userErrorMessage } from '@/lib/user-error';

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
  school_ids?: string[];
  school?: string;
  middle_school?: string;
  course_start_month?: string;
  employment_category?: 'dedicated' | 'semi_dedicated';
  attendance_school_manager?: boolean;
  enabled_programs?: string[];
  prescribed_work_start?: string;
  prescribed_work_end?: string;
  prescribed_break_minutes?: number;
  prescribed_work_days?: number[];
}

interface AccountImportBatch {
  id: string;
  file_name: string;
  role: 'student' | 'teacher' | 'master';
  user_ids: string[];
  success_count: number;
  error_count: number;
  errors: string[];
  imported_at: string;
  imported_by: string;
  source: string;
}

const normalizedUserRole = (role: unknown) => ['attendance_admin', 'attendance_only', 'attendance_manager'].includes(String(role || '').toLowerCase()) ? 'teacher' : String(role || 'student');

export default function UserManagementPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [users, setUsers] = useState<UserData[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<UserData[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  
  const [activeTab, setActiveTab] = useState<'student' | 'teacher' | 'master'>('student');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isImporting, setIsImporting] = useState(false);
  const [isPasswordSyncing, setIsPasswordSyncing] = useState(false);
  const [importBatches, setImportBatches] = useState<AccountImportBatch[]>([]);
  const [selectedImportBatchId, setSelectedImportBatchId] = useState('');
  const [isImportHistoryLoading, setIsImportHistoryLoading] = useState(false);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserData | null>(null);
  
  // ★書面印刷用のState
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const [printAccounts, setPrintAccounts] = useState<UserData[]>([]);
  const [qrBaseUrl, setQrBaseUrl] = useState('');
  const [printSkipped, setPrintSkipped] = useState<PrintedPasswordSkip[]>([]);
  const [printRequestIds, setPrintRequestIds] = useState<string[]>([]);
  const [syncProgress, setSyncProgress] = useState<{ done: number; total: number } | null>(null);

  const [formData, setFormData] = useState<Partial<UserData> & { displayName: string }>({
    role: 'student',
    displayName: '',
    lifetime_id: '',
    initial_password: '',
    school_id: '',
    grade: '',
    classroom: '',
    subject_science: '',
    subject_social: '',
    day_of_week: '',
    employment_category: 'semi_dedicated',
    attendance_school_manager: false,
    enabled_programs: [],
    prescribed_work_start: '09:00',
    prescribed_work_end: '18:00',
    prescribed_break_minutes: 60,
    prescribed_work_days: [1, 2, 3, 4, 5],
  });

  const csvSample = activeTab === 'student'
    ? {
        filename: 'ユーザー管理_生徒登録CSV例.csv',
        headers: ['氏名', 'ID', 'パスワード', '校舎番号', '理科', '社会'],
        rows: [
          ['山田 太郎', '100001', '', '112', '物理', '地理'],
          ['佐藤 花子', '100002', '', '161', '化学', '歴史'],
        ],
      }
    : activeTab === 'teacher'
      ? {
          filename: 'ユーザー管理_講師登録CSV例.csv',
          headers: ['氏名', 'ID', 'パスワード', '校舎番号', '専任区分', '理社講座'],
          rows: [
            ['鈴木 一郎', 'T1001', '', '112', '準専任', 'あり'],
            ['田中 花子', 'T1002', '', '161', '専任', 'なし'],
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
    setLoadError(false);
    try {
      const q = query(collection(db, 'users'), orderBy('created_at', 'desc'));
      const snap = await getDocs(q);
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as UserData));
      setUsers(list);
    } catch (e) { console.error(e); setLoadError(true); } finally { setLoading(false); }
  };

  const fetchImportBatches = async () => {
    setIsImportHistoryLoading(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;
      const response = await fetch('/api/admin/account-import-batches', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error || '取込履歴を取得できませんでした');
      setImportBatches(Array.isArray(result.batches) ? result.batches : []);
    } catch (error) {
      console.error('Account import history fetch failed:', error);
      toast.error('CSV取込履歴を読み込めませんでした。「更新」でもう一度お試しください。');
    } finally {
      setIsImportHistoryLoading(false);
    }
  };

  useEffect(() => {
    void fetchUsers();
    void fetchImportBatches();
    // 初回表示時だけ読み込む（toast は安定した参照）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // フィルタリング
  useEffect(() => {
    let result = users.filter(u => normalizedUserRole(u.role) === activeTab);
    if (selectedImportBatchId) {
      const selectedBatch = importBatches.find(batch => batch.id === selectedImportBatchId);
      if (selectedBatch) {
        const importedIds = new Set(selectedBatch.user_ids);
        result = result.filter(user => importedIds.has(user.id));
      }
    }
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
  }, [users, activeTab, searchQuery, selectedImportBatchId, importBatches]);

  const selectedImportBatch = importBatches.find(batch => batch.id === selectedImportBatchId) || null;

  const handleImportBatchChange = (batchId: string) => {
    setSelectedImportBatchId(batchId);
    const batch = importBatches.find(item => item.id === batchId);
    if (!batch) {
      setSelectedIds(new Set());
      return;
    }
    setActiveTab(batch.role);
    setSelectedIds(new Set(batch.user_ids));
    setSearchQuery('');
  };

  const handleTabChange = (tab: 'student' | 'teacher' | 'master') => {
    setActiveTab(tab);
    setSelectedImportBatchId('');
    setSelectedIds(new Set());
  };

  /**
   * ID書面の印刷準備。書面に載せるパスワードとログイン用パスワードを分割して同期する。
   * mode=issue：初回ログイン済みの人はパスワードを変えずに除外する（大量発行時の誤リセット防止）。
   * mode=reissue：ログイン済みの人にも新しい初期パスワードを発行する。
   */
  const handleOpenPrintModal = async (mode: 'issue' | 'reissue' = 'issue', overrideIds?: string[]) => {
    const requestedIds = overrideIds || Array.from(selectedIds);
    if (requestedIds.length === 0) return toast.error('印刷するユーザーを選択してください。');
    const requestedSet = new Set(requestedIds);
    const parentOf = (user: UserData) => users.find(candidate => candidate.id === user.parent_uid)
      || users.find(candidate => Array.isArray(candidate.student_ids) && candidate.student_ids.includes(user.id));
    const linkedParentIds = users
      .filter(user => requestedSet.has(user.id) && user.role === 'student')
      .map(user => parentOf(user)?.id || user.parent_uid || '')
      .filter(Boolean);
    const syncIds = Array.from(new Set([...requestedIds, ...linkedParentIds]));

    setIsPasswordSyncing(true);
    setSyncProgress({ done: 0, total: syncIds.length });
    try {
      const summary = await syncPrintedPasswords(syncIds, { mode, onProgress: (done, total) => setSyncProgress({ done, total }) });
      if (summary.errors.length > 0) {
        throw new Error(`書面とログインのパスワードを同期できないアカウントがあります。 ${describeSyncErrors(summary.errors).replace(/\n/g, ' ／ ')}`);
      }
      const skippedIds = new Set(summary.skipped.map(item => item.user_id));
      const migratedId = new Map<string, string>(summary.results.map(item => [String(item.old_user_id), String(item.user_id)] as [string, string]));
      const updatedUsers = users.map(user => {
        const synced = summary.resultByUserId.get(user.id);
        const updated: UserData = synced ? {
          ...user, id: synced.user_id, uid: synced.user_id, email: synced.email,
          initial_password: synced.initial_password, isFirstLogin: true,
        } : { ...user };
        if (updated.parent_uid && migratedId.has(updated.parent_uid)) updated.parent_uid = migratedId.get(updated.parent_uid) || updated.parent_uid;
        if (Array.isArray(updated.student_ids)) updated.student_ids = updated.student_ids.map(id => migratedId.get(id) || id);
        return updated;
      });
      const nextSelectedIds = requestedIds.map(id => migratedId.get(id) || id);
      const printableIds = new Set(nextSelectedIds.filter(id => !skippedIds.has(id)));
      const preparedPrintAccounts = updatedUsers
        .filter(user => printableIds.has(user.id))
        .map(user => {
          const linkedParent = updatedUsers.find(candidate => (
            candidate.id === user.parent_uid ||
            (Array.isArray(candidate.student_ids) && candidate.student_ids.includes(user.id))
          ));
          const children = String(user.role) === 'parent' && Array.isArray(user.student_ids)
            ? updatedUsers.filter(candidate => user.student_ids!.includes(candidate.id))
            : [];
          return {
            ...user,
            child_name: children.map(child => child.student_name || child.name).filter(Boolean).join('・'),
            parent_login_id: linkedParent?.lifetime_id || linkedParent?.email || user.parent_login_id || '',
            parent_initial_password: linkedParent?.initial_password || '',
            parent_status: linkedParent && skippedIds.has(linkedParent.id) ? 'activated' : undefined,
          };
        });
      setUsers(updatedUsers);
      setSelectedIds(new Set(nextSelectedIds));
      setPrintRequestIds(nextSelectedIds);
      setPrintSkipped(summary.skipped);
      if (preparedPrintAccounts.length === 0) {
        if (mode !== 'issue') {
          toast.info(`選んだ${summary.skipped.length}名は全員すでにログイン済みのため、書面を作成していません。`);
          return;
        }
        if (await confirm({
          title: `${summary.skipped.length}名のパスワードを再発行しますか？`,
          message: `選んだ${summary.skipped.length}名は全員すでにログイン済みのため、書面を作成していません。再発行して書面を作成すると、本人が設定したパスワードは使えなくなります。`,
          confirmLabel: '再発行する',
          cancelLabel: '再発行しない',
          tone: 'danger',
        })) {
          await handleOpenPrintModal('reissue', nextSelectedIds);
        }
        return;
      }
      setPrintAccounts(preparedPrintAccounts);
      setIsPrintModalOpen(true);
    } catch (e: any) {
      toast.error(`印刷前のパスワード確認に失敗しました。 ${userErrorMessage(e, '')}`);
    } finally {
      setIsPasswordSyncing(false);
      setSyncProgress(null);
    }
  };

  // ▼▼▼ CSVインポート機能 ▼▼▼
  const handleCSVImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const input = e.target;
    if (!(await confirm({
      title: `「${file.name}」を取り込みますか？`,
      message: `「${activeTab === 'student' ? '生徒' : activeTab === 'teacher' ? '講師' : '管理者'}」として登録します。既存のIDは上書き更新されます。`,
      confirmLabel: '取り込む',
      tone: 'danger',
    }))) {
      input.value = ''; return;
    }

    setIsImporting(true);
    const importBatchId = `account_import_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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
        const idxSchool = headers.findIndex(h => h.includes('校舎番号') || h.includes('教室番号'));
        const idxScience = headers.findIndex(h => h.includes('理科'));
        const idxSocial = headers.findIndex(h => h.includes('社会'));
        const idxEmployment = headers.findIndex(h => h.includes('専任区分') || h.includes('雇用区分'));
        const idxScienceSocial = headers.findIndex(h => h.includes('理社講座'));

        if (idxName === -1 || idxID === -1 || (activeTab !== 'master' && idxSchool === -1)) throw new Error('CSVヘッダーに「氏名」「ID」「校舎番号」が必要です');

        let count = 0;
        const errors: string[] = [];
        const importedUserIds: string[] = [];
        const token = await auth.currentUser?.getIdToken();
        if (!token) throw new Error('ログイン情報を確認できませんでした。再ログインしてください。');

        for (let i = 1; i < rows.length; i++) {
          const cols = rows[i].split(',');
          if (cols.length < 2) continue;

          const name = cols[idxName]?.trim();
          const loginId = cols[idxID]?.trim();
          const pass = idxPass !== -1 ? cols[idxPass]?.trim() : '';
          const schoolId = idxSchool !== -1 ? resolveAttendanceSchoolCode(cols[idxSchool]?.trim()) : '';
          const valScience = idxScience !== -1 ? cols[idxScience]?.trim() : null;
          const valSocial = idxSocial !== -1 ? cols[idxSocial]?.trim() : null;
          const valEmployment = idxEmployment !== -1 ? cols[idxEmployment]?.trim() : '準専任';
          const valScienceSocial = idxScienceSocial !== -1 ? cols[idxScienceSocial]?.trim() : '';

          if (!name || !loginId) continue;
          if (activeTab !== 'master' && !schoolId) {
            errors.push(`${name}: 校舎番号が一覧にありません`);
            continue;
          }

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
              school_id: schoolId,
              subject_science: valScience || '',
              subject_social: valSocial || '',
              employment_category: normalizeEmploymentCategory(valEmployment, activeTab),
              enabled_programs: activeTab === 'teacher' && ['あり', '有', 'yes', 'true', '1', '○'].includes(String(valScienceSocial || '').toLowerCase()) ? ['science_social'] : [],
              auto_create_parent: false,
              import_batch_id: importBatchId,
              import_file_name: file.name,
            }),
          });
          const result = await response.json().catch(() => ({}));
          if (!response.ok || !result.ok) {
            errors.push(`${name}: ${result.error || '登録できませんでした'}`);
            continue;
          }
          count++;
          if (result.uid) importedUserIds.push(String(result.uid));
        }

        const historyResponse = await fetch('/api/admin/account-import-batches', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            batch_id: importBatchId,
            file_name: file.name,
            role: activeTab,
            user_ids: importedUserIds,
            success_count: count,
            error_count: errors.length,
            errors,
          }),
        });
        const historyResult = await historyResponse.json().catch(() => ({}));
        if (!historyResponse.ok || !historyResult.ok) {
          throw new Error(`アカウントは登録されましたが、取込履歴を保存できませんでした: ${historyResult.error || '不明なエラー'}`);
        }

        await Promise.all([fetchUsers(), fetchImportBatches()]);
        setSelectedImportBatchId(importBatchId);
        setSelectedIds(new Set(importedUserIds));
        toast.success(`${count} 件のユーザーをインポート/更新しました。取込履歴から対象者を再選択できます。`);
        if (errors.length > 0) {
          toast.error(`失敗: ${errors.length}件 ／ ${errors.slice(0, 5).join(' ／ ')}${errors.length > 5 ? ' ほか' : ''}`);
        }
      } catch (e: any) {
        toast.error('インポートエラー: ' + e.message);
      } finally {
        setIsImporting(false);
        input.value = '';
      }
    };
  };

  // 保存処理
  const handleSave = async () => {
    if (!formData.displayName || !formData.lifetime_id) return toast.error('名前とログインIDは必須です');
    if (formData.role !== 'master' && !resolveAttendanceSchoolCode(formData.school_id)) return toast.error('所属校舎を選択してください');
    
    if (!editingUser) {
      const exists = users.some(u => (u.lifetime_id === formData.lifetime_id) || (u.email === formData.lifetime_id));
      if (exists) return toast.error('このIDは既に使用されています');
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
          school_id: formData.school_id,
          school_ids: formData.school_ids,
          grade: formData.grade,
          classroom: formData.classroom,
          subject_science: formData.subject_science,
          subject_social: formData.subject_social,
          day_of_week: formData.day_of_week,
          employment_category: formData.employment_category || 'semi_dedicated',
          attendance_school_manager: formData.employment_category === 'dedicated' && formData.attendance_school_manager === true,
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
      toast.success(editingUser ? '更新しました' : '登録しました');
      setIsModalOpen(false);
      fetchUsers();
    } catch (e: any) { toast.error('保存エラー: ' + e.message); }
  };

  // ハンドラ
  const handleOpenModal = (user?: UserData) => {
    if (user) {
      setEditingUser(user);
      setFormData({ 
        ...user, 
        displayName: user.student_name || user.name || '',
        lifetime_id: user.lifetime_id || user.email || '', 
        school_id: resolveAttendanceSchoolCode(user.school_id || user.school),
        subject_science: user.subject_science || '',
        subject_social: user.subject_social || '',
        employment_category: normalizeEmploymentCategory(user.employment_category, user.role) || 'semi_dedicated',
        attendance_school_manager: user.attendance_school_manager === true,
        enabled_programs: Array.isArray(user.enabled_programs) ? user.enabled_programs.filter(value => ['science_social', 'online_school'].includes(value)) : [],
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
        school_id: '',
        grade: activeTab === 'student' ? '中1' : '',
        classroom: '',
        subject_science: '',
        subject_social: '',
        day_of_week: '',
        employment_category: 'semi_dedicated',
        attendance_school_manager: false,
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
  
  const skippedStudents = printSkipped.filter(item => item.role === 'student');
  const skippedOthers = printSkipped.filter(item => item.role !== 'student');
  const printNotice = printSkipped.length > 0 ? (
    <div className="flex flex-col gap-2 rounded-btn border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-900 sm:flex-row sm:items-center sm:justify-between">
      <p>
        初回ログイン済みのため、パスワードを変えずに書面から外しました：生徒 {skippedStudents.length}名・保護者など {skippedOthers.length}名
        <span className="ml-1 text-amber-700">（{printSkipped.slice(0, 4).map(item => item.display_name).join('、')}{printSkipped.length > 4 ? ' ほか' : ''}）</span>
      </p>
      <Button
        variant="danger"
        size="sm"
        className="shrink-0"
        onClick={async () => {
          if (!(await confirm({
            title: `ログイン済みの${printSkipped.length}名のパスワードを再発行しますか？`,
            message: `${printSkipped.slice(0, 4).map(item => item.display_name).join('、')}${printSkipped.length > 4 ? ' ほか' : ''} に新しい初期パスワードを発行して書面に含めます。本人が設定したパスワードは使えなくなります。`,
            confirmLabel: '再発行する',
            tone: 'danger',
          }))) return;
          setIsPrintModalOpen(false);
          void handleOpenPrintModal('reissue', printRequestIds);
        }}
      >
        パスワードを再発行して含める
      </Button>
    </div>
  ) : null;

  return (
    <>
      {/* 印刷モーダル (Portal) の呼び出し */}
      {isPrintModalOpen && isMounted && (
        <AccountGuidePrintView
          accounts={printAccounts.map(user => toGuideAccount(user, attendanceSchoolName(user.school_id || user.school || user.classroom)))}
          loginUrl={qrBaseUrl || 'https://classbase-app.vercel.app'}
          title={`ID書面 ${formatDate(new Date(), { withYear: true })}発行`}
          notice={printNotice}
          onClose={() => { setIsPrintModalOpen(false); setPrintAccounts([]); setPrintSkipped([]); }}
        />
      )}

      {/* --- メイン画面 (プレビュー時・印刷時は画面上から消す) --- */}
      <div className={`pb-20 ${isPrintModalOpen ? 'hidden' : 'block'}`}>
        <div>
          <AdminPageHeader
            description="初期ID・初期パスワード・初回ログイン状態の確認と案内書面の印刷"
            actions={<div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} aria-hidden />
              <input
                type="text"
                aria-label="名前・ID・科目で検索"
                placeholder="名前・ID・科目で検索"
                className="min-h-11 w-full rounded-input border border-line bg-white pl-9 pr-4 outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
            </div>}
          />

          <section className="mb-6 grid gap-4 lg:grid-cols-2">
            <div className="rounded-card border border-line bg-surface p-5 shadow-sm">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-btn bg-accent-soft text-accent"><FileUp size={20} aria-hidden /></span>
                <div>
                  <h2 className="font-bold text-slate-900">CSVでアカウントを一括登録</h2>
                  <p className="mt-1 text-xs font-bold leading-5 text-slate-500">現在の「{activeTab === 'student' ? '生徒' : activeTab === 'teacher' ? '講師' : '管理者'}」として取り込み、履歴を自動保存します。</p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <CsvSampleDownload {...csvSample} label="CSV見本" />
                <label className={buttonClass('primary', 'md', `relative cursor-pointer ${isImporting ? 'pointer-events-none opacity-60' : ''}`)}>
                  {isImporting ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <FileUp size={16} aria-hidden />}
                  {isImporting ? '取り込み中' : 'CSVを選んで取り込む'}
                  <input type="file" accept=".csv,text/csv" onChange={handleCSVImport} disabled={isImporting} className="absolute inset-0 cursor-pointer opacity-0" />
                </label>
              </div>
            </div>

            <div className="rounded-card border border-line bg-surface p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-btn bg-accent-soft text-accent"><History size={20} aria-hidden /></span>
                  <div>
                    <h2 className="font-bold text-slate-900">CSV取込履歴から絞り込む</h2>
                    <p className="mt-1 text-xs font-bold leading-5 text-slate-500">履歴を選ぶと、そのCSVの対象者を一括選択します。</p>
                  </div>
                </div>
                <Button variant="secondary" size="sm" icon={<RefreshCw size={14} aria-hidden />} onClick={() => void fetchImportBatches()} loading={isImportHistoryLoading}>
                  更新
                </Button>
              </div>
              <select value={selectedImportBatchId} onChange={event => handleImportBatchChange(event.target.value)} aria-label="CSV取込履歴" className="mt-4 min-h-11 w-full rounded-input border border-line bg-white px-4 text-sm font-bold text-slate-700 outline-none focus:border-accent focus:ring-2 focus:ring-accent/30">
                <option value="">すべてのアカウントを表示</option>
                {importBatches.map(batch => (
                  <option key={batch.id} value={batch.id}>
                    {batch.imported_at ? (formatDateTime(batch.imported_at, { withYear: true }) || '日時不明') : '日時不明'} ｜ {batch.file_name} ｜ {batch.success_count}件
                  </option>
                ))}
              </select>
              {selectedImportBatch && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-btn border border-line bg-slate-50 px-4 py-3">
                  <p className="text-xs font-bold text-slate-600">
                    <span className="font-bold text-emerald-700">{selectedImportBatch.success_count}件成功</span>
                    {selectedImportBatch.error_count > 0 && <span className="ml-2 font-bold text-rose-600">{selectedImportBatch.error_count}件失敗</span>}
                    <span className="ml-2 text-slate-400">対象を選択済み</span>
                  </p>
                  <Button variant="secondary" size="sm" onClick={() => setSelectedIds(new Set(filteredUsers.map(user => user.id)))}>現在の絞り込みを全選択</Button>
                </div>
              )}
              {importBatches.length === 0 && !isImportHistoryLoading && <p className="mt-3 text-xs font-bold text-slate-400">履歴保存機能の追加後に取り込んだCSVがここに表示されます。</p>}
            </div>
          </section>

          {/* タブ切り替えと操作ボタン */}
          <div className="mb-4 flex flex-col items-stretch justify-between gap-4 sm:flex-row sm:items-center">
            <AdminTabs
              ariaLabel="アカウントの種類"
              value={activeTab}
              onChange={handleTabChange}
              tabs={[
                { id: 'student', label: '生徒', icon: GraduationCap, badge: users.filter(u => u.role === 'student').length },
                { id: 'teacher', label: '講師', icon: UserCheck, badge: users.filter(u => normalizedUserRole(u.role) === 'teacher').length },
                { id: 'master', label: '管理者', icon: Shield, badge: users.filter(u => u.role === 'master').length },
              ]}
            />
            
            <div className="flex gap-2 flex-wrap justify-end">
              <span className="self-center text-xs font-bold text-slate-400">左端のチェックで印刷対象を選択</span>
              <Button
                onClick={() => void handleOpenPrintModal()}
                disabled={selectedIds.size === 0}
                loading={isPasswordSyncing}
                icon={<Printer size={16} aria-hidden />}
              >
                {isPasswordSyncing ? `パスワード確認中${syncProgress ? ` ${syncProgress.done}/${syncProgress.total}` : ''}` : `ID書面を印刷（${selectedIds.size}件）`}
              </Button>
            </div>
          </div>

          {/* リスト表示 */}
          <div className="overflow-hidden rounded-card border border-line bg-white shadow-sm">
            {loading ? (
              <div className="p-5"><ListSkeleton rows={5} /></div>
            ) : loadError ? (
              <ErrorState className="m-5" onRetry={fetchUsers} />
            ) : filteredUsers.length === 0 ? (
              <EmptyState className="m-5" title="該当するアカウントはありません" description={searchQuery || selectedImportBatchId ? '検索語や取込履歴の絞り込みを変えてください。' : 'CSVで一括登録すると、ここに表示されます。'} />
            ) : (
              <div className="overflow-x-auto [scrollbar-gutter:stable]">
                <table className="w-full min-w-[1180px] whitespace-nowrap text-left text-sm">
                  <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                    <tr>
                      <th className="p-4 w-10"><input type="checkbox" aria-label="表示中をすべて選択" className="h-4 w-4 accent-accent" onChange={(e) => handleSelectAll(e.target.checked)} checked={filteredUsers.length > 0 && selectedIds.size === filteredUsers.length}/></th>
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
                  <tbody className="divide-y divide-slate-100">
                    {filteredUsers.map((user) => (
                      <tr key={user.id} className={`hover:bg-slate-50 transition-colors ${selectedIds.has(user.id) ? 'bg-accent-soft/40' : ''}`}>
                        <td className="p-4"><input type="checkbox" aria-label={`${user.student_name || user.name || user.lifetime_id}を選択`} className="h-4 w-4 cursor-pointer accent-accent" checked={selectedIds.has(user.id)} onChange={(e) => handleSelectOne(user.id, e.target.checked)}/></td>
                        
                        <td className="p-4 font-bold text-slate-800">
                          <div className="flex items-center gap-2">
                            <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${
                              user.role === 'student' ? 'bg-sky-500' :
                              normalizedUserRole(user.role) === 'teacher' ? 'bg-accent' : 'bg-slate-700'
                            }`}>
                              {(user.student_name || user.name || '?')[0]}
                            </div>
                            <span className="max-w-[180px] truncate" title={user.student_name || user.name || '未設定'}>
                              {user.student_name || user.name || <span className="text-slate-400">未設定</span>}
                            </span>
                          </div>
                        </td>

                        <td className="p-4 font-mono font-medium text-slate-700">
                          <span className="block max-w-[260px] truncate" title={user.lifetime_id || user.email || ''}>
                            {user.lifetime_id || user.email || <span className="text-slate-300">-</span>}
                          </span>
                        </td>

                        <td className="p-4 text-slate-400 text-xs font-mono">{user.initial_password || '********'}</td>
                        <td className="p-4">
                          <FirstLoginBadge value={user.isFirstLogin} />
                        </td>
                        <td className="p-4">
                          <LastLoginCell value={user.last_login_at || user.last_login} />
                        </td>
                        {activeTab === 'teacher' && (() => {
                          const category = normalizeEmploymentCategory(user.employment_category, user.role) || 'semi_dedicated';
                          return <><td className="p-4"><span className={`rounded-full px-3 py-1 text-xs font-bold ${category === 'dedicated' ? 'bg-accent-soft text-accent' : 'bg-amber-100 text-amber-800'}`}>{EMPLOYMENT_CATEGORY_LABELS[category]}</span></td><td className="p-4 text-xs font-bold text-slate-600">{Array.isArray(user.enabled_programs) && user.enabled_programs.includes('science_social') ? '理社講座あり' : '理社講座なし'}</td></>;
                        })()}
                        
                        {activeTab === 'student' && (
                          <>
                            <td className="p-4"><span className="px-2 py-1 rounded-btn bg-slate-100 text-xs font-bold text-slate-600">{user.grade || '-'}</span></td>
                            <td className="p-4 text-slate-600">{user.classroom || '-'}</td>
                            <td className="p-4 text-slate-600 font-bold">{user.subject_science || '-'}</td>
                            <td className="p-4 text-slate-600 font-bold">{user.subject_social || '-'}</td>
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
      <Modal
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingUser ? 'アカウントを編集' : 'アカウントを登録'}
        footer={(
          <Button fullWidth onClick={handleSave} icon={<Save size={16} aria-hidden />}>
            保存
          </Button>
        )}
      >
            <div className="space-y-4">
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-bold text-slate-500">権限</label>
                  <select 
                    className="mt-1 min-h-11 w-full rounded-input border border-line px-3 bg-slate-50" 
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
                  <label className="text-xs font-bold text-slate-500">ID (ログイン用)</label>
                  <input className="mt-1 min-h-11 w-full rounded-input border border-line px-3 font-mono" value={formData.lifetime_id} onChange={e => setFormData({...formData, lifetime_id: e.target.value})}/>
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-500">氏名</label>
                <input className="mt-1 min-h-11 w-full rounded-input border border-line px-3" value={formData.displayName} onChange={e => setFormData({...formData, displayName: e.target.value})}/>
              </div>

              {formData.role !== 'master' && <div>
                <label className="text-xs font-bold text-slate-500">所属校舎</label>
                <select required className="mt-1 min-h-11 w-full rounded-input border border-line px-3 bg-slate-50" value={formData.school_id || ''} onChange={e => setFormData({ ...formData, school_id: e.target.value })}>
                  <option value="">校舎を選択</option>
                  {ATTENDANCE_SCHOOL_OPTION_GROUPS.map(group => <optgroup key={group.label} label={group.label}>{group.schools.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}</optgroup>)}
                </select>
              </div>}
              
              <div>
                <label className="text-xs font-bold text-slate-500">パスワード</label>
                <input className="mt-1 min-h-11 w-full rounded-input border border-line px-3 font-mono bg-slate-50" value={formData.initial_password} onChange={e => setFormData({...formData, initial_password: e.target.value})} placeholder="空欄ならランダム発行"/>
              </div>

              {formData.role === 'teacher' && (
                <div className="rounded-card border border-line bg-accent-soft p-4">
                  <label className="text-xs font-bold text-accent">専任区分</label>
                  <select className="mt-1 min-h-11 w-full rounded-input border border-line bg-white px-3 font-bold" value={formData.employment_category || 'semi_dedicated'} onChange={e => setFormData({ ...formData, employment_category: e.target.value as 'dedicated' | 'semi_dedicated' })}>
                    <option value="dedicated">専任</option>
                    <option value="semi_dedicated">準専任</option>
                  </select>
                  <label className="mt-3 flex cursor-pointer items-center gap-3 rounded-btn bg-white p-3 text-sm font-bold text-slate-700"><input type="checkbox" checked={formData.enabled_programs?.includes('science_social') || false} onChange={event => setFormData({ ...formData, enabled_programs: event.target.checked ? ['science_social'] : [] })} className="h-5 w-5 accent-accent" /><span>理社講座を利用する<span className="block text-xs text-slate-400">ONの場合は理社講座画面から勤怠へ移動できます。OFFの場合は勤怠画面を直接開きます。</span></span></label>
                  {formData.employment_category === 'dedicated' && <div className="mt-3 rounded-btn bg-white p-3"><div className="grid grid-cols-3 gap-2"><label className="text-xs font-bold text-slate-500">規定開始<input type="time" value={formData.prescribed_work_start || '09:00'} onChange={event => setFormData({ ...formData, prescribed_work_start: event.target.value })} className="mt-1 w-full rounded-input border border-line p-2 text-xs" /></label><label className="text-xs font-bold text-slate-500">規定終了<input type="time" value={formData.prescribed_work_end || '18:00'} onChange={event => setFormData({ ...formData, prescribed_work_end: event.target.value })} className="mt-1 w-full rounded-input border border-line p-2 text-xs" /></label><label className="text-xs font-bold text-slate-500">休憩（分）<input type="number" min="0" max="240" step="5" value={formData.prescribed_break_minutes ?? 60} onChange={event => setFormData({ ...formData, prescribed_break_minutes: Number(event.target.value) })} className="mt-1 w-full rounded-input border border-line p-2 text-xs" /></label></div><div className="mt-2 flex flex-wrap gap-1">{['日', '月', '火', '水', '木', '金', '土'].map((label, day) => <label key={day} className={`cursor-pointer rounded-btn border px-2 py-1 text-xs font-bold ${(formData.prescribed_work_days || []).includes(day) ? 'border-accent bg-accent text-accent-ink' : 'border-line text-slate-500'}`}><input type="checkbox" className="sr-only" checked={(formData.prescribed_work_days || []).includes(day)} onChange={event => setFormData({ ...formData, prescribed_work_days: event.target.checked ? [...(formData.prescribed_work_days || []), day].sort() : (formData.prescribed_work_days || []).filter(value => value !== day) })} />{label}</label>)}</div></div>}
                  {formData.employment_category === 'dedicated' && <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-btn border border-emerald-200 bg-emerald-50 p-3"><input type="checkbox" checked={formData.attendance_school_manager === true} onChange={event => setFormData({ ...formData, attendance_school_manager: event.target.checked })} className="mt-0.5 h-5 w-5 accent-emerald-600" /><span><span className="block text-sm font-bold text-emerald-900">自校舎の勤怠責任者</span><span className="mt-1 block text-xs font-bold leading-relaxed text-emerald-700">理社講座の利用設定にかかわらず、自校舎の打刻修正依頼と勤務詳細を承認できます。</span></span></label>}
                </div>
              )}
              
              {formData.role === 'student' && (
                <div className="space-y-4 rounded-card border border-line bg-slate-50 p-4">
                  <div className="grid grid-cols-2 gap-4">
                     <div>
                       <label className="text-xs font-bold text-slate-500">学年</label>
                       <select className="mt-1 min-h-11 w-full rounded-input border border-line px-3" value={formData.grade} onChange={e => setFormData({...formData, grade: e.target.value})}>
                         <option value="">選択</option><option>中1</option><option>中2</option><option>中3</option>
                       </select>
                     </div>
                     <div>
                       <label className="text-xs font-bold text-slate-500">教室</label>
                       <input className="mt-1 min-h-11 w-full rounded-input border border-line px-3" value={formData.classroom} onChange={e => setFormData({...formData, classroom: e.target.value})}/>
                     </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-bold text-slate-500">理科科目</label>
                      <input 
                        className="mt-1 min-h-11 w-full rounded-input border border-line px-3" 
                        value={formData.subject_science} 
                        onChange={e => setFormData({...formData, subject_science: e.target.value})}
                        placeholder="例: 地学"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-slate-500">社会科目</label>
                      <input 
                        className="mt-1 min-h-11 w-full rounded-input border border-line px-3" 
                        value={formData.subject_social} 
                        onChange={e => setFormData({...formData, subject_social: e.target.value})}
                        placeholder="例: 歴史A"
                      />
                    </div>
                  </div>
                  <label className="flex cursor-pointer items-center gap-3 rounded-btn border border-line bg-white p-3 text-sm font-bold text-slate-800"><input type="checkbox" checked={formData.enabled_programs?.includes('online_school') || false} onChange={event => setFormData({ ...formData, enabled_programs: event.target.checked ? ['online_school'] : [] })} className="h-5 w-5 accent-accent" /><span>オンライン校を利用する<span className="block text-xs text-slate-500">生徒のアプリ一覧に10分学習を表示</span></span></label>
                </div>
              )}
            </div>
      </Modal>
    </>
  );
}

function FirstLoginBadge({ value }: { value: unknown }) {
  const completed = value === false;
  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-bold ${completed ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
      {completed ? '初回ログイン済み' : '初回変更待ち'}
    </span>
  );
}
