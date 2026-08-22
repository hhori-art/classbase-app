'use client';

import Link from 'next/link';
import { ArrowLeft, Database, FileText, UserPlus, Calendar, AlertTriangle, Users, Presentation, Train, Download, BookOpen } from 'lucide-react';
import AccountImportButton from '@/app/components/AccountImportButton';
import AnnualScheduleImportButton from '@/app/components/AnnualScheduleImportButton';
import CourseRegistrationCsvImportButton from '@/app/components/CourseRegistrationCsvImportButton';
import PfImportButton from '@/app/components/PfImportButton';
import ShiftImportButton from '@/app/components/ShiftImportButton';
import TransportFareImportButton from '@/app/components/TransportFareImportButton';
import TransportStationImportButton from '@/app/components/TransportStationImportButton';
import { useAuth } from '@/app/context/AuthContext';

export default function ImportCenterPage() {
  const { profile } = useAuth();
  const isMaster = profile?.role === 'master';

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
          
          {/* アカウント作成は全体アカウント管理に属するためマスターのみ */}
          {isMaster && <section className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
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
                  <p><strong>必須項目:</strong> 氏名, ID(生涯番号)</p>
                  <p><strong>初期パスワード:</strong> CSVで空欄の場合はランダムに発行されます。</p>
                  <p><strong>自動登録:</strong> 学年, 教室, 曜日も同時に設定されます。</p>
                  <p className="text-xs text-gray-400 mt-1">※ IDが一致する生徒は情報が上書きされます。</p>
                </div>
                <div className="shrink-0">
                  <AccountImportButton role="student" onSuccess={() => {}} />
                </div>
              </div>
            </div>
          </section>}

          {isMaster && <section className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
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
                    <li><strong>初期パスワード:</strong> CSVで空欄の場合はランダムに発行されます。</li>
                    <li><strong>所属校:</strong> 「校舎番号」と「所属校」の両方が登録されます。</li>
                  </ul>
                  <p className="text-xs text-gray-400 mt-1">※ 職員番号が一致する講師は情報が上書きされます。</p>
                </div>
                <div className="shrink-0">
                  <AccountImportButton role="teacher" onSuccess={() => {}} />
                </div>
              </div>
            </div>
          </section>}

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

          {/* 5. 年間授業予定 */}
          <section className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="bg-indigo-50 p-5 border-b border-indigo-100 flex items-center gap-4">
              <div className="bg-white p-3 rounded-xl text-indigo-600 shadow-sm">
                <Calendar size={28} />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-800">5. 年間授業予定CSV</h2>
                <p className="text-sm text-gray-500">マスター管理者用。取り込んだ予定は生徒・保護者カレンダーにも反映されます。</p>
              </div>
            </div>
            <div className="p-6">
              <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
                <div className="text-sm text-gray-600 space-y-1 flex-1">
                  <p><strong>対応列:</strong> 日付/開始日/終了日, 学年, 科目, 単元, 回, 授業内容, 校舎, 備考</p>
                  <p>日付は「2026/4/1」「4/1」「4月1日」やExcel日付シリアルを受け付けます。</p>
                  <p className="text-xs text-gray-400">※ GoogleシートURLからの直接読込、またはCSVアップロードに対応します。</p>
                </div>
                <div className="shrink-0 md:w-[360px]">
                  <AnnualScheduleImportButton
                    type="lesson_schedule"
                    label="授業予定CSVを取り込む"
                    sample="日付,学年,科目,回,単元,授業内容,校舎,備考"
                    sampleFilename="年間授業予定CSV例.csv"
                    sampleRows={[
                      ['2026/4/6', '中1', '理科', '1', '植物の分類', '春期第1回', '元町', '通常授業'],
                      ['2026/4/13', '中1', '社会', '2', '世界の地域区分', '春期第2回', '元町', '通常授業'],
                    ]}
                  />
                </div>
              </div>
            </div>
          </section>

          {/* 6. 年間カリキュラム予定 */}
          <section className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="bg-cyan-50 p-5 border-b border-cyan-100 flex items-center gap-4">
              <div className="bg-white p-3 rounded-xl text-cyan-600 shadow-sm">
                <FileText size={28} />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-800">6. 年間カリキュラム予定CSV</h2>
                <p className="text-sm text-gray-500">単元進行や年間カリキュラムをCSVで登録します。</p>
              </div>
            </div>
            <div className="p-6">
              <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
                <div className="text-sm text-gray-600 space-y-1 flex-1">
                  <p><strong>対応列:</strong> 開始日/終了日, 学年, 科目, 単元, カリキュラム, 内容, 備考</p>
                  <p>複数日に跨る単元予定は、開始日と終了日の両方を指定してください。</p>
                  <p className="text-xs font-bold text-cyan-700">取り込み後は「カリキュラム管理」でターム設定を保存すると、講座登録用の候補に反映されます。GoogleシートURLからの直接読込も可能です。</p>
                </div>
                <div className="shrink-0 md:w-[360px]">
                  <Link href="/master/curriculum" className="mb-3 inline-flex w-full items-center justify-center rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-2 text-sm font-bold text-cyan-700 hover:bg-cyan-100">
                    カリキュラム管理を開く
                  </Link>
                  <AnnualScheduleImportButton
                    type="curriculum"
                    label="カリキュラムCSVを取り込む"
                    sample="開始日,終了日,学年,科目,単元,内容,備考"
                    sampleFilename="年間カリキュラムCSV例.csv"
                    sampleRows={[
                      ['2026/4/1', '2026/4/30', '中1', '理科', '植物の世界', '植物の分類とつくり', '4月単元'],
                      ['2026/5/1', '2026/5/31', '中1', '社会', '世界の姿', '世界地図と地域区分', '5月単元'],
                    ]}
                  />
                </div>
              </div>
            </div>
          </section>

          {/* 7. 受講講座CSV登録 */}
          <section className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="bg-indigo-50 p-5 border-b border-indigo-100 flex items-center gap-4">
              <div className="bg-white p-3 rounded-xl text-indigo-600 shadow-sm">
                <BookOpen size={28} />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-800">7. 受講講座CSV登録</h2>
                <p className="text-sm text-gray-500">MemberMaster形式のCSVから、生徒ごとの受講講座を一括登録します。</p>
              </div>
            </div>
            <div className="p-6">
              <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
                <div className="text-sm text-gray-600 space-y-1 flex-1">
                  <p><strong>対応列:</strong> id, name, grade, 次期月〜次期土</p>
                  <p>「1限:中3生物Ⅱ, 2限:中3公民②Ⅱ」のような入力を、指定した年度・期の講座候補と照合して登録します。</p>
                  <p className="text-xs text-gray-400">※ id は登録済み生徒のログインID/生涯番号と一致している必要があります。</p>
                </div>
                <div className="shrink-0 md:w-[430px]">
                  <CourseRegistrationCsvImportButton />
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
                <h2 className="text-xl font-bold text-gray-800">8. スライド・教材データ登録</h2>
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

	          <section className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
	            <div className="bg-emerald-50 p-5 border-b border-emerald-100 flex items-center gap-4">
	              <div className="bg-white p-3 rounded-xl text-emerald-600 shadow-sm">
	                <Train size={28} />
	              </div>
	              <div>
	                <h2 className="text-xl font-bold text-gray-800">9. 交通費マスタ登録</h2>
	                <p className="text-sm text-gray-500">主要交通機関の区間運賃を登録します。</p>
	              </div>
	            </div>
	            <div className="p-6">
	              <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
	                <div className="text-sm text-gray-600 space-y-3 flex-1">
	                  <p><strong>対応列:</strong> 交通機関, 出発, 到着, 金額, 参照元, 備考</p>
	                  <p>駅名マスタを先に登録すると、「三宮」「JR三ノ宮」「阪急神戸三宮」などの表記揺れを正式駅名に寄せて、登録済み運賃と照合できます。</p>
	                  <p className="text-xs text-gray-400">※ 正確な金額は各交通機関の公式運賃表、または駅すぱあと/NAVITIMEの回答に合わせて入力してください。</p>
                    <div className="flex flex-wrap gap-2 pt-2">
                      <a
                        href="/templates/transport-stations-major-hyogo.csv"
                        download
                        className="inline-flex items-center gap-1.5 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-black text-sky-700 hover:bg-sky-100"
                      >
                        <Download size={14} />
                        駅名マスタCSV
                      </a>
                      <a
                        href="/templates/transport-fares-major-hyogo.csv"
                        download
                        className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700 hover:bg-emerald-100"
                      >
                        <Download size={14} />
                        主要運賃CSV
                      </a>
                    </div>
	                </div>
	                <div className="grid shrink-0 gap-4 md:w-[380px]">
                    <div className="rounded-2xl border border-sky-100 bg-sky-50/50 p-4">
                      <p className="mb-3 text-sm font-black text-sky-900">駅名・停留所名マスタ</p>
	                    <TransportStationImportButton />
                    </div>
                    <div className="rounded-2xl border border-emerald-100 bg-emerald-50/50 p-4">
                      <p className="mb-3 text-sm font-black text-emerald-900">区間運賃マスタ</p>
	                    <TransportFareImportButton />
                    </div>
	                </div>
	              </div>
	            </div>
	          </section>

	        </div>
      </div>
    </div>
  );
}
