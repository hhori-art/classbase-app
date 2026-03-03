'use client';

import { useState } from 'react';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut
} from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
  setDoc,
  deleteDoc
} from 'firebase/firestore';
import { LogIn, Loader2, User, AlertCircle, Eye, EyeOff, Lock } from 'lucide-react';
import Link from 'next/link';

export default function LoginPage() {
  const [loginInput, setLoginInput] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
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

    const isId = !input.includes('@');
    const email = isId ? `${input}@sozogakuen.co.jp` : input;

    try {
      // 1) 通常ログイン
      try {
        await signInWithEmailAndPassword(auth, email, password);
        // ✅ 遷移はしない：AuthProviderが onAuthStateChanged で role を見て正しい画面へ送る
        setLoading(false);
        return;
      } catch (signInError: any) {
        // 2) 初回ログイン（ユーザー作成＋移行）※本来はサーバー側に寄せる推奨
        if (
          signInError?.code === 'auth/user-not-found' ||
          signInError?.code === 'auth/invalid-credential'
        ) {
          await handleFirstTimeLogin(input, email, password, isId);
          setLoading(false);
          return;
        }
        throw signInError;
      }
    } catch (e: any) {
      console.error('Login Error:', e);

      let message = 'ログイン中にエラーが発生しました。';
      if (e.code === 'auth/wrong-password') {
        message = 'パスワードが間違っています。入力内容をご確認ください。';
      } else if (e.code === 'auth/too-many-requests') {
        message =
          'ログインの試行回数が多すぎます。しばらく時間を空けてから再度お試しください。';
      } else if (e.code === 'auth/invalid-email') {
        message = 'メールアドレス（ID）の形式が正しくありません。';
      } else if (e.code === 'auth/user-disabled') {
        message = 'このアカウントは無効化されています。管理者にお問い合わせください。';
      } else if (e.code === 'auth/network-request-failed') {
        message = 'ネットワークエラーが発生しました。通信環境をご確認ください。';
      } else if (e.message?.includes('登録データが見つかりません')) {
        message =
          '指定されたIDはシステムに登録されていません。\nIDにお間違いがないか確認し、解決しない場合は管理者へご連絡ください。';
      } else if (e.message === 'パスワードが間違っています。') {
        message = '初回パスワードが間違っています。配布された資料をご確認ください。';
      } else if (e?.code === 'unavailable') {
        message =
          'データベース接続が一時的に不安定です。少し待ってから再度お試しください。';
      }

      setErrorMsg(message);
      setLoading(false);
    }
  };

  // ✅ 暫定：初回ログイン処理（本来はAPI/Functionsへ移すのが正解）
  const handleFirstTimeLogin = async (idOrEmail: string, email: string, pass: string, isId: boolean) => {
    let q = query(collection(db, 'users'), where('lifetime_id', '==', idOrEmail));
    let snap = await getDocs(q);

    // あなたの元コードにあった「数値検索」は実処理が無いので省略（必要なら追加）

    if (snap.empty) {
      throw new Error('登録データが見つかりません。');
    }

    const userData = snap.docs[0].data();
    const oldDocRef = snap.docs[0].ref;

    if (userData.initial_password && userData.initial_password !== pass) {
      throw new Error('パスワードが間違っています。');
    }

    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    const newUid = cred.user.uid;

    await setDoc(doc(db, 'users', newUid), {
      ...userData,
      uid: newUid,
      email,
      migrated_at: new Date().toISOString(),
    });

    await deleteDoc(oldDocRef);

    // ✅ 遷移はしない。AuthProviderが拾って正しい画面に送る
    // ただし user doc が存在するかだけ軽く確認
    const createdDoc = await getDoc(doc(db, 'users', newUid));
    if (!createdDoc.exists()) {
      await signOut(auth);
      throw new Error('ユーザーデータの紐付けに失敗しました。');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-blue-50 px-4 font-sans text-slate-600">
      <div className="bg-white/80 backdrop-blur-sm w-full max-w-md p-8 md:p-10 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-white/50">
        <div className="text-center mb-10">
          <div className="relative w-24 h-24 mx-auto mb-6 shadow-xl rounded-2xl overflow-hidden transform -rotate-3 bg-white p-2 flex items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon.png" alt="理社講座ロゴ" className="w-full h-full object-contain" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight">理社講座 ログイン</h1>
          <p className="text-slate-500 text-sm mt-2 font-medium">学ぶ、つながる、未来を創る</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-6">
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider ml-1">
              ID (生涯番号)
            </label>
            <div className="relative group">
              <User className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-indigo-500" size={20} />
              <input
                type="text"
                required
                className="w-full pl-12 pr-4 py-3.5 bg-slate-50 border-2 border-transparent rounded-2xl focus:bg-white focus:border-indigo-100 focus:ring-4 focus:ring-indigo-50/50 outline-none transition-all font-mono text-lg text-slate-700 placeholder:text-slate-300"
                placeholder="12345678"
                value={loginInput}
                onChange={e => setLoginInput(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider ml-1">
              パスワード
            </label>
            <div className="relative group">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-indigo-500" size={20} />
              <input
                type={showPassword ? 'text' : 'password'}
                required
                className="w-full pl-12 pr-12 py-3.5 bg-slate-50 border-2 border-transparent rounded-2xl focus:bg-white focus:border-indigo-100 focus:ring-4 focus:ring-indigo-50/50 outline-none transition-all text-lg text-slate-700 placeholder:text-slate-300"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 transition-colors"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
          </div>

          {errorMsg && (
            <div className="bg-red-50 text-red-600 text-sm p-4 rounded-2xl font-bold border border-red-100 flex items-start gap-3 animate-in fade-in slide-in-from-top-2 duration-300 shadow-sm">
              <AlertCircle size={20} className="shrink-0 mt-0.5" />
              <div className="whitespace-pre-wrap leading-relaxed">{errorMsg}</div>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-slate-900 text-white font-bold py-4 rounded-2xl hover:bg-slate-800 active:scale-[0.98] transition-all shadow-xl shadow-slate-200 flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed mt-4"
          >
            {loading ? <Loader2 className="animate-spin" /> : (<><LogIn size={20} /> ログイン</>)}
          </button>
        </form>

        <div className="mt-10 text-center border-t border-slate-100 pt-6">
          <Link href="/admin/login" className="group inline-flex items-center gap-2 text-xs font-bold text-slate-400 hover:text-indigo-600 transition-colors px-4 py-2 rounded-full hover:bg-indigo-50">
            <User size={14} className="group-hover:scale-110 transition-transform" />
            管理者ログイン (Master)
            <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />
          </Link>
        </div>
      </div>
    </div>
  );
}

function ArrowRight(props: any) {
  // lucideのArrowRightを省略してる場合用（すでにimportしているならこの関数は消してOK）
  return <span {...props} />;
}