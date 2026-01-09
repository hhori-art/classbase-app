'use client';

import { useState } from 'react';
import { createUserWithEmailAndPassword } from 'firebase/auth'; // ユーザー作成機能
import { auth, db } from '@/lib/firebase';
import { doc, setDoc } from 'firebase/firestore'; // データ保存機能

export default function TempRegisterPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('master'); // デフォルトはマスター
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMsg('');

    try {
      // 1. Authenticationにログイン情報を登録
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      // 2. Firestoreにユーザー詳細情報を保存
      // usersコレクションの、ユーザーIDと同じ名前のドキュメントを作る
      await setDoc(doc(db, 'users', user.uid), {
        uid: user.uid,
        name: name,
        email: email,
        role: role,
        created_at: new Date()
      });

      setMsg(`成功！登録しました: ${email} (${role})`);
      // フォームリセット
      setEmail('');
      setPassword('');
      setName('');
    } catch (error: any) {
      console.error(error);
      setMsg(`エラー: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-md mx-auto bg-white p-6 rounded-xl shadow">
        <h1 className="text-xl font-bold mb-4">【開発用】ユーザー登録ツール</h1>
        
        <form onSubmit={handleRegister} className="space-y-4">
          <div>
            <label className="block text-sm font-bold">メールアドレス</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required className="w-full p-2 border rounded" />
          </div>
          <div>
            <label className="block text-sm font-bold">パスワード (6文字以上)</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required className="w-full p-2 border rounded" />
          </div>
          <div>
            <label className="block text-sm font-bold">氏名</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} required className="w-full p-2 border rounded" />
          </div>
          <div>
            <label className="block text-sm font-bold">権限 (ロール)</label>
            <select value={role} onChange={e => setRole(e.target.value)} className="w-full p-2 border rounded">
              <option value="master">マスター (管理者)</option>
              <option value="teacher">先生</option>
              <option value="student">生徒</option>
            </select>
          </div>

          <button type="submit" disabled={loading} className="w-full bg-green-600 text-white font-bold py-2 rounded hover:bg-green-700">
            {loading ? '処理中...' : '登録する'}
          </button>
        </form>

        {msg && <div className="mt-4 p-3 bg-yellow-50 text-red-600 rounded">{msg}</div>}
      </div>
    </div>
  );
}