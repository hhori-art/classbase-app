'use client';

import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, setDoc, deleteDoc, query, orderBy, writeBatch } from 'firebase/firestore';
import { Users, Search, Plus, Edit, Trash2, ArrowLeft, GraduationCap, UserCheck, Save, X, Loader2, FileUp, AlertTriangle, Shield, Mail } from 'lucide-react';
import Link from 'next/link';

// ユーザー型定義
interface UserData {
  id: string; // Firestore Doc ID
  uid?: string;
  role: 'student' | 'teacher' | 'master';
  student_name?: string; 
  name?: string;         
  lifetime_id: string;   // ログインID
  email?: string;        // ★追加: 既存データ対応（メールアドレス）
  grade?: string;
  classroom?: string;
  subject_science?: string;
  subject_social?: string;
  day_of_week?: string;
  initial_password?: string;
  created_at?: string;
}

export default function UserManagementPage() {
  const [users, setUsers] = useState<UserData[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<UserData[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [activeTab, setActiveTab] = useState<'student' | 'teacher' | 'master'>('student');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserData | null>(null);
  
  const [formData, setFormData] = useState<Partial<UserData> & { displayName: string }>({
    role: 'student',
    displayName: '',
    lifetime_id: '',
    initial_password: 'class1234',
    grade: '',
    classroom: '',
    subject_science: '',
    subject_social: '',
    day_of_week: ''
  });

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
    let result = users.filter(u => u.role === activeTab);
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
    setSelectedIds(new Set());
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

        if (idxName === -1 || idxID === -1) throw new Error('CSVヘッダーに「氏名」「ID」が必要です');

        const batch = writeBatch(db);
        let count = 0;

        // ID重複チェック用マップ (lifetime_id または email)
        const existingUserMap = new Map(users.map(u => [u.lifetime_id || u.email, u.id]));

        for (let i = 1; i < rows.length; i++) {
          const cols = rows[i].split(',');
          if (cols.length < 2) continue;

          const name = cols[idxName]?.trim();
          const loginId = cols[idxID]?.trim();
          const pass = idxPass !== -1 ? cols[idxPass]?.trim() : 'class1234';
          const valScience = idxScience !== -1 ? cols[idxScience]?.trim() : null;
          const valSocial = idxSocial !== -1 ? cols[idxSocial]?.trim() : null;

          if (!name || !loginId) continue;

          // 既存IDがあれば更新、なければ新規ID発行
          const docId = existingUserMap.get(loginId) || doc(collection(db, 'users')).id;
          const docRef = doc(db, 'users', docId);

          const isStudent = activeTab === 'student';
          
          const data: any = {
            role: activeTab,
            lifetime_id: loginId, // ここにID（メールアドレス）を保存
            initial_password: pass,
            uid: docId,
            updated_at: new Date().toISOString()
          };

          if (isStudent) {
            data.student_name = name;
            data.name = null;
            if (valScience) data.subject_science = valScience;
            if (valSocial) data.subject_social = valSocial;
          } else {
            data.name = name;
            data.student_name = null;
          }

          if (!existingUserMap.has(loginId)) {
            data.created_at = new Date().toISOString();
          }

          batch.set(docRef, data, { merge: true });
          count++;
        }

        await batch.commit();
        alert(`${count} 件のユーザーをインポート/更新しました`);
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
      const docId = editingUser ? editingUser.id : doc(collection(db, 'users')).id;
      const docRef = doc(db, 'users', docId);

      const saveData: any = {
        role: formData.role,
        lifetime_id: formData.lifetime_id,
        initial_password: formData.initial_password,
        updated_at: new Date().toISOString()
      };

      if (formData.role === 'student') {
        saveData.student_name = formData.displayName;
        saveData.name = null;
        saveData.grade = formData.grade;
        saveData.classroom = formData.classroom;
        saveData.subject_science = formData.subject_science;
        saveData.subject_social = formData.subject_social;
        saveData.day_of_week = formData.day_of_week;
      } else {
        saveData.name = formData.displayName;
        saveData.student_name = null;
        saveData.grade = null;
        saveData.classroom = null;
        saveData.subject_science = null;
        saveData.subject_social = null;
        saveData.day_of_week = null;
      }
      
      if (!editingUser) {
        saveData.created_at = new Date().toISOString();
        saveData.uid = docId; 
      }

      await setDoc(docRef, saveData, { merge: true });
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
        lifetime_id: user.lifetime_id || user.email || '', // emailも考慮してセット
        subject_science: user.subject_science || '',
        subject_social: user.subject_social || ''
      });
    } else {
      setEditingUser(null);
      setFormData({ 
        role: activeTab,
        displayName: '', 
        lifetime_id: '', 
        initial_password: 'class1234', 
        grade: activeTab === 'student' ? '中1' : '', 
        classroom: '', 
        subject_science: '',
        subject_social: '',
        day_of_week: '' 
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

  return (
    <div className="min-h-screen bg-gray-50 p-6 pb-20">
      <div className="max-w-6xl mx-auto">
        
        {/* ヘッダー */}
        <div className="flex flex-col md:flex-row items-center justify-between mb-8 gap-4">
          <div className="flex items-center gap-4 w-full md:w-auto">
            <Link href="/master" className="bg-white p-2 rounded-full shadow hover:bg-gray-100 text-gray-600 transition-colors">
              <ArrowLeft size={20} />
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
                <Users className="text-blue-600" /> ユーザー管理
              </h1>
              <p className="text-xs text-gray-500">生徒・講師・管理者のID発行と編集</p>
            </div>
          </div>

          <div className="flex gap-2 w-full md:w-auto items-center">
             <div className="relative">
               <input type="file" accept=".csv" onChange={handleCSVImport} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" disabled={isImporting}/>
               <button disabled={isImporting} className="bg-green-600 text-white px-4 py-2 rounded-full font-bold hover:bg-green-700 shadow flex items-center gap-2 text-sm whitespace-nowrap">
                 {isImporting ? <Loader2 className="animate-spin" size={16}/> : <FileUp size={16}/>} CSV一括登録
               </button>
             </div>

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
             <button 
               onClick={() => handleOpenModal()} 
               className="bg-blue-600 text-white px-4 py-2 rounded-full font-bold hover:bg-blue-700 shadow flex items-center gap-2 whitespace-nowrap"
             >
               <Plus size={18}/> 新規
             </button>
          </div>
        </div>

        {/* タブ切り替え */}
        <div className="flex flex-col sm:flex-row justify-between items-end sm:items-center mb-4 gap-4 border-b border-gray-200 pb-2">
          <div className="flex gap-2">
            <button onClick={() => setActiveTab('student')} className={`px-6 py-3 font-bold text-sm flex items-center gap-2 border-b-2 -mb-2.5 transition-colors ${activeTab === 'student' ? 'border-blue-600 text-blue-600 bg-blue-50/50' : 'border-transparent text-gray-500'}`}>
              <GraduationCap size={18}/> 生徒 ({users.filter(u => u.role === 'student').length})
            </button>
            <button onClick={() => setActiveTab('teacher')} className={`px-6 py-3 font-bold text-sm flex items-center gap-2 border-b-2 -mb-2.5 transition-colors ${activeTab === 'teacher' ? 'border-purple-600 text-purple-600 bg-purple-50/50' : 'border-transparent text-gray-500'}`}>
              <UserCheck size={18}/> 講師 ({users.filter(u => u.role === 'teacher').length})
            </button>
            <button onClick={() => setActiveTab('master')} className={`px-6 py-3 font-bold text-sm flex items-center gap-2 border-b-2 -mb-2.5 transition-colors ${activeTab === 'master' ? 'border-gray-800 text-gray-800 bg-gray-100' : 'border-transparent text-gray-500'}`}>
              <Shield size={18}/> 管理者 ({users.filter(u => u.role === 'master').length})
            </button>
          </div>
          
          <div className="flex gap-2">
            <button onClick={handleDeduplicate} className="text-orange-600 hover:bg-orange-50 px-3 py-1 rounded text-xs font-bold flex items-center gap-1 border border-orange-200">
              <AlertTriangle size={14}/> 重複チェック・削除
            </button>
            {selectedIds.size > 0 && (
              <button onClick={handleBulkDelete} disabled={isBulkDeleting} className="bg-red-50 text-red-600 border border-red-200 px-4 py-1 rounded-full font-bold text-sm hover:bg-red-100 flex items-center gap-2">
                {isBulkDeleting ? <Loader2 className="animate-spin" size={16}/> : <Trash2 size={16}/>} {selectedIds.size}件削除
              </button>
            )}
          </div>
        </div>

        {/* リスト表示 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          {loading ? (
            <div className="p-20 flex justify-center"><Loader2 className="animate-spin text-gray-400"/></div>
          ) : filteredUsers.length === 0 ? (
            <div className="p-10 text-center text-gray-400">データが見つかりません</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-gray-50 text-gray-600 font-bold border-b border-gray-200">
                  <tr>
                    <th className="p-4 w-10"><input type="checkbox" className="w-4 h-4" onChange={(e) => handleSelectAll(e.target.checked)} checked={filteredUsers.length > 0 && selectedIds.size === filteredUsers.length}/></th>
                    <th className="p-4 w-40">氏名</th>
                    <th className="p-4 w-64">ログインID</th>
                    <th className="p-4">パスワード</th>
                    
                    {activeTab === 'student' && (
                      <>
                        <th className="p-4">学年</th>
                        <th className="p-4">教室</th>
                        <th className="p-4">理科</th>
                        <th className="p-4">社会</th>
                      </>
                    )}
                    
                    <th className="p-4 text-center">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredUsers.map((user) => (
                    <tr key={user.id} className={`hover:bg-gray-50 transition-colors ${selectedIds.has(user.id) ? 'bg-blue-50/30' : ''}`}>
                      <td className="p-4"><input type="checkbox" className="w-4 h-4 cursor-pointer" checked={selectedIds.has(user.id)} onChange={(e) => handleSelectOne(user.id, e.target.checked)}/></td>
                      
                      <td className="p-4 font-bold text-gray-800 flex items-center gap-2">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold ${
                          user.role === 'student' ? 'bg-blue-400' : 
                          user.role === 'teacher' ? 'bg-purple-400' : 'bg-gray-700'
                        }`}>
                          {(user.student_name || user.name || '?')[0]}
                        </div>
                        <span className="truncate max-w-[120px]">{user.student_name || user.name || <span className="text-gray-400">未設定</span>}</span>
                      </td>

                      {/* ★修正: lifetime_id が無ければ email を表示するフォールバック追加 */}
                      <td className="p-4 font-mono text-gray-700 font-medium break-all">
                        {user.lifetime_id || user.email || <span className="text-gray-300">-</span>}
                      </td>

                      <td className="p-4 text-gray-400 text-xs font-mono">{user.initial_password || '********'}</td>
                      
                      {activeTab === 'student' && (
                        <>
                          <td className="p-4"><span className="px-2 py-1 rounded bg-gray-100 text-xs font-bold text-gray-600">{user.grade || '-'}</span></td>
                          <td className="p-4 text-gray-600">{user.classroom || '-'}</td>
                          <td className="p-4 text-gray-600 font-bold">{user.subject_science || '-'}</td>
                          <td className="p-4 text-gray-600 font-bold">{user.subject_social || '-'}</td>
                        </>
                      )}
                      
                      <td className="p-4 flex justify-center gap-2">
                        <button onClick={() => handleOpenModal(user)} className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"><Edit size={16}/></button>
                        <button onClick={() => handleDelete(user.id)} className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"><Trash2 size={16}/></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* モーダル */}
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
                <input className="w-full p-2 border rounded mt-1 font-mono bg-gray-50" value={formData.initial_password} onChange={e => setFormData({...formData, initial_password: e.target.value})}/>
              </div>
              
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
    </div>
  );
}