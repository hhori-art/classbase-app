'use client';

import Link from 'next/link';
import { ChevronRight, DollarSign, Download, Train } from 'lucide-react';
import { buttonClass } from '@/app/components/ui';
import AdminPageHeader from '@/app/components/master/AdminPageHeader';
import TransportFareImportButton from '@/app/components/TransportFareImportButton';
import TransportStationImportButton from '@/app/components/TransportStationImportButton';

/** 勤怠管理者が使う設定（交通費マスタ・給与計算の単価と割増）。理社講座の設定とは分けて置く。 */
export default function AttendanceSettingsPage() {
  return (
    <div className="space-y-6 font-sans text-slate-800">
      <AdminPageHeader
        description="交通費の計算に使う駅名・運賃のマスタと、給与計算の単価・割増の設定です。"
      />

      <section className="overflow-hidden rounded-card border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-4 border-b border-emerald-100 bg-emerald-50 p-5">
          <div className="rounded-btn bg-white p-3 text-emerald-600 shadow-sm"><Train size={28} /></div>
          <div>
            <h2 className="text-xl font-bold text-slate-800">交通費マスタ</h2>
            <p className="text-sm text-slate-500">主要交通機関の駅名と区間運賃を登録します。</p>
          </div>
        </div>
        <div className="flex flex-col gap-6 p-6 md:flex-row md:items-start md:justify-between">
          <div className="flex-1 space-y-3 text-sm text-slate-600">
            <p><strong>対応列:</strong> 交通機関, 出発, 到着, 金額, 参照元, 備考</p>
            <p>駅名マスタを先に登録すると、「三宮」「JR三ノ宮」「阪急神戸三宮」などの表記揺れを正式駅名に寄せて、登録済み運賃と照合できます。</p>
            <p className="text-xs text-slate-400">※ 正確な金額は各交通機関の公式運賃表、または駅すぱあと/NAVITIMEの回答に合わせて入力してください。</p>
            <div className="flex flex-wrap gap-2 pt-2">
              <a href="/templates/transport-stations-major-hyogo.csv" download className={buttonClass('secondary', 'sm')}>
                <Download size={14} aria-hidden />駅名マスタCSV
              </a>
              <a href="/templates/transport-fares-major-hyogo.csv" download className={buttonClass('secondary', 'sm')}>
                <Download size={14} aria-hidden />主要運賃CSV
              </a>
            </div>
          </div>
          <div className="grid shrink-0 gap-4 md:w-[380px]">
            <div className="rounded-card border border-sky-100 bg-sky-50/50 p-4">
              <p className="mb-3 text-sm font-bold text-sky-900">駅名・停留所名マスタ</p>
              <TransportStationImportButton />
            </div>
            <div className="rounded-card border border-emerald-100 bg-emerald-50/50 p-4">
              <p className="mb-3 text-sm font-bold text-emerald-900">区間運賃マスタ</p>
              <TransportFareImportButton />
            </div>
          </div>
        </div>
      </section>

      <Link href="/master/attendance/payroll" className="flex items-center gap-4 rounded-card border border-slate-200 bg-white p-5 shadow-sm hover:border-amber-300">
        <span className="rounded-btn bg-amber-50 p-3 text-amber-600"><DollarSign size={24} /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-base font-bold text-slate-800">給与計算の単価・割増</span>
          <span className="block text-sm text-slate-500">個別指導の単価紐付け・割増計算式は「給与計算・勤怠出力」の画面で設定します。</span>
        </span>
        <ChevronRight className="text-slate-300" />
      </Link>
    </div>
  );
}
