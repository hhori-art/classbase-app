'use client';

import { useState, useEffect } from 'react';
import { auth, db } from '@/lib/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { fetchTeacherStudents } from '@/lib/teacher-students-client';
import { 
  Users, Download, Filter, X, MapPin,
  GraduationCap, BookOpen, Clock, Trophy,
  RefreshCw, CalendarCheck, CheckCircle2
} from 'lucide-react';
import {
  Button, Card, PageHeader, StatusPill, useToast, useConfirm,
  ListSkeleton, EmptyState, ErrorState,
} from '@/app/components/ui';
import { formatDate, formatTime, jstDateKey } from '@/lib/format';

export default function TeacherStudentsPage() {
  // 生徒データ管理
  const [students, setStudents] = useState<any[]>([]);
  const [filteredStudents, setFilteredStudents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const toast = useToast();
  const confirm = useConfirm();

  // フィルター条件
  const [searchQuery, setSearchQuery] = useState('');
  const [filterGrade, setFilterGrade] = useState('all');
  const [filterDay, setFilterDay] = useState('all');
  const [filterClassroom, setFilterClassroom] = useState('');

  // ★変更点: 簡易出席確認用 (setIntervalは使いません)
  const [monitorShiftId, setMonitorShiftId] = useState('');
  const [attendingStudentIds, setAttendingStudentIds] = useState<string[]>([]); // 出席者のIDリストのみ管理
  const [monitorLoading, setMonitorLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  // 本日の授業リスト
  const [todayShifts, setTodayShifts] = useState<any[]>([]);

  // 1. 初回データ取得（ページを開いた時のみ1回だけ実行）
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setLoadError(false);
      try {
        // A. 生徒データ取得
        const list = await fetchTeacherStudents();
        // 学年順でソート
        list.sort((a: any, b: any) => (a.grade || '').localeCompare(b.grade || ''));
        setStudents(list);
        setFilteredStudents(list);

        // B. 本日のシフト取得
        const today = new Date();
        const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        
        const shiftsQ = query(
          collection(db, 'shift_assignments'), 
          where('target_date', '==', dateStr)
        );
        const shiftsSnap = await getDocs(shiftsQ);
        const shifts = shiftsSnap.docs
          .map(doc => ({ id: doc.id, ...doc.data() }))
          // ミーティングIDがあるものだけ
          .filter((s: any) => s.target_meeting_id && s.target_meeting_id.trim() !== '');
        
        // 授業順(note)などでソート
        shifts.sort((a: any, b: any) => (a.note || '').localeCompare(b.note || ''));
        
        setTodayShifts(shifts);

      } catch (e) {
        console.error('Fetch error:', e);
        setLoadError(true);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    // マウント時と「もう一度読み込む」を押した時だけ走ります
  }, [reloadKey]);

  // 2. フィルタリング処理（出席状況が変わった時も再計算）
  useEffect(() => {
    let result = students;

    result = result.filter(s => {
      let match = true;

      // キーワード検索
      if (searchQuery) {
        const lowerQ = searchQuery.toLowerCase();
        const nameMatch = s.student_name && s.student_name.toLowerCase().includes(lowerQ);
        const idMatch = s.lifetime_id && String(s.lifetime_id).includes(lowerQ);
        if (!nameMatch && !idMatch) match = false;
      }

      // フィルター条件
      if (filterGrade !== 'all' && s.grade !== filterGrade) match = false;
      if (filterDay !== 'all') {
        if (!s.day_of_week || !s.day_of_week.includes(filterDay)) match = false;
      }
      if (filterClassroom) {
        if (!s.classroom || !s.classroom.includes(filterClassroom)) match = false;
      }

      return match;
    });

    // ソート：出席者をリストの上部に持ってくる
    if (attendingStudentIds.length > 0) {
      result.sort((a, b) => {
        const aActive = attendingStudentIds.includes(a.id) ? 1 : 0;
        const bActive = attendingStudentIds.includes(b.id) ? 1 : 0;
        if (bActive !== aActive) return bActive - aActive; // アクティブ優先
        return (a.grade || '').localeCompare(b.grade || '');
      });
    }

    setFilteredStudents(result);
  }, [students, searchQuery, filterGrade, filterDay, filterClassroom, attendingStudentIds]);

  // ★変更点: 手動更新ロジック (ボタンを押した時だけAPIを叩く)
  const checkAttendance = async () => {
    const selectedShift = todayShifts.find(shift => shift.id === monitorShiftId);
    const cleanId = String(selectedShift?.target_meeting_id || '').replace(/\s+/g, '');
    if (!selectedShift || !cleanId) return toast.error("授業を選択してください");

    setMonitorLoading(true);
    try {
      // Zoom APIから参加者リストを取得
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error('not-authenticated');
      const token = await currentUser.getIdToken();
      const res = await fetch('/api/get-zoom-live-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ meetingId: cleanId, shiftId: selectedShift.id })
      });
      const data = await res.json();

      if (data.success) {
        // カメラ状態は無視して、IDが一致した生徒のリストだけ抽出
        const presentIds = data.participants
          .filter((p: any) => p.matched_id)
          .map((p: any) => p.matched_id);

        setAttendingStudentIds(presentIds);
        
        setLastUpdated(formatTime(new Date()));
      } else {
        toast.error("Zoom情報の取得に失敗しました");
      }
    } catch (e) {
      console.error(e);
      toast.error("通信エラーが発生しました");
    } finally {
      setMonitorLoading(false);
    }
  };

  // CSV出力機能
  const handleExportCSV = async () => {
    if (filteredStudents.length === 0) return toast.info('出力するデータがありません');
    if (!(await confirm({ title: '現在表示されているリストをCSVでダウンロードしますか？', confirmLabel: 'ダウンロード' }))) return;

    let csvContent = '\uFEFF';
    csvContent += "ID,氏名,学年,曜日,教室,受講科目,最終アクセス,コイン,メールアドレス,出席状況\n";

    filteredStudents.forEach(s => {
      const subjects = [
        s.subject_1, s.subject_2, s.subject_3, s.subject_4, s.subject_5,
        s.subject_science, s.subject_social, ...(s.subjects || [])
      ].filter(v => v && typeof v === 'string').join('/');

      const lastLogin = s.last_login ? new Date(s.last_login).toLocaleString() : '未ログイン';
      // 現在の出席状況もCSVに含める
      const isPresent = attendingStudentIds.includes(s.id) ? "出席中" : "";

      const row = [
        `"${s.lifetime_id || ''}"`,
        `"${s.student_name || ''}"`,
        `"${s.grade || ''}"`,
        `"${s.day_of_week || ''}"`,
        `"${s.classroom || ''}"`,
        `"${subjects}"`,
        `"${lastLogin}"`,
        `"${s.coins || 0}"`,
        `"${s.email || ''}"`,
        `"${isPresent}"`
      ].join(",");
      csvContent += row + "\n";
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `生徒名簿_${jstDateKey()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const clearFilters = () => {
    setSearchQuery('');
    setFilterGrade('all');
    setFilterDay('all');
    setFilterClassroom('');
    setAttendingStudentIds([]); // 出席表示もクリア
    setLastUpdated(null);
  };

  // 科目リスト生成ヘルパー
  const getSubjectList = (student: any) => {
    const list = [
      student.subject_1, student.subject_2, student.subject_3, student.subject_4, student.subject_5,
      student.subject_science, student.subject_social, ...(student.subjects || [])
    ];
    return Array.from(new Set(list.filter(s => s && typeof s === 'string' && s.trim() !== '')));
  };

  const FIELD = 'min-h-11 w-full rounded-input border border-line bg-surface px-3 py-2 text-sm text-fg outline-none focus:ring-2 focus:ring-accent/30';

  return (
    <div className="px-4 py-5 pb-32 sm:px-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <PageHeader
          tone="plain"
          title="生徒名簿"
          icon={Users}
          description="生徒情報の確認・CSV出力・出席確認"
          backHref="/teacher/work"
          actions={(
            <Button variant="secondary" onClick={handleExportCSV} icon={<Download size={18} aria-hidden />}>
              名簿出力 (CSV)
            </Button>
          )}
        />

        {/* 簡易出席チェッカー（手動更新のみ） */}
        <section className="rounded-card border border-slate-700 bg-slate-900 p-4 text-white shadow-card">
          <div className="flex flex-col items-center justify-between gap-4 md:flex-row">
            <div className="flex w-full items-center gap-3 md:w-auto">
              <div className="rounded-btn bg-slate-800 p-2">
                <CheckCircle2 size={24} className={attendingStudentIds.length > 0 ? 'text-emerald-400' : 'text-slate-400'} aria-hidden />
              </div>
              <div>
                <h2 className="flex items-center gap-2 font-bold">
                  簡易出席チェッカー
                </h2>
                <p className="text-xs text-slate-400">
                  {lastUpdated
                    ? `最終確認: ${lastUpdated} - ${attendingStudentIds.length}名が出席中`
                    : 'Zoomの参加状況を確認できます（ボタンを押すと更新）'}
                </p>
              </div>
            </div>

            <div className="flex w-full items-center gap-2 md:w-auto">
              <div className="relative min-w-0 flex-1 md:flex-none">
                <select
                  aria-label="本日の授業"
                  className="min-h-11 w-full cursor-pointer appearance-none rounded-input border border-slate-600 bg-slate-800 p-2.5 pr-8 text-sm text-white transition-colors hover:bg-slate-700 md:w-80"
                  value={monitorShiftId}
                  onChange={(e) => {
                    setMonitorShiftId(e.target.value);
                    setAttendingStudentIds([]); // 授業を変更したらリセット
                    setLastUpdated(null);
                  }}
                >
                  <option value="">▼ 本日の授業を選択してください</option>
                  {todayShifts.length > 0 ? (
                    todayShifts.map((shift) => {
                      const note = shift.note?.replace(/[【】]/g, '') || '';
                      return (
                        <option key={shift.id} value={shift.id}>
                          {note} | {shift.target_grade} {shift.target_subject} ({shift.teacher_name})
                        </option>
                      );
                    })
                  ) : (
                    <option disabled>本日の授業予定がありません</option>
                  )}
                </select>
                <CalendarCheck size={16} className="pointer-events-none absolute right-3 top-3.5 text-slate-400" aria-hidden />
              </div>

              {/* 手動更新ボタン */}
              <Button
                onClick={checkAttendance}
                disabled={!monitorShiftId}
                loading={monitorLoading}
                icon={<RefreshCw size={16} aria-hidden />}
                className="whitespace-nowrap"
              >
                出席確認
              </Button>
            </div>
          </div>
        </section>

        {/* フィルターエリア */}
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-bold text-slate-700"><Filter size={16} aria-hidden /> 生徒検索・絞り込み</h2>
            <Button variant="ghost" size="sm" onClick={clearFilters} icon={<X size={12} aria-hidden />}>条件クリア</Button>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="col-span-2 md:col-span-1">
              <input type="text" aria-label="氏名またはID" className={FIELD} placeholder="氏名またはID..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
            </div>
            <div>
              <select aria-label="学年" className={FIELD} value={filterGrade} onChange={e => setFilterGrade(e.target.value)}>
                <option value="all">全学年</option><option value="中1">中1</option><option value="中2">中2</option><option value="中3">中3</option>
              </select>
            </div>
            <div>
              <select aria-label="曜日" className={FIELD} value={filterDay} onChange={e => setFilterDay(e.target.value)}>
                <option value="all">全曜日</option><option>月</option><option>火</option><option>水</option><option>木</option><option>金</option><option>土</option><option>日</option>
              </select>
            </div>
            <div>
              <input type="text" aria-label="教室名" className={FIELD} placeholder="教室名..." value={filterClassroom} onChange={(e) => setFilterClassroom(e.target.value)} />
            </div>
          </div>
        </Card>

        {/* 生徒リスト */}
        <Card padded={false} className="min-h-[400px] overflow-hidden">
          <div className="flex items-center justify-between border-b border-line bg-canvas p-4">
            <span className="font-bold text-slate-700">検索結果 ({filteredStudents.length}名)</span>
            {attendingStudentIds.length > 0 && <span className="rounded bg-accent-soft px-2 py-1 text-xs font-bold text-accent">※出席中の生徒が優先表示されます</span>}
          </div>

          {loading ? (
            <div className="p-4"><ListSkeleton rows={5} /></div>
          ) : loadError ? (
            <div className="p-4"><ErrorState onRetry={() => setReloadKey(value => value + 1)} /></div>
          ) : (
            <div className="divide-y divide-line">
              {filteredStudents.length === 0 ? (
                <div className="p-4"><EmptyState icon={Users} title="条件に一致する生徒がいません" /></div>
              ) : (
                filteredStudents.map((student) => {
                  const subjects = getSubjectList(student);
                  const lastLoginDate = student.last_login ? new Date(student.last_login) : null;
                  const daysSinceLogin = lastLoginDate
                    ? Math.floor((new Date().getTime() - lastLoginDate.getTime()) / (1000 * 3600 * 24))
                    : 999;

                  // 出席中かどうか
                  const isAttending = attendingStudentIds.includes(student.id);

                  return (
                    <div key={student.id} className={`group relative flex flex-col justify-between gap-4 border-l-4 p-5 transition-colors md:flex-row md:items-center
                      ${isAttending ? 'border-accent bg-accent-soft/70' : 'border-transparent hover:bg-canvas'}
                    `}>
                      <div className="flex items-center gap-4">
                        <div className={`relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-lg font-bold text-white shadow-sm
                          ${student.grade?.includes('3') ? 'bg-rose-400' : student.grade?.includes('2') ? 'bg-blue-400' : 'bg-emerald-400'}
                        `}>
                          {student.student_name ? student.student_name.charAt(0) : <Users size={20} aria-hidden />}
                        </div>
                        <div>
                          <div className="mb-1 flex flex-wrap items-center gap-2">
                            <h3 className="text-lg font-bold text-fg">{student.student_name || '名称未設定'}</h3>
                            {isAttending && <StatusPill tone="accent">Zoom出席中</StatusPill>}
                            <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-500">ID: {student.lifetime_id}</span>
                          </div>
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-muted">
                            <span className="flex items-center gap-1"><GraduationCap size={12} aria-hidden /> {student.grade || '-'}</span>
                            <span className="flex items-center gap-1"><MapPin size={12} aria-hidden /> {student.classroom || '教室未設定'} ({student.day_of_week || '-'})</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-6 text-sm">
                        <div className="min-w-[120px]">
                          <div className="mb-1 flex items-center gap-1 text-xs font-bold text-slate-400"><BookOpen size={12} aria-hidden /> 受講科目</div>
                          <div className="flex flex-wrap gap-1">
                            {subjects.length > 0 ? subjects.map(sub => (
                              <span key={sub} className="rounded border border-accent/20 bg-accent-soft px-1.5 py-0.5 text-xs font-bold text-accent">
                                {sub}
                              </span>
                            )) : <span className="text-xs text-slate-300">-</span>}
                          </div>
                        </div>

                        <div className="min-w-[140px] border-l border-line pl-4">
                          <div className="mb-1 flex items-center gap-1 text-xs font-bold text-slate-400"><Clock size={12} aria-hidden /> アプリ利用状況</div>
                          <div className={`text-xs font-bold ${daysSinceLogin > 7 ? 'text-danger' : 'text-slate-600'}`}>
                            最終: {lastLoginDate ? formatDate(lastLoginDate, { withYear: true }) : '未ログイン'}
                          </div>
                          <div className="mt-0.5 flex items-center gap-1 text-xs font-bold text-amber-600">
                            <Trophy size={12} className="fill-amber-500" aria-hidden /> {student.coins || 0} コイン
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
