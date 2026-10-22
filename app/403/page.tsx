import Link from 'next/link';
import { ShieldAlert } from 'lucide-react';

export default function AccessDenied() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-4">
      <div className="bg-white p-8 rounded-2xl shadow-lg text-center max-w-md w-full border border-slate-100">
        <div className="bg-red-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
          <ShieldAlert size={32} className="text-red-500" />
        </div>
        <h1 className="text-xl font-bold text-slate-800 mb-2">アクセスできません</h1>
        <p className="text-sm text-slate-500 mb-6">
          先生・管理者ページへのアクセスは、<br/>
          許可されたネットワーク（教室・オフィス等）<br/>
          からのみ可能です。
        </p>
        <Link 
          href="/" 
          className="block w-full bg-slate-900 text-white font-bold py-3 rounded-xl hover:bg-slate-800 transition-colors"
        >
          トップページへ戻る
        </Link>
      </div>
    </div>
  );
}