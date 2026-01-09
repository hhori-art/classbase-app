'use client';

import { useState } from 'react';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { doc, getDoc, collection, query, where, getDocs, setDoc, deleteDoc } from 'firebase/firestore';
import { LogIn, Loader2, GraduationCap, ArrowRight, User, AlertCircle } from 'lucide-react';
import Link from 'next/link';

export default function LoginPage() {
  const [loginInput, setLoginInput] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');

    const input = loginInput.trim();
    if (!input) {
      setErrorMsg('IDを入力してください');
      setLoading(false);
      return;
    }

    // ID入力かEmail入力かを判定
    const isId = !input.includes('@');
    const email = isId ? `${input}@sozogakuen.co.jp` : input;

    console.log(`Login attempt: ${email}`); // デバッグログ

    try {
      // 1. 通常ログイン試行 (Authにユーザーがいる場合)
      try {
        const cred = await signInWithEmailAndPassword(auth, email, password);
        console.log('Auth login success:', cred.user.uid);
        
        // 紐付けチェック & ロール確認
        await checkUserRole(cred.user.uid, input);
        
      } catch (signInError: any) {
        console.log('Auth login failed:', signInError.code);

        // 2. Authにユーザーがいない場合 -> 初回登録プロセスへ
        if (signInError.code === 'auth/user-not-found' || signInError.code === 'auth/invalid-credential') {
          await handleFirstTimeLogin(input, email, password, isId);
        } else {
          // パスワード間違いなどはここでスロー
          throw signInError;
        }
      }
    } catch (e: any) {
      console.error('Login Error Final:', e);
      
      if (e.message?.includes('登録データが見つかりません')) {
        setErrorMsg('指定されたIDは登録されていません。\n管理者へ連絡し、ID登録を確認してください。');
      } else if (e.code === 'auth/wrong-password' || e.message?.includes('パスワード')) {
        setErrorMsg('パスワードが間違っています。');
      } else if (e.message?.includes('ユーザーデータが見つかりません')) {
        setErrorMsg('ユーザーデータの紐付けに失敗しました。\n管理者に「データの再登録」を依頼してください。');
      } else {
        setErrorMsg(`ログインエラー: ${e.message}`);
      }
      setLoading(false);
    }
  };

  // 初回ログイン処理（Authアカウント作成 + データ紐付け）
  const handleFirstTimeLogin = async (idOrEmail: string, email: string, pass: string, isId: boolean) => {
    console.log('Starting first time login process for:', idOrEmail);
    
    // 文字列として検索
    let q = query(collection(db, 'users'), where('lifetime_id', '==', idOrEmail));
    let snap = await getDocs(q);

    // 見つからない場合、数値型で保存されている可能性も考慮して念のため検索（CSVインポートの仕様による）
    if (snap.empty && isId && !isNaN(Number(idOrEmail))) {
      console.log('Trying number search...');
      // Note: Firestoreで数値と文字列は区別されるため、データ側が数値で入っている場合に備える
      // ただし where('lifetime_id', '==', Number(idOrEmail)) は型エラーになる可能性があるため
      // 基本は文字列運用を推奨。ここは念の為のロジック。
    }

    if (snap.empty) {
      console.error('User data not found in Firestore for:', idOrEmail);
      throw new Error('登録データが見つかりません。');
    }

    const userData = snap.docs[0].data();
    const oldDocRef = snap.docs[0].ref;

    // 初回パスワードチェック
    if (userData.initial_password && userData.initial_password !== pass) {
      throw new Error('パスワードが間違っています。');
    }

    // Authアカウント作成
    console.log('Creating Auth user...');
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    const newUid = cred.user.uid;

    // データ移行 (古いランダムIDのドキュメントを削除し、Auth UIDで再作成)
    console.log('Migrating Firestore data to new UID:', newUid);
    
    // 新しいドキュメントを作成
    await setDoc(doc(db, 'users', newUid), {
      ...userData,
      uid: newUid,
      email: email, 
      migrated_at: new Date().toISOString() 
    });
    
    // 古いドキュメントを削除
    await deleteDoc(oldDocRef);
    
    console.log('Migration complete. Checking role...');
    // 画面遷移
    await checkUserRole(newUid, idOrEmail);
  };

  // ロール確認 & データの自動復旧ロジック
  const checkUserRole = async (uid: string, lifetimeId: string) => {
    console.log('Checking role for UID:', uid);
    
    const userDocRef = doc(db, 'users', uid);
    const userDoc = await getDoc(userDocRef);
    
    if (userDoc.exists()) {
      // 正常系: UIDと紐付いたデータが存在する
      const role = userDoc.data().role;
      console.log('Role found:', role);
      redirectByRole(role);
    } else {
      // 異常系: Authには入れたが、FirestoreのUIDドキュメントがない
      // → CSVインポート時の古いIDでデータが残っていないか検索して救済する
      console.warn("UID document missing. Attempting recovery with lifetimeId:", lifetimeId);
      
      const q = query(collection(db, 'users'), where('lifetime_id', '==', lifetimeId));
      const legacySnap = await getDocs(q);

      if (!legacySnap.empty) {
        console.log('Legacy data found. Recovering...');
        // データが見つかった！ → 紐付けを修正してログインさせる
        const oldDoc = legacySnap.docs[0];
        const userData = oldDoc.data();

        // データを正しいUIDの場所にコピー
        await setDoc(userDocRef, {
          ...userData,
          uid: uid,
          migrated_at: new Date().toISOString() // 復旧フラグ
        });

        // 古いデータを削除
        await deleteDoc(oldDoc.ref);

        console.log('Recovery complete. Redirecting...');
        // ログイン続行
        redirectByRole(userData.role);
      } else {
        // 本当にデータがない
        console.error('Fatal: No user data found even with lifetimeId.');
        await signOut(auth);
        throw new Error('ユーザーデータが見つかりません');
      }
    }
  };

  const redirectByRole = (role: string) => {
    if (role === 'teacher') window.location.href = '/teacher';
    else if (role === 'master') window.location.href = '/master';
    else window.location.href = '/student';
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-50 px-4">
      <div className="bg-white w-full max-w-md p-8 rounded-2xl shadow-xl border border-gray-100">
        <div className="text-center mb-8">
          <div className="bg-indigo-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
            <GraduationCap className="text-indigo-600" size={32} />
          </div>
          <h1 className="text-2xl font-bold text-gray-800">ログイン</h1>
          <p className="text-gray-500 text-sm mt-2">ID (生涯番号) を入力してください</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-6">
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-2">ログインID</label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
              <input 
                type="text" required
                className="w-full pl-10 pr-3 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-mono text-lg"
                placeholder="12345678"
                value={loginInput} onChange={e => setLoginInput(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-2">パスワード</label>
            <input 
              type="password" required
              className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
              placeholder="••••••••"
              value={password} onChange={e => setPassword(e.target.value)}
            />
          </div>

          {errorMsg && (
            <div className="bg-red-50 text-red-600 text-sm p-4 rounded-lg font-bold border border-red-100 flex items-start gap-2 whitespace-pre-wrap">
              <AlertCircle size={18} className="shrink-0 mt-0.5" />
              <div>{errorMsg}</div>
            </div>
          )}
          
          <button type="submit" disabled={loading} className="w-full bg-indigo-600 text-white font-bold py-3 rounded-xl hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-200 flex items-center justify-center gap-2 disabled:opacity-70">
            {loading ? <Loader2 className="animate-spin" /> : <><LogIn size={20}/> ログイン</>}
          </button>
        </form>

        <div className="mt-8 text-center border-t pt-6">
          <Link href="/admin/login" className="text-sm text-gray-400 hover:text-gray-600 font-bold flex items-center justify-center gap-1 transition-colors">
            管理者(Master)はこちら <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    </div>
  );
}
