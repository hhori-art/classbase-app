'use client';

import { useState, useEffect, useMemo } from 'react';
import { db } from '@/lib/firebase';
import { collection, query, orderBy, limit, getDocs, where } from 'firebase/firestore';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell
} from 'recharts';
import { 
  Users, Activity, Clock, Calendar, ArrowLeft, TrendingUp, Search, Download, Filter, PieChart as PieIcon 
} from 'lucide-react';
import Link from 'next/link';

export default function StatisticsPage() {
  const [dailyStats, setDailyStats] = useState<any[]>([]);
  const [allStudents, setAllStudents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  // フィルタ・検索用
  const [searchQuery, setSearchQuery] = useState('');
  const [gradeFilter, setGradeFilter] = useState('all');

  useEffect(() => {
    const fetchData = async () => {
      try {
        const today = new Date().toISOString().split('T')[0];

        // 1. 日別アクセス推移 (過去14日間)
        const statsQuery = query(collection(db, 'system_stats'), orderBy('date', 'desc'), limit(14));
        const statsSnap = await getDocs(statsQuery);
        const statsData = statsSnap.docs.map(d => ({
          date: d.data().date.slice(5), // MM-DD
          users: d.data().active_uids?.length || 0,
          access: d.data().total_access || 0
        })).reverse();
        setDailyStats(statsData);

        // 2. 全生徒データの取得 (詳細分析用)
        const usersQuery = query(collection(db, 'users'), where('role', '==', 'student'));
        const usersSnap = await getDocs(usersQuery);
        
        const studentsData = usersSnap.docs.map(d => {
          const data = d.data();
          const lastLoginDate = data.last_login_at?.toDate ? data.last_login_at.toDate() : null;
          
          // 最終ログインからの経過日数
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

        // ログイン回数順にソート
        studentsData.sort((a, b) => b.login_count - a.login_count);
        setAllStudents(studentsData);

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

  // 学年別分布データの作成
  const gradeDistribution = useMemo(() => {
    const counts: {[key: string]: number} = {};
    allStudents.forEach(s => {
      const g = s.grade || '不明';
      counts[g] = (counts[g] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [allStudents]);

  // 今日のアクセス数
  const todayDAU = dailyStats.length > 0 ? dailyStats[dailyStats.length - 1].users : 0;
  
  // アクティブ率 (3日以内にログインした人 / 全生徒)
  const activeUserCount = allStudents.filter(s => s.status === 'active').length;
  const activeRate = allStudents.length > 0 ? Math.round((activeUserCount / allStudents.length) * 100) : 0;

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

  const COLORS = ['#6366F1', '#8B5CF6', '#EC4899', '#F59E0B', '#10B981'];

  return (
    <div className="min-h-screen bg-gray-50 p-6 font-sans">
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
          <button onClick={handleDownloadCSV} className="bg-green-600 text-white px-4 py-2 rounded-full font-bold text-sm flex items-center gap-2 hover:bg-green-700 transition-colors shadow-sm">
            <Download size={16}/> CSV出力
          </button>
        </div>

        {/* KPIカード */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-white p-6 rounded-3xl shadow-sm border border-indigo-50 flex items-center gap-4">
            <div className="p-4 bg-indigo-50 text-indigo-600 rounded-2xl"><Users size={28} /></div>
            <div>
              <p className="text-xs font-bold text-gray-400 uppercase">今日のDAU</p>
              <p className="text-2xl font-black text-gray-800">{todayDAU} <span className="text-sm font-medium text-gray-400">人</span></p>
            </div>
          </div>
          <div className="bg-white p-6 rounded-3xl shadow-sm border border-green-50 flex items-center gap-4">
            <div className="p-4 bg-green-50 text-green-600 rounded-2xl"><TrendingUp size={28} /></div>
            <div>
              <p className="text-xs font-bold text-gray-400 uppercase">アクティブ率</p>
              <p className="text-2xl font-black text-gray-800">{activeRate}<span className="text-sm font-medium text-gray-400">%</span></p>
            </div>
          </div>
          <div className="bg-white p-6 rounded-3xl shadow-sm border border-orange-50 flex items-center gap-4">
            <div className="p-4 bg-orange-50 text-orange-600 rounded-2xl"><Clock size={28} /></div>
            <div>
              <p className="text-xs font-bold text-gray-400 uppercase">TOP USER</p>
              <p className="text-lg font-black text-gray-800 line-clamp-1">{allStudents[0]?.name || '-'}</p>
            </div>
          </div>
          <div className="bg-white p-6 rounded-3xl shadow-sm border border-pink-50 flex items-center gap-4">
            <div className="p-4 bg-pink-50 text-pink-600 rounded-2xl"><Users size={28} /></div>
            <div>
              <p className="text-xs font-bold text-gray-400 uppercase">総生徒数</p>
              <p className="text-2xl font-black text-gray-800">{allStudents.length} <span className="text-sm font-medium text-gray-400">人</span></p>
            </div>
          </div>
        </div>

        {/* グラフエリア */}
        <div className="grid lg:grid-cols-3 gap-8 mb-8">
          {/* 左: アクセス推移 */}
          <div className="lg:col-span-2 bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
            <h2 className="text-lg font-bold text-gray-700 mb-6 flex items-center gap-2">
              <Calendar size={20} className="text-indigo-500"/> 週間アクセス推移 (14日間)
            </h2>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dailyStats}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F3F4F6"/>
                  <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{fill: '#9CA3AF', fontSize: 12, fontWeight: 'bold'}} dy={10}/>
                  <YAxis axisLine={false} tickLine={false} tick={{fill: '#9CA3AF', fontSize: 12}} />
                  <RechartsTooltip cursor={{fill: '#F9FAFB'}} contentStyle={{borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'}}/>
                  <Bar name="利用人数" dataKey="users" fill="#6366F1" radius={[4, 4, 0, 0]} barSize={20}/>
                  <Bar name="アクセス回数" dataKey="access" fill="#BFDBFE" radius={[4, 4, 0, 0]} barSize={20}/>
                  <Legend />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* 右: 学年分布 */}
          <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
            <h2 className="text-lg font-bold text-gray-700 mb-6 flex items-center gap-2">
              <PieIcon size={20} className="text-pink-500"/> 利用者の学年分布
            </h2>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={gradeDistribution}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {gradeDistribution.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <RechartsTooltip contentStyle={{borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'}}/>
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* 詳細データテーブル */}
        <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
            <h2 className="text-lg font-bold text-gray-700 flex items-center gap-2">
              <Activity size={20} className="text-orange-500"/> 全生徒の詳細データ
            </h2>
            
            <div className="flex gap-2">
              {/* 学年フィルタ */}
              <div className="relative">
                <Filter size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
                <select 
                  className="pl-8 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-full text-sm font-bold text-gray-600 outline-none focus:border-indigo-400"
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
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
                <input 
                  type="text" 
                  placeholder="名前検索..." 
                  className="pl-8 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-full text-sm font-bold text-gray-600 outline-none focus:border-indigo-400 w-48"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-gray-400 uppercase bg-gray-50/50">
                <tr>
                  <th className="px-4 py-3 rounded-l-xl">名前</th>
                  <th className="px-4 py-3">学年</th>
                  <th className="px-4 py-3">累計ログイン回数</th>
                  <th className="px-4 py-3">最終ログイン</th>
                  <th className="px-4 py-3 rounded-r-xl">ステータス</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredStudents.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center py-10 text-gray-400">該当する生徒はいません</td>
                  </tr>
                ) : (
                  filteredStudents.map((student) => (
                    <tr key={student.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-bold text-gray-700">{student.name}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded text-xs font-bold ${
                          student.grade === '中3' ? 'bg-purple-50 text-purple-600' :
                          student.grade === '中2' ? 'bg-blue-50 text-blue-600' :
                          'bg-green-50 text-green-600'
                        }`}>
                          {student.grade}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-indigo-600 font-bold">{student.login_count}回</td>
                      <td className="px-4 py-3 text-gray-500">
                        {student.last_login} 
                        <span className="text-xs text-gray-400 ml-2">({student.days_since}日前)</span>
                      </td>
                      <td className="px-4 py-3">
                        {student.status === 'active' && (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-green-100 text-green-600 text-xs font-bold">
                            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span> Active
                          </span>
                        )}
                        {student.status === 'warning' && (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-yellow-100 text-yellow-600 text-xs font-bold">
                            Warning
                          </span>
                        )}
                        {student.status === 'inactive' && (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-gray-100 text-gray-400 text-xs font-bold">
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
          <div className="mt-4 text-xs text-gray-400 text-right">
            全 {filteredStudents.length} 名を表示中
          </div>
        </div>

      </div>
    </div>
  );
}