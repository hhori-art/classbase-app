import type { PayrollPersonSummary } from './attendance-payroll.ts';

const htmlCell = (value: unknown) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const timeValue = (minutes: number) => minutes / (24 * 60);
const displayTime = (minutes: number) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;

export function buildOriginalPayrollHtml(month: string, rows: PayrollPersonSummary[]) {
  const bodyRows = rows.map((row, index) => {
    const officeMinutes = row.categories.office.minutes + row.categories.other.minutes;
    const officeAmount = row.categories.office.amount + row.categories.other.amount;
    return `<tr>
      <td class="center">${index + 1}</td><td>${htmlCell(row.school_name || row.school_code)}</td>
      <td class="code">${htmlCell(row.person_code)}</td><td>${htmlCell(row.person_name)}</td>
      <td class="rate">${row.normal_lesson_rate || 0}</td><td class="rate">${row.breakthrough_lesson_rate || row.categories.lesson.hourly_rate || 0}</td>
      <td class="time" x:num="${timeValue(row.categories.lesson.minutes)}">${displayTime(row.categories.lesson.minutes)}</td><td class="money">${row.categories.lesson.amount}</td>
      <td class="rate">${row.categories.office.hourly_rate || row.categories.other.hourly_rate || 0}</td><td class="time" x:num="${timeValue(officeMinutes)}">${displayTime(officeMinutes)}</td><td class="money">${officeAmount}</td>
      <td class="rate">${row.categories.interview.hourly_rate || 0}</td><td class="time" x:num="${timeValue(row.categories.interview.minutes)}">${displayTime(row.categories.interview.minutes)}</td><td class="money">${row.categories.interview.amount}</td>
      <td class="total">${row.total_payment}</td><td class="total">${row.transportation_amount}</td><td class="center">${htmlCell(row.tp_serial)}</td>
    </tr>`;
  }).join('');
  const totals = rows.reduce((sum, row) => ({
    lessonMinutes: sum.lessonMinutes + row.categories.lesson.minutes,
    lesson: sum.lesson + row.categories.lesson.amount,
    officeMinutes: sum.officeMinutes + row.categories.office.minutes + row.categories.other.minutes,
    office: sum.office + row.categories.office.amount + row.categories.other.amount,
    interviewMinutes: sum.interviewMinutes + row.categories.interview.minutes,
    interview: sum.interview + row.categories.interview.amount,
    payment: sum.payment + row.total_payment,
    transport: sum.transport + row.transportation_amount,
  }), { lessonMinutes: 0, lesson: 0, officeMinutes: 0, office: 0, interviewMinutes: 0, interview: 0, payment: 0, transport: 0 });

  return `<!DOCTYPE html><html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="UTF-8"><style>
    body{font-family:"ＭＳ Ｐゴシック","Meiryo",sans-serif}table{border-collapse:collapse}td,th{border:1px solid #000;height:24px;padding:2px 5px;font-size:10pt;white-space:nowrap}
    th{text-align:center;font-weight:400}.gray{background:#c0c0c0}.lesson{background:#ccffff}.work{background:#ccffcc}.yellow,.total{background:#ffffcc;font-weight:700}
    .center{text-align:center}.code{mso-number-format:"0";text-align:right}.rate,.money,.total{text-align:right;mso-number-format:"#,##0"}.time{text-align:right;mso-number-format:"[h]\\:mm"}.blue{color:#0000ff}
    .no{width:42px}.school{width:145px}.person{width:108px}.name{width:196px}.unit{width:104px}.amount{width:120px}
  </style></head><body><table data-month="${htmlCell(month)}"><thead>
    <tr><th class="gray no" rowspan="2">NO</th><th class="gray school" rowspan="2">所属教室</th><th class="gray person" rowspan="2">個人ｺｰﾄﾞ</th><th class="gray name" rowspan="2">氏  名</th><th class="gray unit blue">通常授業</th><th class="gray unit">突破授業</th><th class="lesson" colspan="2">授業</th><th colspan="3">事務</th><th colspan="3">ｻﾌﾞ（面談）</th><th class="yellow amount" rowspan="2">総支給額</th><th class="yellow amount" rowspan="2">移動費合計</th><th rowspan="2">TP</th></tr>
    <tr><th class="gray blue">単価</th><th class="gray">単価</th><th class="lesson">時間計</th><th>授業手当</th><th class="blue">時給</th><th class="work">時間</th><th>手当</th><th class="blue">時給</th><th class="work">時間</th><th>手当</th></tr>
    </thead><tbody>${bodyRows}<tr><td colspan="6"></td><td class="time" x:num="${timeValue(totals.lessonMinutes)}">${displayTime(totals.lessonMinutes)}</td><td class="money">${totals.lesson}</td><td></td><td class="time" x:num="${timeValue(totals.officeMinutes)}">${displayTime(totals.officeMinutes)}</td><td class="money">${totals.office}</td><td></td><td class="time" x:num="${timeValue(totals.interviewMinutes)}">${displayTime(totals.interviewMinutes)}</td><td class="money">${totals.interview}</td><td class="total">${totals.payment}</td><td class="total">${totals.transport}</td><td></td></tr></tbody></table></body></html>`;
}
