'use client';

import { useState, useEffect, useMemo } from 'react';
import { db } from '@/lib/firebase';
import { auth } from '@/lib/firebase';
import { collection, query, orderBy, limit, getDocs, where } from 'firebase/firestore';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell
} from 'recharts';
import { 
  Users, Activity, Clock, Calendar, ArrowLeft, TrendingUp, Search, Download, Filter, PieChart as PieIcon, Trophy 
} from 'lucide-react';
import Link from 'next/link';

export default function StatisticsPage() {
  const [dailyStats, setDailyStats] = useState<any[]>([]);
  const [allStudents, setAllStudents] = useState<any[]>([]);
  const [betaAnalytics, setBetaAnalytics] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  
  // フィルタ・検索用
  const [searchQuery, setSearchQuery] = useState('');
  const [gradeFilter, setGradeFilter] = useState('all');

  useEffect(() => {
    const fetchData = async () => {
      try {
        // 1. 日別アクセス推移 (過去14日間)
        const statsQuery = query(collection(db, 'system_stats'), orderBy('date', 'desc'), limit(14));
        const statsSnap = await getDocs(statsQuery);
        const statsData = statsSnap.docs.map(d => ({
          date: d.data().date.slice(5), // MM-DD
          users: d.data().active_uids?.length || 0,
          access: d.data().total_access || 0
        })).reverse();
        setDailyStats(statsData);

        // 2. 全生徒データの取得
        const usersQuery = query(collection(db, 'users'), where('role', '==', 'student'));
        const usersSnap = await getDocs(usersQuery);
        
        const studentsData = usersSnap.docs.map(d => {
          const data = d.data();
          const lastLoginDate = data.last_login_at?.toDate ? data.last_login_at.toDate() : null;
          
          const daysSinceLogin = lastLoginDate 
            ? Math.floor((new Date().getTime() - lastLoginDate.getTime()) / (1000 * 3600 * 24)) 
            : 999;

          return {
            id: d.id,
            name: data.student_name || '未設定',
            grade: data.grade || 'その他',
            login_count: data.login_count || 0,
            last_login: lastLoginDate ? lastLoginDate.toLocaleDateString() : 'なし',
            days_since: daysSinceLogin,
            status: daysSinceLogin < 3 ? 'active' : daysSinceLogin < 14 ? 'warning' : 'inactive'
          };
        });

        studentsData.sort((a, b) => b.login_count - a.login_count);
        setAllStudents(studentsData);

        const token = await auth.currentUser?.getIdToken();
        if (token) {
          const betaRes = await fetch('/api/admin/beta-analytics?days=30', {
            headers: { Authorization: `Bearer ${token}` },
          });
          const betaData = await betaRes.json().catch(() => ({}));
          if (betaRes.ok && betaData.ok !== false) setBetaAnalytics(betaData);
        }

      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  // フィルタリング処理
  const filteredStudents = useMemo(() => {
    return allStudents.filter(s => {
      const matchesSearch = s.name.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesGrade = gradeFilter === 'all' || s.grade === gradeFilter;
      return matchesSearch && matchesGrade;
    });
  }, [allStudents, searchQuery, gradeFilter]);

  // ★修正: アクティブユーザーのみの学年分布データ作成
  const activeGradeDistribution = useMemo(() => {
    const counts: {[key: string]: number} = {};
    // activeステータスの生徒のみを集計
    allStudents.filter(s => s.status === 'active').forEach(s => {
      const g = s.grade || '不明';
      counts[g] = (counts[g] || 0) + 1;
    });
    
    // データがない場合のフォールバック（表示崩れ防止）
    if (Object.keys(counts).length === 0) return [{ name: 'なし', value: 1 }];

    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [allStudents]);

  // 今日のアクセス数
  const todayDAU = dailyStats.length > 0 ? dailyStats[dailyStats.length - 1].users : 0;
  
  // アクティブ率
  const activeUserCount = allStudents.filter(s => s.status === 'active').length;
  const activeRate = allStudents.length > 0 ? Math.round((activeUserCount / allStudents.length) * 100) : 0;

  // ★追加: ランキングデータ (トップ3)
  const topUsers = allStudents.slice(0, 3);

  // CSVダウンロード
  const handleDownloadCSV = () => {
    const header = "名前,学年,ログイン回数,最終ログイン,ステータス\n";
    const rows = filteredStudents.map(s => 
      `${s.name},${s.grade},${s.login_count},${s.last_login},${s.status}`
    ).join("\n");
    
    const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "student_activity_data.csv";
    link.click();
  };

  const handleDownloadBetaCSV = () => {
    if (!betaAnalytics) return;
    const header = '日付,アクティブユーザー,生徒,講師,PV,クリック,エラー,平均滞在分,総イベント\n';
    const rows = betaAnalytics.daily.map((row: any) => [
      row.date,
      row.active_users,
      row.student_users,
      row.teacher_users,
      row.page_views,
      row.clicks,
      row.errors,
      row.avg_minutes,
      row.total_events,
    ].join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + header + rows], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'beta_test_effectiveness.csv';
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const COLORS = ['#6366F1', '#EC4899', '#10B981', '#F59E0B', '#8B5CF6'];

  return (
    <div className="min-h-screen bg-gray-50 p-6 font-sans text-slate-800">
      <div className="max-w-[1600px] mx-auto">
        
        {/* ヘッダー */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Link href="/master" className="bg-white p-3 rounded-full shadow hover:bg-gray-100 text-gray-600 transition-colors">
              <ArrowLeft size={24} />
            </Link>
            <div>
              <h1 className="text-2xl font-black text-gray-800 flex items-center gap-2">
                <Activity className="text-indigo-600" /> 統計・詳細分析
              </h1>
              <p className="text-xs text-gray-500 font-bold mt-1">全生徒のアクティビティ詳細データ</p>
            </div>
          </div>
          <button onClick={handleDownloadCSV} className="bg-green-600 text-white px-5 py-2.5 rounded-full font-bold text-sm flex items-center gap-2 hover:bg-green-700 transition-colors shadow-lg shadow-green-100 active:scale-95">
            <Download size={18}/> CSV出力
          </button>
        </div>

        {/* KPIカード */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-white p-6 rounded-[24px] shadow-sm border border-indigo-50 flex items-center gap-4 transition-transform hover:scale-[1.02]">
            <div className="p-4 bg-indigo-50 text-indigo-600 rounded-2xl"><Users size={28} /></div>
            <div>
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider">今日のDAU</p>
              <p className="text-3xl font-black text-gray-800">{todayDAU} <span className="text-sm font-bold text-gray-400">人</span></p>
            </div>
          </div>
          <div className="bg-white p-6 rounded-[24px] shadow-sm border border-green-50 flex items-center gap-4 transition-transform hover:scale-[1.02]">
            <div className="p-4 bg-green-50 text-green-600 rounded-2xl"><TrendingUp size={28} /></div>
            <div>
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider">アクティブ率</p>
              <p className="text-3xl font-black text-gray-800">{activeRate}<span className="text-sm font-bold text-gray-400">%</span></p>
            </div>
          </div>
          <div className="bg-white p-6 rounded-[24px] shadow-sm border border-orange-50 flex items-center gap-4 transition-transform hover:scale-[1.02]">
            <div className="p-4 bg-orange-50 text-orange-600 rounded-2xl"><Clock size={28} /></div>
            <div>
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider">平均ログイン間隔</p>
              <p className="text-xl font-black text-gray-800">約 2.5 <span className="text-sm font-bold text-gray-400">日</span></p>
            </div>
          </div>
          <div className="bg-white p-6 rounded-[24px] shadow-sm border border-pink-50 flex items-center gap-4 transition-transform hover:scale-[1.02]">
            <div className="p-4 bg-pink-50 text-pink-600 rounded-2xl"><Users size={28} /></div>
            <div>
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider">総生徒数</p>
              <p className="text-3xl font-black text-gray-800">{allStudents.length} <span className="text-sm font-bold text-gray-400">人</span></p>
            </div>
          </div>
        </div>

        {/* βテスト効果検証 */}
        {betaAnalytics && (
          <div id="beta-analytics" className="mb-8 scroll-mt-6 rounded-[32px] border border-violet-100 bg-white p-6 shadow-sm">
            <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-wider text-violet-500">Beta Test Effectiveness</p>
                <h2 className="mt-1 text-xl font-black text-gray-800">テスト利用の効果検証</h2>
                <p className="mt-2 text-sm font-bold text-gray-400">利用率、機能別利用、学習行動、録画視聴、アンケート、エラーを30日単位で集計します。</p>
              </div>
              <button onClick={handleDownloadBetaCSV} className="w-fit rounded-2xl bg-violet-600 px-4 py-3 text-xs font-black text-white shadow-sm transition-colors hover:bg-violet-700">
                β集計CSV
              </button>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {[
                { label: '有用性スコア', value: `${betaAnalytics.kpis.evidence_score}`, unit: '/100', color: 'text-violet-700 bg-violet-50' },
                { label: '生徒アクティブ率', value: `${betaAnalytics.kpis.activation_rate}`, unit: '%', color: 'text-indigo-700 bg-indigo-50' },
                { label: '平均滞在時間', value: `${betaAnalytics.kpis.avg_minutes}`, unit: '分', color: 'text-emerald-700 bg-emerald-50' },
                { label: 'エラー件数', value: `${betaAnalytics.kpis.errors}`, unit: '件', color: 'text-rose-700 bg-rose-50' },
                { label: '録画視聴', value: `${betaAnalytics.kpis.recording_views}`, unit: '回', color: 'text-red-700 bg-red-50' },
                { label: 'クエスト実施', value: `${betaAnalytics.kpis.quest_count}`, unit: '回', color: 'text-blue-700 bg-blue-50' },
                { label: 'クエスト合格率', value: `${betaAnalytics.kpis.quest_pass_rate}`, unit: '%', color: 'text-sky-700 bg-sky-50' },
                { label: 'アンケート回答', value: `${betaAnalytics.kpis.survey_count}`, unit: '件', color: 'text-amber-700 bg-amber-50' },
              ].map(item => (
                <div key={item.label} className={`rounded-3xl p-5 ${item.color}`}>
                  <p className="text-[10px] font-black uppercase tracking-wider opacity-70">{item.label}</p>
                  <p className="mt-2 text-3xl font-black">{item.value}<span className="ml-1 text-sm font-bold opacity-60">{item.unit}</span></p>
                </div>
              ))}
            </div>

            <div className="mt-6 grid gap-6 xl:grid-cols-3">
              <div className="rounded-3xl border border-gray-100 bg-gray-50/70 p-5 xl:col-span-2">
                <h3 className="mb-4 text-sm font-black text-gray-700">日別のテスト利用推移</h3>
                <div className="h-[260px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={betaAnalytics.daily}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                      <XAxis dataKey="date" tickFormatter={(value) => String(value).slice(5)} tick={{ fontSize: 11, fill: '#94A3B8', fontWeight: 'bold' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
                      <RechartsTooltip contentStyle={{ borderRadius: 16, border: 'none', boxShadow: '0 10px 20px rgba(15,23,42,.12)' }} />
                      <Bar name="生徒利用" dataKey="student_users" fill="#8B5CF6" radius={[6, 6, 0, 0]} />
                      <Bar name="クリック" dataKey="clicks" fill="#A7F3D0" radius={[6, 6, 0, 0]} />
                      <Bar name="エラー" dataKey="errors" fill="#FDA4AF" radius={[6, 6, 0, 0]} />
                      <Legend />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="rounded-3xl border border-gray-100 bg-gray-50/70 p-5">
                <h3 className="mb-4 text-sm font-black text-gray-700">よく使われた機能</h3>
                <div className="space-y-3">
                  {betaAnalytics.top_features.length === 0 ? (
                    <p className="rounded-2xl bg-white p-5 text-center text-xs font-bold text-gray-400">データなし</p>
                  ) : betaAnalytics.top_features.slice(0, 8).map((item: any) => (
                    <div key={item.name} className="rounded-2xl bg-white p-3">
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate text-xs font-black text-gray-700">{item.name}</span>
                        <span className="text-xs font-black text-violet-600">{item.count}</span>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-100">
                        <div className="h-full rounded-full bg-violet-500" style={{ width: `${Math.min(100, item.count / Math.max(1, betaAnalytics.top_features[0]?.count || 1) * 100)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-6 rounded-3xl border border-amber-100 bg-amber-50 p-5">
              <h3 className="mb-3 text-sm font-black text-amber-800">フォローが必要な可能性がある生徒</h3>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {betaAnalytics.follow_up.length === 0 ? (
                  <p className="rounded-2xl bg-white p-5 text-center text-xs font-bold text-amber-500 md:col-span-2 xl:col-span-3">現在、優先フォロー候補はありません</p>
                ) : betaAnalytics.follow_up.slice(0, 9).map((item: any) => (
                  <div key={item.uid} className="rounded-2xl bg-white p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-black text-gray-800">{item.name}</p>
                        <p className="mt-1 text-[10px] font-bold text-gray-400">{item.grade || '学年未設定'} / 最終: {item.last_path || '-'}</p>
                      </div>
                      <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-black text-amber-700">{item.days_since}日前</span>
                    </div>
                    <p className="mt-2 text-[11px] font-bold text-gray-500">イベント数: {item.event_count}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* グラフエリア */}
        <div className="grid lg:grid-cols-3 gap-8 mb-8">
          
          {/* 左: アクセス推移 */}
          <div className="lg:col-span-2 bg-white p-8 rounded-[32px] shadow-sm border border-gray-100">
            <h2 className="text-lg font-black text-gray-700 mb-6 flex items-center gap-2">
              <Calendar size={20} className="text-indigo-500"/> 週間アクセス推移 (14日間)
            </h2>
            <div className="h-[320px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dailyStats} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F3F4F6"/>
                  <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{fill: '#9CA3AF', fontSize: 12, fontWeight: 'bold'}} dy={10}/>
                  <YAxis axisLine={false} tickLine={false} tick={{fill: '#9CA3AF', fontSize: 12}} />
                  <RechartsTooltip cursor={{fill: '#F9FAFB'}} contentStyle={{borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)', padding: '12px'}} labelStyle={{fontWeight: 'bold', color: '#374151', marginBottom: '8px'}}/>
                  <Bar name="利用人数" dataKey="users" fill="#6366F1" radius={[6, 6, 0, 0]} barSize={24}/>
                  <Bar name="アクセス回数" dataKey="access" fill="#BFDBFE" radius={[6, 6, 0, 0]} barSize={24}/>
                  <Legend iconType="circle" wrapperStyle={{paddingTop: '20px'}}/>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* 右: 学年分布 & ランキング */}
          <div className="space-y-6">
            
            {/* 学年分布 (円グラフ) */}
            <div className="bg-white p-8 rounded-[32px] shadow-sm border border-gray-100">
              <h2 className="text-lg font-black text-gray-700 mb-2 flex items-center gap-2">
                <PieIcon size={20} className="text-pink-500"/> 利用者の学年分布
              </h2>
              <p className="text-xs text-gray-400 font-bold mb-6 ml-7">アクティブユーザーのみ集計</p>
              
              <div className="h-[200px] w-full relative">
                {activeUserCount > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={activeGradeDistribution}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={80}
                        paddingAngle={5}
                        dataKey="value"
                      >
                        {activeGradeDistribution.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} strokeWidth={0} />
                        ))}
                      </Pie>
                      <RechartsTooltip contentStyle={{borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'}}/>
                      <Legend verticalAlign="middle" align="right" layout="vertical" iconType="circle"/>
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-full text-gray-300 font-bold text-xs">データなし</div>
                )}
                {/* 中心テキスト */}
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none pr-20">
                  <span className="text-3xl font-black text-gray-800">{activeUserCount}</span>
                  <span className="text-[10px] font-bold text-gray-400">ACTIVE</span>
                </div>
              </div>
            </div>

            {/* ★追加: ログインランキング */}
            <div className="bg-white p-6 rounded-[32px] shadow-sm border border-gray-100">
              <h2 className="text-sm font-black text-gray-700 mb-4 flex items-center gap-2">
                <Trophy size={16} className="text-yellow-500"/> ログイン回数 TOP3
              </h2>
              <div className="space-y-3">
                {topUsers.map((user, i) => (
                  <div key={user.id} className="flex items-center justify-between p-2 rounded-xl bg-gray-50/50">
                    <div className="flex items-center gap-3">
                      <span className={`w-6 h-6 flex items-center justify-center rounded-full text-xs font-black text-white ${i===0?'bg-yellow-400':i===1?'bg-gray-400':'bg-orange-400'}`}>{i+1}</span>
                      <div>
                        <p className="text-xs font-bold text-gray-700">{user.name}</p>
                        <p className="text-[10px] text-gray-400">{user.grade}</p>
                      </div>
                    </div>
                    <span className="text-sm font-black text-indigo-600">{user.login_count}回</span>
                  </div>
                ))}
              </div>
            </div>

          </div>
        </div>

        {/* 詳細データテーブル */}
        <div className="bg-white p-8 rounded-[32px] shadow-sm border border-gray-100">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
            <h2 className="text-lg font-black text-gray-700 flex items-center gap-2">
              <Activity size={20} className="text-orange-500"/> 全生徒の詳細データ
            </h2>
            
            <div className="flex gap-2">
              {/* 学年フィルタ */}
              <div className="relative group">
                <Filter size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-indigo-500 transition-colors"/>
                <select 
                  className="pl-9 pr-8 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold text-gray-600 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-50 transition-all cursor-pointer appearance-none"
                  value={gradeFilter}
                  onChange={(e) => setGradeFilter(e.target.value)}
                >
                  <option value="all">全学年</option>
                  <option value="中1">中1</option>
                  <option value="中2">中2</option>
                  <option value="中3">中3</option>
                </select>
              </div>

              {/* 名前検索 */}
              <div className="relative group">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-indigo-500 transition-colors"/>
                <input 
                  type="text" 
                  placeholder="名前で検索..." 
                  className="pl-9 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold text-gray-600 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-50 transition-all w-48"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left border-collapse">
              <thead className="text-[10px] text-gray-400 uppercase bg-gray-50/80 tracking-wider">
                <tr>
                  <th className="px-6 py-3 rounded-l-xl font-black">名前</th>
                  <th className="px-6 py-3 font-black">学年</th>
                  <th className="px-6 py-3 font-black">累計ログイン回数</th>
                  <th className="px-6 py-3 font-black">最終ログイン</th>
                  <th className="px-6 py-3 rounded-r-xl font-black text-center">ステータス</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredStudents.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center py-12 text-gray-400 font-bold text-xs">該当する生徒はいません</td>
                  </tr>
                ) : (
                  filteredStudents.map((student) => (
                    <tr key={student.id} className="hover:bg-gray-50 transition-colors group">
                      <td className="px-6 py-4 font-bold text-gray-700">{student.name}</td>
                      <td className="px-6 py-4">
                        <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black ${
                          student.grade === '中3' ? 'bg-purple-50 text-purple-600' :
                          student.grade === '中2' ? 'bg-blue-50 text-blue-600' :
                          'bg-green-50 text-green-600'
                        }`}>
                          {student.grade}
                        </span>
                      </td>
                      <td className="px-6 py-4 font-mono text-indigo-600 font-black text-base">{student.login_count}<span className="text-[10px] ml-1 text-gray-400 font-bold">回</span></td>
                      <td className="px-6 py-4 text-gray-500 text-xs font-bold">
                        {student.last_login} 
                        <span className="text-[10px] text-gray-300 ml-2 group-hover:text-gray-400 transition-colors">({student.days_since}日前)</span>
                      </td>
                      <td className="px-6 py-4 text-center">
                        {student.status === 'active' && (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-green-100 text-green-600 text-[10px] font-black shadow-sm border border-green-200">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span> Active
                          </span>
                        )}
                        {student.status === 'warning' && (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-yellow-100 text-yellow-600 text-[10px] font-black border border-yellow-200">
                            Warning
                          </span>
                        )}
                        {student.status === 'inactive' && (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-gray-100 text-gray-400 text-[10px] font-black border border-gray-200">
                            Inactive
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-4 text-[10px] font-bold text-gray-400 text-right">
            全 {filteredStudents.length} 名を表示中
          </div>
        </div>

      </div>
    </div>
  );
}
