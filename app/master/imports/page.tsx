'use client';

import Link from 'next/link';
import { ArrowLeft, Database, FileText, UserPlus, Calendar, AlertTriangle, Users, Presentation } from 'lucide-react';
import AccountImportButton from '@/app/components/AccountImportButton';
import PfImportButton from '@/app/components/PfImportButton';
import ShiftImportButton from '@/app/components/ShiftImportButton';

export default function ImportCenterPage() {
  return (
    <div className="min-h-screen bg-gray-50 p-8 pb-32 font-sans text-gray-800">
      <div className="max-w-5xl mx-auto">
        
        {/* ヘッダー */}
        <div className="flex items-center gap-4 mb-10">
          <Link href="/master" className="bg-white p-2 rounded-full shadow hover:bg-gray-100 text-gray-600 transition-colors">
            <ArrowLeft size={24} />
          </Link>
          <div>
            <h1 className="text-3xl font-bold text-gray-800 flex items-center gap-2">
              <Database className="text-teal-600" /> CSV一括インポートセンター
            </h1>
            <p className="text-gray-500 mt-1">各種マスターデータをCSVファイルから一括で登録・更新します。</p>
          </div>
        </div>

        {/* 注意書き */}
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 mb-8 flex items-start gap-3">
          <AlertTriangle className="text-yellow-600 shrink-0" size={20} />
          <div className="text-sm text-yellow-800">
            <p className="font-bold mb-1">データ制限について</p>
            <p>短時間に大量のデータをインポートすると、データベースの書き込み制限（Quota exceeded）にかかる場合があります。<br/>
            エラーが出た場合は、時間を置いてから再試行するか、ファイルを分割してください。</p>
          </div>
        </div>

        <div className="grid gap-8">
          
          {/* 1. 生徒アカウント */}
          <section className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="bg-green-50 p-5 border-b border-green-100 flex items-center gap-4">
              <div className="bg-white p-3 rounded-xl text-green-600 shadow-sm">
                <UserPlus size={28} />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-800">1. 生徒アカウント登録</h2>
                <p className="text-sm text-gray-500">生徒のログインアカウントを作成・更新します。</p>
              </div>
            </div>
            <div className="p-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="text-sm text-gray-600 space-y-1 flex-1">
                  <p><strong>必須項目:</strong> 氏名, ID(生涯番号), パスワード</p>
                  <p><strong>自動登録:</strong> 学年, 教室, 曜日も同時に設定されます。</p>
                  <p className="text-xs text-gray-400 mt-1">※ IDが一致する生徒は情報が上書きされます。</p>
                </div>
                <div className="shrink-0">
                  <AccountImportButton role="student" onSuccess={() => {}} />
                </div>
              </div>
            </div>
          </section>

          {/* 2. 講師アカウント */}
          <section className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="bg-purple-50 p-5 border-b border-purple-100 flex items-center gap-4">
              <div className="bg-white p-3 rounded-xl text-purple-600 shadow-sm">
                <Users size={28} />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-800">2. 講師アカウント登録</h2>
                <p className="text-sm text-gray-500">講師のログインアカウントを作成・更新します。</p>
              </div>
            </div>
            <div className="p-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="text-sm text-gray-600 space-y-2 flex-1">
                  <div>
                    <span className="font-bold text-gray-700">CSV形式:</span><br/>
                    <span className="font-mono text-xs bg-gray-100 px-2 py-1 rounded">校舎番号, 職員番号, 所属校, 契約書種別, 氏名</span>
                  </div>
                  <ul className="list-disc list-inside pl-1 space-y-0.5">
                    <li><strong>ログインID:</strong> 「職員番号」が使用されます。</li>
                    <li><strong>初期パスワード:</strong> 「職員番号」と同じ値が設定されます。</li>
                    <li><strong>所属校:</strong> 「校舎番号」と「所属校」の両方が登録されます。</li>
                  </ul>
                  <p className="text-xs text-gray-400 mt-1">※ 職員番号が一致する講師は情報が上書きされます。</p>
                </div>
                <div className="shrink-0">
                  <AccountImportButton role="teacher" onSuccess={() => {}} />
                </div>
              </div>
            </div>
          </section>

          {/* 3. PFデータ */}
          <section className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="bg-blue-50 p-5 border-b border-blue-100 flex items-center gap-4">
              <div className="bg-white p-3 rounded-xl text-blue-600 shadow-sm">
                <FileText size={28} />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-800">3. PFデータ (成績・出席)</h2>
                <p className="text-sm text-gray-500">年度ごとの成績・出席状況データを取り込みます。</p>
              </div>
            </div>
            <div className="p-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="text-sm text-gray-600 space-y-1 flex-1">
                  <p>ファイル名に<strong>年度 (例: 2025)</strong> を含めてください。</p>
                  <p>生徒の「所属教室」「学年」「曜日」情報も最新のCSVに合わせて自動更新されます。</p>
                </div>
                <div className="shrink-0">
                  <PfImportButton onSuccess={() => {}} />
                </div>
              </div>
            </div>
          </section>

          {/* 4. シフト配置 */}
          <section className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="bg-orange-50 p-5 border-b border-orange-100 flex items-center gap-4">
              <div className="bg-white p-3 rounded-xl text-orange-600 shadow-sm">
                <Calendar size={28} />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-800">4. 講師シフト配置</h2>
                <p className="text-sm text-gray-500">日別・コマ別の講師シフトを一括登録します。</p>
              </div>
            </div>
            <div className="p-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="text-sm text-gray-600 space-y-1 flex-1">
                  <p><strong>列順序:</strong> 日付, 時限, 講師名, 学年, 科目, メモ</p>
                  <p>講師名は登録済みのアカウント名と完全一致させてください。</p>
                </div>
                <div className="shrink-0">
                  <ShiftImportButton onSuccess={() => {}} />
                </div>
              </div>
            </div>
          </section>

          {/* 5. スライド・教材データ管理 */}
          <section className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="bg-teal-50 p-5 border-b border-teal-100 flex items-center gap-4">
              <div className="bg-white p-3 rounded-xl text-teal-600 shadow-sm">
                <Presentation size={28} />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-800">5. スライド・教材データ登録</h2>
                <p className="text-sm text-gray-500">AI問題生成の元となる学習単元データを登録します。</p>
              </div>
            </div>
            <div className="p-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="text-sm text-gray-600 space-y-1 flex-1">
                  <p><strong>機能:</strong> 単元ごとのスライド内容（テキスト）の登録・編集・削除</p>
                  <p>ここで登録した内容に基づいて、AIがその単元に特化した問題を生成します。</p>
                </div>
                <div className="shrink-0">
                  <Link 
                    href="/master/slides" 
                    className="inline-flex items-center gap-2 bg-teal-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-teal-700 transition-colors shadow-sm"
                  >
                    <Presentation size={20} />
                    スライド管理へ
                  </Link>
                </div>
              </div>
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}