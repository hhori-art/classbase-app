type AnnualUnit = {
  id?: string;
  subject: string;
  month: string;
  unit: string;
  grade?: string;
  note?: string;
};

export default function AnnualUnitTimeline({ units }: { units: AnnualUnit[] }) {
  const sorted = [...units].sort((a, b) => `${a.month}${a.subject}`.localeCompare(`${b.month}${b.subject}`));

  return (
    <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs font-black text-slate-500">
          <tr>
            <th className="px-4 py-3">時期</th>
            <th className="px-4 py-3">学年</th>
            <th className="px-4 py-3">科目</th>
            <th className="px-4 py-3">単元</th>
            <th className="px-4 py-3">補足</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {sorted.map((item, index) => (
            <tr key={item.id || `${item.month}-${item.subject}-${index}`} className="hover:bg-slate-50">
              <td className="px-4 py-3 font-black text-slate-900">{item.month}</td>
              <td className="px-4 py-3 font-bold text-slate-600">{item.grade || '-'}</td>
              <td className="px-4 py-3 font-bold text-slate-600">{item.subject}</td>
              <td className="px-4 py-3 font-black text-slate-800">{item.unit}</td>
              <td className="px-4 py-3 text-xs font-bold text-slate-500">{item.note || '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

