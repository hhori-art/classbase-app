// ID書面（アカウント案内）の共通データ。生徒用・保護者用・講師/管理者用で別の用紙にする。

export type GuideParentStatus = 'issued' | 'activated' | 'none';

export type GuideAccount = {
  key: string;
  kind: 'student' | 'parent' | 'staff';
  /** 講師・管理者などの区分名（staff のみ）。 */
  staffLabel: string;
  isTeacher: boolean;
  name: string;
  loginId: string;
  password: string;
  school: string;
  grade: string;
  dayOfWeek: string;
  science: string;
  social: string;
  middleSchool: string;
  startMonth: string;
  /** 生徒のときの保護者アカウント（保護者用の用紙に使う）。 */
  parent: { loginId: string; password: string; status: GuideParentStatus };
  /** 保護者単独で印刷するときのお子様名。 */
  childName: string;
};

const text = (value: unknown) => String(value ?? '').trim();

const TEACHER_ROLES = ['teacher', 'attendance_admin', 'attendance_only', 'attendance_manager'];

/**
 * 各画面のユーザー情報（users ドキュメントや一覧APIの行）を書面用に正規化する。
 * parent_status は印刷前の同期結果（ログイン済みで除外した保護者は activated）。
 */
export function toGuideAccount(raw: Record<string, any>, school = ''): GuideAccount {
  const role = text(raw.role).toLowerCase();
  const kind: GuideAccount['kind'] = role === 'student' ? 'student' : role === 'parent' || role === 'guardian' ? 'parent' : 'staff';
  const parentLoginId = text(raw.parent_login_id);
  const parentPassword = text(raw.parent_initial_password);
  const parentStatus: GuideParentStatus = raw.parent_status === 'activated'
    ? 'activated'
    : parentLoginId && parentPassword ? 'issued' : 'none';
  return {
    key: text(raw.id || raw.uid || raw.lifetime_id || raw.email) || Math.random().toString(36).slice(2),
    kind,
    staffLabel: TEACHER_ROLES.includes(role) ? '講師' : '管理者',
    isTeacher: TEACHER_ROLES.includes(role),
    name: text(raw.student_name || raw.name || raw.parent_name || raw.teacher_name) || '名称未設定',
    loginId: text(raw.lifetime_id || raw.initial_login_id || raw.email),
    password: text(raw.initial_password || raw.raw_password),
    school: text(school || raw.school_name || raw.school_id || raw.school || raw.classroom),
    grade: text(raw.grade),
    dayOfWeek: text(raw.day_of_week).replace('曜日', ''),
    science: text(raw.subject_science),
    social: text(raw.subject_social),
    middleSchool: text(raw.middle_school),
    startMonth: text(raw.course_start_month),
    parent: { loginId: parentLoginId, password: parentPassword, status: parentStatus },
    childName: text(raw.child_name),
  };
}

export type GuideOrder = 'alternate' | 'grouped' | 'student-only' | 'parent-only';

export type GuidePrintOptions = {
  order: GuideOrder;
  /** 両面印刷用（交互のとき）：生徒1人につき必ず2ページ（表：生徒用・裏：保護者用）にそろえる。 */
  duplex: boolean;
  /** 先頭に配布チェック表を付ける。 */
  checklist: boolean;
};

export const DEFAULT_GUIDE_PRINT_OPTIONS: GuidePrintOptions = { order: 'alternate', duplex: false, checklist: false };

export type GuidePage =
  | { type: 'student'; account: GuideAccount; index: number }
  | { type: 'parent'; account: GuideAccount; index: number }
  | { type: 'parent-placeholder'; account: GuideAccount; index: number }
  | { type: 'staff'; account: GuideAccount; index: number }
  | { type: 'checklist'; rows: GuideAccount[]; startIndex: number; page: number; pageCount: number };

export const CHECKLIST_ROWS_PER_PAGE = 24;

/** 印刷するページの並びを作る（通し番号 index は生徒単位で 1 から）。 */
export function buildGuidePages(accounts: GuideAccount[], options: GuidePrintOptions): GuidePage[] {
  const pages: GuidePage[] = [];
  if (options.checklist) {
    const pageCount = Math.max(1, Math.ceil(accounts.length / CHECKLIST_ROWS_PER_PAGE));
    for (let page = 0; page < pageCount; page++) {
      const start = page * CHECKLIST_ROWS_PER_PAGE;
      pages.push({ type: 'checklist', rows: accounts.slice(start, start + CHECKLIST_ROWS_PER_PAGE), startIndex: start, page: page + 1, pageCount });
    }
    // 両面印刷では、チェック表の裏に1人目の保護者用が来ないよう偶数ページにそろえる。
    if (options.duplex && pageCount % 2 === 1) pages.push({ type: 'checklist', rows: [], startIndex: accounts.length, page: pageCount + 1, pageCount: pageCount + 1 });
  }

  const mainPage = (account: GuideAccount, index: number): GuidePage =>
    account.kind === 'staff' ? { type: 'staff', account, index } : account.kind === 'parent' ? { type: 'parent', account, index } : { type: 'student', account, index };
  const hasParentSheet = (account: GuideAccount) => account.kind === 'student' && account.parent.status === 'issued';
  const placeholder = (account: GuideAccount, index: number): GuidePage => ({ type: 'parent-placeholder', account, index });

  accounts.forEach((account, position) => {
    const index = position + 1;
    switch (options.order) {
      case 'grouped':
        // 生徒用（講師・保護者単独を含む）をすべて出したあと、保護者用をまとめて出す（下で追加）。
        pages.push(mainPage(account, index));
        break;
      case 'parent-only':
        if (hasParentSheet(account)) pages.push({ type: 'parent', account, index });
        else if (account.kind === 'parent') pages.push(mainPage(account, index));
        break;
      case 'student-only':
        if (account.kind !== 'parent') pages.push(mainPage(account, index));
        break;
      case 'alternate':
      default:
        // 生徒用 → 保護者用 → 次の生徒用 … の順。両面印刷では1人につき必ず表裏2ページにする。
        pages.push(mainPage(account, index));
        if (hasParentSheet(account)) pages.push({ type: 'parent', account, index });
        else if (options.duplex) pages.push(placeholder(account, index));
        break;
    }
  });
  if (options.order === 'grouped') {
    accounts.forEach((account, position) => {
      if (hasParentSheet(account)) pages.push({ type: 'parent', account, index: position + 1 });
    });
  }
  return pages;
}

export const issuedDateLabel = (date = new Date()) => `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;

/** パスワードを4文字ごとに区切って読みやすくする（入力時は区切り不要）。 */
export const passwordChunks = (value: string) => value.match(/.{1,4}/g) || [value];

// 印刷は余白10mm（プリンターが端を印刷できなくても切れない）。書面はA4いっぱい（210×297mm）で
// デザインし、余白の内側（190×277mm）に縮小して収める。印刷設定を変えずにそのまま印刷できる。
export const GUIDE_PAGE_MARGIN_MM = 10;

export const GUIDE_PRINT_CSS = `
  .guide-page { width: 190mm; height: 277mm; }
  .guide-sheet {
    /* transform だと縮小前の幅がはみ出し扱いになり、印刷時にページ全体が縮むため zoom で実寸を縮める。 */
    position: absolute; left: 0; top: ${((277 - 297 * (190 / 210)) / 2).toFixed(2)}mm; width: 210mm; height: 297mm;
    zoom: ${(190 / 210).toFixed(5)};
  }
  @media screen {
    .guide-page { content-visibility: auto; contain-intrinsic-size: 277mm 190mm; }
  }
  @media print {
    @page { size: A4 portrait; margin: 10mm; }
    .guide-print-root {
      position: static !important; display: block !important; width: 100% !important;
      height: auto !important; overflow: visible !important; background: white !important;
    }
    .guide-print-hide { display: none !important; }
    .guide-print-pages { display: block !important; padding: 0 !important; gap: 0 !important; min-width: 0 !important; }
    .guide-page {
      display: block !important; position: relative !important; margin: 0 !important;
      box-shadow: none !important; border: 0 !important;
      break-after: page !important; page-break-after: always !important;
      break-inside: avoid !important; page-break-inside: avoid !important; overflow: hidden !important;
    }
    .guide-page:last-child { break-after: auto !important; page-break-after: auto !important; }
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  }
`;

// ---- 名簿の差し込み（氏名はブラウザ内だけで使い、サーバーには送らない） ----

/** ID の表記ゆれ（全角・空白・大文字小文字）をそろえる。 */
export const normalizeRosterId = (value: unknown) =>
  String(value ?? '').normalize('NFKC').replace(/\s+/g, '').toUpperCase();

/** CSV / スプレッドシートから貼り付けたタブ区切りを行・列に分ける（ダブルクォート対応）。 */
export function parseRosterTable(source: string): string[][] {
  const textValue = source.replace(/^﻿/, '');
  const firstLine = textValue.split(/\r?\n/, 1)[0] || '';
  const delimiter = firstLine.includes('\t') ? '\t' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < textValue.length; index++) {
    const char = textValue[index];
    if (quoted) {
      if (char === '"' && textValue[index + 1] === '"') { cell += '"'; index++; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell === '') quoted = true;
    else if (char === delimiter) { row.push(cell); cell = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && textValue[index + 1] === '\n') index++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += char;
  }
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row); }
  return rows.map(cells => cells.map(value => value.trim())).filter(cells => cells.some(Boolean));
}

/** 名簿と照合するキー（生徒は生徒ID、保護者単独は末尾の P を除いたお子様のID）。 */
export const rosterKeyOf = (account: GuideAccount) => account.kind === 'student'
  ? normalizeRosterId(account.loginId)
  : account.kind === 'parent' ? normalizeRosterId(account.loginId).replace(/P$/, '') : '';

const ID_HEADER = /^(生徒)?(ログイン)?id$|^生徒番号$|^ログインid$|^login_?id$|^lifetime_?id$|^id$/i;
const NAME_HEADER = /^(生徒)?(氏名|名前|生徒名)$|^name$|^student_?name$/i;
const FAMILY_HEADER = /^(姓|苗字|名字)$/;
const GIVEN_HEADER = /^名$/;

export type RosterMatch = {
  /** 正規化した生徒ID → 氏名。 */
  names: Map<string, string>;
  matched: number;
  /** 書面の対象なのに名簿に見つからなかった生徒ID。 */
  missing: string[];
  /** 名簿にあるが書面の対象ではない行の数。 */
  extraRows: number;
};

/**
 * 名簿の表から、書面の生徒ID（account.loginId）に対応する氏名を取り出す。
 * 見出し（ID・氏名、または 姓・名）があればその列を、なければ ID が一致した行の
 * 残りの列で最初の文字列を氏名とみなす。
 */
export function matchRosterNames(rows: string[][], accounts: GuideAccount[]): RosterMatch {
  const targetIds = new Set(accounts.map(rosterKeyOf).filter(Boolean));
  const headerKey = (cell: string) => cell.normalize('NFKC').replace(/\s+/g, '');
  // 見出しは先頭数行だけ探す（データ中の「ID」という値を見出しと誤認しないため）。
  const headerIndex = rows.slice(0, 5).findIndex(cells => cells.some(cell => ID_HEADER.test(headerKey(cell))));
  const header = headerIndex >= 0 ? rows[headerIndex] : null;
  const findColumn = (pattern: RegExp) => header ? header.findIndex(cell => pattern.test(headerKey(cell))) : -1;
  const idColumn = findColumn(ID_HEADER);
  const nameColumn = findColumn(NAME_HEADER);
  const familyColumn = findColumn(FAMILY_HEADER);
  const givenColumn = findColumn(GIVEN_HEADER);

  const collect = (fixedIdColumn: number) => {
    const names = new Map<string, string>();
    let extraRows = 0;
    rows.slice(headerIndex + 1).forEach(cells => {
      const idCell = fixedIdColumn >= 0 ? fixedIdColumn : cells.findIndex(cell => targetIds.has(normalizeRosterId(cell)));
      const id = idCell >= 0 ? normalizeRosterId(cells[idCell]) : '';
      if (!id || !targetIds.has(id)) { extraRows++; return; }
      let name = '';
      if (nameColumn >= 0) name = cells[nameColumn] || '';
      else if (familyColumn >= 0) name = [cells[familyColumn], givenColumn >= 0 ? cells[givenColumn] : ''].filter(Boolean).join(' ');
      else name = cells.find((cell, index) => index !== idCell && cell && !/^[\d\s\-/.:]+$/.test(cell.normalize('NFKC'))) || '';
      name = name.replace(/\s+/g, ' ').trim();
      if (name) names.set(id, name);
    });
    return { names, extraRows };
  };
  // 「ID」列が別の番号（学籍番号など）だった場合は、行の中から生徒IDを探し直す。
  let collected = collect(idColumn);
  if (idColumn >= 0 && collected.names.size === 0) collected = collect(-1);
  const { names, extraRows } = collected;
  const missing = Array.from(targetIds).filter(id => !names.has(id));
  return { names, matched: names.size, missing, extraRows };
}

/** 名簿の氏名を書面に反映する（保護者単独の書面はお子様名に入れる）。 */
export function applyRosterNames(accounts: GuideAccount[], names: Map<string, string>): GuideAccount[] {
  if (names.size === 0) return accounts;
  return accounts.map(account => {
    const name = names.get(rosterKeyOf(account));
    if (!name) return account;
    if (account.kind === 'student') return { ...account, name };
    if (account.kind === 'parent') return { ...account, childName: name };
    return account;
  });
}
