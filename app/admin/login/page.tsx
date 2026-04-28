'use client';

import { useState } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { Lock, Loader2, Wrench, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function AutoFixLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setStatus('🚀 1/3: 認証を開始します...');

    try {
      // 1. Firebase Auth認証
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;
      setStatus(`✅ 2/3: 認証成功! データベースを確認中...`); // ★ ここで止まるならFirestoreへの接続に問題あり

      // 2. Firestoreデータ確認
      let userDoc;
      try {
        const userDocRef = doc(db, 'users', user.uid);
        userDoc = await getDoc(userDocRef);
      } catch (dbError: any) {
        throw new Error(`Firestore読込エラー: ${dbError.message}`);
      }
      
      if (!userDoc.exists()) {
        setStatus('⚠️ データ欠落。自動修復中...');
        try {
          const userDocRef = doc(db, 'users', user.uid);
          await setDoc(userDocRef, {
            uid: user.uid,
            name: '管理者(自動修復)',
            email: user.email,
            role: 'master',
            created_at: new Date().toISOString()
          });
        } catch (dbWriteError: any) {
          throw new Error(`Firestore書込エラー: ${dbWriteError.message}`);
        }
        
        setStatus('✨ 3/3: 修復完了！画面を移動します...');
        router.push('/master');
        // ★ ルーターがフリーズした場合の強制移動（フェイルセーフ）
        setTimeout(() => { window.location.href = '/master'; }, 1500); 
        return;
      }

      const userData = userDoc.data();
      setStatus(`✅ 3/3: 権限確認OK (${userData?.role})。画面を移動します...`);

      const role = String(userData?.role || '').toLowerCase();
      if (role === 'master' || ['admin', 'school_admin', 'branch_admin', 'campus_admin', 'classroom_admin'].includes(role)) {
        router.push('/master');
        // ★ ルーターがフリーズした場合の強制移動（フェイルセーフ）
        setTimeout(() => { window.location.href = '/master'; }, 1500);
      } else {
        alert('ここは管理者専用です。生徒・講師画面へ移動します。');
        router.push('/');
        setTimeout(() => { window.location.href = '/'; }, 1500);
      }

    } catch (error: any) {
      console.error('Login Error:', error);
      
      if (error.code === 'auth/invalid-credential') {
        setStatus('❌ メールまたはパスワードが違います');
      } else {
        setStatus(`❌ エラー: ${error.message || '不明なエラーが発生しました'}`);
      }
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 px-4">
      <div className="bg-white w-full max-w-md p-8 rounded-2xl shadow-lg border-t-4 border-blue-600">
        <div className="text-center mb-8">
          <div className="bg-blue-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
            <Lock className="text-blue-600" size={32} />
          </div>
          <h1 className="text-2xl font-bold text-gray-800">システム管理者</h1>
          <p className="text-xs text-blue-600 font-bold mt-2 bg-blue-50 py-1 px-2 rounded inline-block">
            <Wrench className="inline w-3 h-3 mr-1"/>
            Master Login
          </p>
        </div>

        <form onSubmit={handleLogin} className="space-y-6">
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-2">メールアドレス</label>
            <input 
              type="email" 
              required
              className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-2">パスワード</label>
            <input 
              type="password" 
              required
              className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <div className={`p-3 rounded-lg text-sm font-bold text-center break-words ${
            status.includes('❌') ? 'bg-red-100 text-red-700' :
            status.includes('✨') || status.includes('3/3') ? 'bg-green-100 text-green-700' :
            status.includes('🚀') || status.includes('⚠️') || status.includes('2/3') ? 'bg-yellow-50 text-yellow-700' :
            'bg-gray-50 text-gray-500'
          }`}>
            {status || '管理者情報を入力してください'}
          </div>

          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-blue-600 text-white font-bold py-3 rounded-xl hover:bg-blue-700 transition-colors shadow-lg shadow-blue-200 flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {loading ? <Loader2 className="animate-spin" /> : 'ログイン'}
          </button>
        </form>

        <div className="mt-6 text-center pt-6 border-t border-gray-100">
          <Link href="/" className="text-sm text-gray-400 hover:text-gray-600 flex items-center justify-center gap-1 font-bold">
            <ArrowLeft size={16}/> 生徒・講師ログインへ戻る
          </Link>
        </div>
      </div>
    </div>
  );
}
