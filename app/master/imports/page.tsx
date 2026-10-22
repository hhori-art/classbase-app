'use client';

import Link from 'next/link';
import { FileText, UserPlus, Calendar, AlertTriangle, Users, Presentation, Train, BookOpen } from 'lucide-react';
import AdminPageHeader from '@/app/components/master/AdminPageHeader';
import { ButtonLink } from '@/app/components/ui';
import AnnualScheduleImportButton from '@/app/components/AnnualScheduleImportButton';
import CourseRegistrationCsvImportButton from '@/app/components/CourseRegistrationCsvImportButton';
import PfImportButton from '@/app/components/PfImportButton';
import ShiftImportButton from '@/app/components/ShiftImportButton';

export default function ImportCenterPage() {
  return (
    <div className="font-sans text-slate-800">
      <div>

        <AdminPageHeader
          description="理社講座のマスターデータ（PF・シフト・予定・カリキュラム・受講講座・スライド）をCSVファイルから一括で登録・更新します。"
        />

        {/* 注意書き */}
        <div className="bg-amber-50 border border-amber-200 rounded-card p-4 mb-8 flex items-start gap-3">
          <AlertTriangle className="text-amber-600 shrink-0" size={20} aria-hidden />
          <div className="text-sm text-amber-800">
            <p className="font-bold mb-1">データ制限について</p>
            <p>短時間に大量のデータをインポートすると、データベースの書き込み制限（Quota exceeded）にかかる場合があります。<br/>
            エラーが出た場合は、時間を置いてから再試行するか、ファイルを分割してください。</p>
          </div>
        </div>

        <div className="grid gap-8">
          
          {/* アカウントのCSV一括登録は専用画面で行う */}
          <section className="flex flex-col gap-3 rounded-card border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="rounded-btn bg-slate-100 p-2.5 text-slate-600"><UserPlus size={20} /></div>
              <p className="text-sm font-bold leading-relaxed text-slate-600">アカウントのCSV一括登録は「ID書面・印刷」（講師・管理者）と「校舎別 生徒管理」（生徒・保護者）で行います。</p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <ButtonLink href="/master/users" variant="secondary" icon={<Users size={16} aria-hidden />}>ID書面・印刷</ButtonLink>
              <ButtonLink href="/master/school-students" variant="secondary" icon={<Users size={16} aria-hidden />}>校舎別 生徒管理</ButtonLink>
            </div>
          </section>

          {/* 1. PFデータ */}
          <section className="bg-white rounded-card shadow-sm border border-slate-200 overflow-hidden">
            <div className="bg-slate-50 p-5 border-b border-line flex items-center gap-4">
              <div className="bg-white p-3 rounded-btn text-accent shadow-sm">
                <FileText size={28} aria-hidden />
              </div>
              <div>
                <h2 className="text-xl font-bold text-slate-800">1. PFデータ (成績・出席)</h2>
                <p className="text-sm text-slate-500">年度ごとの成績・出席状況データを取り込みます。</p>
              </div>
            </div>
            <div className="p-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="text-sm text-slate-600 space-y-1 flex-1">
                  <p>ファイル名に<strong>年度 (例: 2025)</strong> を含めてください。</p>
                  <p>生徒の「所属教室」「学年」「曜日」情報も最新のCSVに合わせて自動更新されます。</p>
                </div>
                <div className="shrink-0">
                  <PfImportButton onSuccess={() => {}} />
                </div>
              </div>
            </div>
          </section>

          {/* 2. シフト配置 */}
          <section className="bg-white rounded-card shadow-sm border border-slate-200 overflow-hidden">
            <div className="bg-slate-50 p-5 border-b border-line flex items-center gap-4">
              <div className="bg-white p-3 rounded-btn text-accent shadow-sm">
                <Calendar size={28} aria-hidden />
              </div>
              <div>
                <h2 className="text-xl font-bold text-slate-800">2. 講師シフト配置</h2>
                <p className="text-sm text-slate-500">日別・コマ別の講師シフトを一括登録します。</p>
              </div>
            </div>
            <div className="p-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="text-sm text-slate-600 space-y-1 flex-1">
                  <p><strong>列順序:</strong> 日付, 時限, 講師名, 学年, 科目, メモ</p>
                  <p>講師名は登録済みのアカウント名と完全一致させてください。</p>
                </div>
                <div className="shrink-0">
                  <ShiftImportButton onSuccess={() => {}} />
                </div>
              </div>
            </div>
          </section>

          {/* 3. 年間授業予定 */}
          <section className="bg-white rounded-card shadow-sm border border-slate-200 overflow-hidden">
            <div className="bg-slate-50 p-5 border-b border-line flex items-center gap-4">
              <div className="bg-white p-3 rounded-btn text-accent shadow-sm">
                <Calendar size={28} aria-hidden />
              </div>
              <div>
                <h2 className="text-xl font-bold text-slate-800">3. 年間授業予定CSV</h2>
                <p className="text-sm text-slate-500">マスター管理者用。取り込んだ予定は生徒・保護者カレンダーにも反映されます。</p>
              </div>
            </div>
            <div className="p-6">
              <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
                <div className="text-sm text-slate-600 space-y-1 flex-1">
                  <p><strong>対応列:</strong> 日付/開始日/終了日, 学年, 科目, 単元, 回, 授業内容, 校舎, 備考</p>
                  <p>日付は「2026/4/1」「4/1」「4月1日」やExcel日付シリアルを受け付けます。</p>
                  <p className="text-xs text-slate-400">※ GoogleシートURLからの直接読込、またはCSVアップロードに対応します。</p>
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

          {/* 4. 年間カリキュラム予定 */}
          <section className="bg-white rounded-card shadow-sm border border-slate-200 overflow-hidden">
            <div className="bg-slate-50 p-5 border-b border-line flex items-center gap-4">
              <div className="bg-white p-3 rounded-btn text-accent shadow-sm">
                <FileText size={28} aria-hidden />
              </div>
              <div>
                <h2 className="text-xl font-bold text-slate-800">4. 年間カリキュラム予定CSV</h2>
                <p className="text-sm text-slate-500">単元進行や年間カリキュラムをCSVで登録します。</p>
              </div>
            </div>
            <div className="p-6">
              <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
                <div className="text-sm text-slate-600 space-y-1 flex-1">
                  <p><strong>対応列:</strong> 開始日/終了日, 学年, 科目, 単元, カリキュラム, 内容, 備考</p>
                  <p>複数日に跨る単元予定は、開始日と終了日の両方を指定してください。</p>
                  <p className="text-xs font-bold text-accent">取り込み後は「カリキュラム管理」でターム設定を保存すると、講座登録用の候補に反映されます。GoogleシートURLからの直接読込も可能です。</p>
                </div>
                <div className="shrink-0 md:w-[360px]">
                  <ButtonLink href="/master/curriculum" variant="secondary" fullWidth className="mb-3">
                    カリキュラム管理を開く
                  </ButtonLink>
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

          {/* 5. 受講講座CSV登録 */}
          <section className="bg-white rounded-card shadow-sm border border-slate-200 overflow-hidden">
            <div className="bg-slate-50 p-5 border-b border-line flex items-center gap-4">
              <div className="bg-white p-3 rounded-btn text-accent shadow-sm">
                <BookOpen size={28} aria-hidden />
              </div>
              <div>
                <h2 className="text-xl font-bold text-slate-800">5. 受講講座CSV登録</h2>
                <p className="text-sm text-slate-500">MemberMaster形式のCSVから、生徒ごとの受講講座を一括登録します。</p>
              </div>
            </div>
            <div className="p-6">
              <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
                <div className="text-sm text-slate-600 space-y-1 flex-1">
                  <p><strong>対応列:</strong> id, name, grade, 次期月〜次期土</p>
                  <p>「1限:中3生物Ⅱ, 2限:中3公民②Ⅱ」のような入力を、指定した年度・期の講座候補と照合して登録します。</p>
                  <p className="text-xs text-slate-400">※ id は登録済み生徒のログインID/生涯番号と一致している必要があります。</p>
                </div>
                <div className="shrink-0 md:w-[430px]">
                  <CourseRegistrationCsvImportButton />
                </div>
              </div>
            </div>
          </section>

          {/* 6. スライド・教材データ管理 */}
          <section className="bg-white rounded-card shadow-sm border border-slate-200 overflow-hidden">
            <div className="bg-slate-50 p-5 border-b border-line flex items-center gap-4">
              <div className="bg-white p-3 rounded-btn text-accent shadow-sm">
                <Presentation size={28} aria-hidden />
              </div>
              <div>
                <h2 className="text-xl font-bold text-slate-800">6. スライド・教材データ登録</h2>
                <p className="text-sm text-slate-500">AI問題生成の元となる学習単元データを登録します。</p>
              </div>
            </div>
            <div className="p-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="text-sm text-slate-600 space-y-1 flex-1">
                  <p><strong>機能:</strong> 単元ごとのスライド内容（テキスト）の登録・編集・削除</p>
                  <p>ここで登録した内容に基づいて、AIがその単元に特化した問題を生成します。</p>
                </div>
                <div className="shrink-0">
                  <ButtonLink href="/master/slides" variant="secondary" icon={<Presentation size={20} aria-hidden />}>
                    スライド管理へ
                  </ButtonLink>
                </div>
              </div>
            </div>
          </section>

          {/* 交通費マスタは勤怠管理者が使う設定なので「勤怠 ＞ 勤怠の設定」に移した */}
          <Link href="/master/attendance/settings" className="flex items-center gap-3 rounded-card border border-slate-200 bg-white p-5 text-sm font-bold text-slate-600 shadow-sm hover:border-emerald-300">
            <Train size={20} className="text-emerald-600" />
            交通費マスタ（駅名・区間運賃）の登録は「勤怠 ＞ 勤怠の設定」で行います。
          </Link>

        </div>
      </div>
    </div>
  );
}
