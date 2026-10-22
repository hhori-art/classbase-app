/**
 * 授業の発言チェック（文字起こしから、保護者が聞いたら問題になる発言・NGワードを見つける）。
 * Zoom のクラウド録画の文字起こし（WebVTT、「話者: 発言」）を読み、言葉の一覧と照らし合わせる。
 * 講師の授業を評価する仕組みの第一段階。純粋関数だけを置き、サーバー処理は lib/server/lesson-transcript-check.ts。
 */

export type LessonCue = { start: number; end: number; speaker: string; text: string };

export type LanguageCategory = 'abuse' | 'discrimination' | 'threat' | 'negative' | 'dismissive' | 'tone' | 'private_contact' | 'inappropriate';
export type LanguageSeverity = 'high' | 'medium' | 'low';

export const LANGUAGE_CATEGORY_LABELS: Record<LanguageCategory, string> = {
  abuse: '暴言・人格否定',
  discrimination: '差別・偏見',
  threat: '脅し・体罰',
  negative: '否定的な決めつけ',
  dismissive: '学習を軽く扱う発言',
  tone: '乱暴な言葉づかい',
  private_contact: '生徒との私的な連絡',
  inappropriate: '授業にふさわしくない話題',
};

export const LANGUAGE_SEVERITY_LABELS: Record<LanguageSeverity, string> = { high: '重大', medium: '要注意', low: '参考' };

export type LanguageRule = {
  id: string;
  /** 一覧に出す言葉。 */
  label: string;
  /** 照合に使う正規表現（ひらがなにそろえた文に当てる）。省略すると label をそのまま探す。 */
  pattern?: string;
  category: LanguageCategory;
  severity: LanguageSeverity;
};

/**
 * 既定の言葉の一覧。pattern は「全角半角だけをそろえた文」（カタカナはカタカナのまま）に当てる。
 * 文字起こしは単語の間に空白がないため、ひらがなにそろえて探すと「どんなグループ」の「なぐる」、
 * 「覚えろ」の「えろ」のように単語をまたいで誤検知する。そのため：
 *  - カタカナ語（バカ・カス・ブスなど）は前後がカタカナでないこと（K）を条件にする
 *  - ひらがなの言葉は、悪口として使う形（「ばかじゃ」「あほか」など）だけにする
 *  - 授業の内容でも使う言葉（殺菌の「殺す」、「稲作に向いてない」、「終わってる人は」）は、人に向けた形だけにする
 */
const K = '[ァ-ヶー]';
export const DEFAULT_LANGUAGE_RULES: LanguageRule[] = [
  // 暴言・人格否定
  { id: 'baka', label: 'バカ・馬鹿', pattern: `(?<!${K})バカ(?!${K})|馬鹿|ばか(じゃ|やろ|やな|だな|だろ|か[?？。!！]|なの|にすん|にして)`, category: 'abuse', severity: 'high' },
  { id: 'aho', label: 'アホ', pattern: `(?<!${K})アホ(?!${K})|阿呆|あほ(か|や|ちゃう|だな|じゃ|すぎ)`, category: 'abuse', severity: 'high' },
  { id: 'kuzu', label: 'クズ', pattern: `(?<!${K})クズ(?!${K})|人間の屑`, category: 'abuse', severity: 'high' },
  { id: 'gomi', label: 'ゴミ（人に対して）', pattern: '(お前|おまえ|君|きみ|あなた|こいつ|あいつ)(は|も)?(ゴミ|ごみ)', category: 'abuse', severity: 'high' },
  { id: 'kasu', label: 'カス', pattern: `(?<!${K})カス(?!${K})`, category: 'abuse', severity: 'medium' },
  { id: 'shine', label: '死ね', pattern: '死ね(?!ば|る|ない)|しねよ|しねや', category: 'abuse', severity: 'high' },
  { id: 'kiero', label: '消えろ・失せろ', pattern: '(?<!字が|文字が|色が|火が|炎が)消えろ|失せろ|うせろ', category: 'abuse', severity: 'high' },
  { id: 'uzai', label: 'うざい', pattern: `(?<![ぁ-ん])うざ(い|っ|すぎ)|(?<!${K})ウザ(い|っ|すぎ|(?!${K}))`, category: 'abuse', severity: 'high' },
  { id: 'kimoi', label: 'キモい', pattern: `(?<![ぁ-ん])きも(い|っ|すぎ)|(?<!${K})キモ(い|っ|すぎ|(?!${K}))`, category: 'abuse', severity: 'high' },
  { id: 'damare', label: '黙れ', pattern: '黙れ|だまれ', category: 'abuse', severity: 'high' },
  { id: 'atamawarui', label: '頭が悪い', pattern: '頭(が)?悪(い|すぎ)|あたま(が)?わる(い|すぎ)', category: 'abuse', severity: 'high' },
  { id: 'tsukaenai', label: '使えない・役立たず', pattern: '使えない(やつ|奴)|役立たず|やくたたず', category: 'abuse', severity: 'high' },
  { id: 'busu', label: 'ブス・デブ・ハゲ（容姿）', pattern: `(?<!${K})(ブス|デブ|ハゲ)(?!${K})`, category: 'abuse', severity: 'high' },
  // 差別・偏見
  { id: 'gaiji', label: '障害に関する差別語', pattern: `(?<!${K})ガイジ(?!${K})|池沼|かたわ|めくら|つんぼ`, category: 'discrimination', severity: 'high' },
  { id: 'gender', label: '「女のくせに」など性別の決めつけ', pattern: '(女|おんな|男|おとこ)(のくせに|なんだから|だから(できない|無理|むり))', category: 'discrimination', severity: 'high' },
  // 脅し・体罰
  { id: 'korosu', label: '殺すぞ（脅し）', pattern: '殺すぞ|ころすぞ|殺してやる|ころしてやる|ぶっころ|ぶっ殺', category: 'threat', severity: 'high' },
  { id: 'naguru', label: '殴る・叩く・しばく', pattern: '殴る|殴っ|殴ら|ぶん殴|叩くぞ|たたくぞ|しばくぞ|しばいたろ|シバく', category: 'threat', severity: 'high' },
  { id: 'taijuku', label: '退塾させる・親に言う（脅し）', pattern: '退塾させ|辞めさせるぞ|やめさせるぞ|親に(言う|いう|言いつけ)ぞ', category: 'threat', severity: 'medium' },
  // 否定的な決めつけ
  { id: 'muri', label: '「お前には無理」など', pattern: '(お前|おまえ|君|きみ|あなた)(に|には|じゃ|では)(は)?(無理|むり)', category: 'negative', severity: 'high' },
  { id: 'dekiruwakenai', label: 'できるわけない・受かるわけない', pattern: 'できるわけ(が)?ない|できっこない|受かるわけ(が)?ない|うかるわけ(が)?ない', category: 'negative', severity: 'high' },
  { id: 'sainou', label: '才能・センスがない', pattern: '(才能|さいのう|センス)(が)?ない', category: 'negative', severity: 'medium' },
  { id: 'mukanai', label: '向いてない・諦めろ（人に対して）', pattern: '(お前|おまえ|君|きみ|あなた).{0,6}(向いてない|むいてない)|諦めろ|あきらめろ', category: 'negative', severity: 'medium' },
  { id: 'nankai', label: '何回言ったらわかる', pattern: '(何回|何度|なんかい|なんど)(言|い)ったら', category: 'negative', severity: 'medium' },
  { id: 'fuzakeru', label: 'ふざけるな・いい加減にしろ', pattern: 'ふざけるな|ふざけんな|いい加減にしろ|いいかげんにしろ', category: 'negative', severity: 'medium' },
  { id: 'owatteru', label: '終わってる（人に対して）', pattern: '(人生|お前|おまえ|君|きみ|あいつ|こいつ)(は|も)?(もう)?終わってる', category: 'negative', severity: 'medium' },
  { id: 'douse', label: 'どうせ（否定的に）', pattern: 'どうせ(お前|おまえ|君|きみ|無理|むり|できない|でけへん|わからない|わからん)', category: 'negative', severity: 'medium' },
  // 学習を軽く扱う発言。「細かく覚えなくていい」のように優先順位を伝える使い方も多いので、
  // 「こんなの」「意味ない」などと一緒に言ったときは要注意、「覚えなくていい」だけは参考にする（「こんなの」付きと二重に数えない）。
  { id: 'konnanooboe', label: '「こんなの覚えなくていい」など', pattern: '(こんなの|こんなん|こんなもん|こんなこと|そんなの|そんなん|そんなもん)(は|なんか|なんて)?(別に|べつに)?(覚え|おぼえ)(なくて|なくても|んでも|んくても|んで)(も)?(いい|いー|ええ|大丈夫|だいじょうぶ)', category: 'dismissive', severity: 'medium' },
  { id: 'imiganai', label: '勉強しても意味ない・無駄', pattern: '(こんなの|こんなん|こんなもん|こんなこと|そんなの|そんなん|そんなもん|勉強|べんきょう|覚えても|おぼえても|やっても)(なんか|なんて|は|って)?((意味|いみ)(が|は)?(ない|ねえ|ねー|ありません)|(無駄|むだ)(だ|です|やで|やん|じゃん))', category: 'dismissive', severity: 'medium' },
  { id: 'yakunitatanai', label: '勉強なんか役に立たない', pattern: '(こんなの|こんなん|こんなもん|こんなこと|そんなの|そんなん|そんなもん|勉強|べんきょう)(なんか|なんて|は)?(将来)?(役に立た|やくにたた|使わ|つかわ)(ない|ねえ|へん)', category: 'dismissive', severity: 'medium' },
  { id: 'doudemoii', label: '「こんなのどうでもいい」など', pattern: '(こんなの|こんなん|こんなもん|こんなこと|そんなの|そんなん|そんなもん|勉強|べんきょう)(なんか|なんて|は)?どうでもいい', category: 'dismissive', severity: 'medium' },
  { id: 'oboenakuteii', label: '覚えなくていい', pattern: '(?<!(こんなの|こんなん|こんなもん|こんなこと|そんなの|そんなん|そんなもん)(は|なんか|なんて)?(別に|べつに)?)(覚え|おぼえ)(なくて|なくても|んでも|んくても)(いい|いー|ええ|大丈夫|だいじょうぶ)|(覚え|おぼえ)る(必要|ひつよう)(は|も)?ない', category: 'dismissive', severity: 'low' },
  // 乱暴な言葉づかい
  { id: 'omae', label: 'お前', pattern: 'お前|おまえ', category: 'tone', severity: 'low' },
  { id: 'temee', label: 'てめえ・貴様', pattern: `てめえ|てめー|てめぇ|(?<!${K})テメ(エ|ー|ェ)|貴様`, category: 'tone', severity: 'medium' },
  // 生徒との私的な連絡
  { id: 'line', label: 'LINE・インスタ等の個人的な交換', pattern: '(line|ライン|インスタ|ディスコ|tiktok)(の(id|アカウント))?(を)?(教え|おしえ|交換|こうかん|追加して|ついかして)', category: 'private_contact', severity: 'medium' },
  { id: 'kojinteki', label: '個人的に会う・連絡する', pattern: '個人的に(会|あ|連絡|れんらく)|(二人|ふたり)(きり)?で(会|あ)おう', category: 'private_contact', severity: 'medium' },
  // 授業にふさわしくない話題
  { id: 'sexual', label: '性的な話題', pattern: `(?<!${K})エロ(い|(?!${K}))|えろい|セックス|下ネタ|しもネタ|おっぱい`, category: 'inappropriate', severity: 'medium' },
  { id: 'gamble', label: 'ギャンブル・飲酒の話', pattern: 'パチンコ|パチスロ|競馬|二日酔い|酔っぱら|よっぱら', category: 'inappropriate', severity: 'low' },
];

/** 既定の言葉を当てる文（全角半角をそろえ、英字は小文字、空白は除く。カナはそのまま）。 */
export function normalizeForRule(value: string) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
}

/** 照合用に文をそろえる（全角半角・カタカナ→ひらがな・空白除去・英字は小文字）。 */
export function normalizeForMatch(value: string) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, char => String.fromCharCode(char.charCodeAt(0) - 0x60))
    .replace(/\s+/g, '');
}

const timeToSeconds = (value: string) => {
  const match = value.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/);
  if (!match) return NaN;
  return Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4].padEnd(3, '0')) / 1000;
};

/** WebVTT（Zoom の文字起こし）を、時刻・話者・発言の一覧にする。 */
export function parseWebVtt(text: string): LessonCue[] {
  const cues: LessonCue[] = [];
  const blocks = String(text || '').replace(/\r/g, '').split(/\n\n+/);
  for (const block of blocks) {
    const lines = block.split('\n').map(line => line.trim()).filter(Boolean);
    const timingIndex = lines.findIndex(line => line.includes('-->'));
    if (timingIndex < 0) continue;
    const [startText, endText] = lines[timingIndex].split('-->');
    const start = timeToSeconds(startText);
    const end = timeToSeconds((endText || '').trim().split(/\s+/)[0] || '');
    const body = lines.slice(timingIndex + 1).join(' ');
    if (!body || !Number.isFinite(start)) continue;
    const speakerMatch = body.match(/^([^:：]{1,60})[:：]\s*(.*)$/);
    cues.push({
      start,
      end: Number.isFinite(end) ? end : start,
      speaker: speakerMatch ? speakerMatch[1].trim() : '',
      text: (speakerMatch ? speakerMatch[2] : body).trim(),
    });
  }
  return cues;
}

export type LanguageFinding = {
  rule_id: string;
  label: string;
  category: LanguageCategory;
  severity: LanguageSeverity;
  time: number;
  speaker: string;
  text: string;
  /** 前後の発言（判断しやすいように、前後1つずつ）。 */
  before: string;
  after: string;
};

const compileRule = (rule: LanguageRule) => {
  try {
    // 既定の言葉（pattern あり）はカナをそのまま、管理画面で足した言葉はひらがなにそろえて探す。
    return new RegExp(rule.pattern || normalizeForMatch(rule.label).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u');
  } catch {
    return null;
  }
};

/** 発言の一覧から、言葉の一覧に当たる発言を見つける。1つの発言で同じ言葉は1回だけ数える。 */
export function detectLanguage(cues: LessonCue[], rules: LanguageRule[]): LanguageFinding[] {
  const compiled = rules.map(rule => ({ rule, regex: compileRule(rule) })).filter(item => item.regex);
  const findings: LanguageFinding[] = [];
  cues.forEach((cue, index) => {
    const forRule = normalizeForRule(cue.text);
    const folded = normalizeForMatch(cue.text);
    if (!forRule) return;
    compiled.forEach(({ rule, regex }) => {
      if (!regex!.test(rule.pattern ? forRule : folded)) return;
      findings.push({
        rule_id: rule.id,
        label: rule.label,
        category: rule.category,
        severity: rule.severity,
        time: Math.round(cue.start),
        speaker: cue.speaker,
        text: cue.text.slice(0, 300),
        before: (cues[index - 1]?.text || '').slice(0, 200),
        after: (cues[index + 1]?.text || '').slice(0, 200),
      });
    });
  });
  return findings;
}

export function summarizeFindings(findings: LanguageFinding[]) {
  const bySeverity: Record<LanguageSeverity, number> = { high: 0, medium: 0, low: 0 };
  const byCategory: Partial<Record<LanguageCategory, number>> = {};
  findings.forEach(finding => {
    bySeverity[finding.severity] += 1;
    byCategory[finding.category] = (byCategory[finding.category] || 0) + 1;
  });
  return { total: findings.length, by_severity: bySeverity, by_category: byCategory };
}

/** 管理画面で追加した言葉と、止めた既定の言葉を反映した一覧。 */
export function effectiveLanguageRules(settings: { custom?: unknown; disabled?: unknown } | null | undefined): LanguageRule[] {
  const disabled = new Set(Array.isArray(settings?.disabled) ? settings!.disabled.map(String) : []);
  const custom: LanguageRule[] = (Array.isArray(settings?.custom) ? settings!.custom : [])
    .map((item: any, index: number) => ({
      id: `custom_${String(item?.id || index)}`.slice(0, 60),
      label: String(item?.label || '').trim().slice(0, 40),
      category: (Object.keys(LANGUAGE_CATEGORY_LABELS).includes(item?.category) ? item.category : 'negative') as LanguageCategory,
      severity: (['high', 'medium', 'low'].includes(item?.severity) ? item.severity : 'medium') as LanguageSeverity,
    }))
    .filter((rule: LanguageRule) => rule.label);
  return [...DEFAULT_LANGUAGE_RULES.filter(rule => !disabled.has(rule.id)), ...custom];
}

/** 秒を「12:34」のような授業内の時刻にする。 */
export const lessonTimeLabel = (seconds: number) => {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}` : `${minutes}:${String(secs).padStart(2, '0')}`;
};
