import { ONLINE_SCHOOL_CONFIG, xpRequiredForLevel } from './config';
import type {
  CategoryProgress, GeneratedProblem, LevelResult, OnlineSchoolSubjectId,
  ProblemTemplate, ProblemType, RecentAnswer, XpInput,
} from './types';

const integer = (min: number, max: number, random: () => number) =>
  Math.floor(random() * (max - min + 1)) + min;

const mathTemplate = (
  id: string, categoryId: string, categoryName: string, levelMin: number, levelMax: number,
  problemType: ProblemType,
  factory: (level: number, random: () => number) => Omit<GeneratedProblem, 'templateId' | 'subjectId' | 'categoryId' | 'categoryName' | 'level' | 'difficulty' | 'problemType' | 'signature'>,
): ProblemTemplate => ({
  id, subjectId: 'math', categoryId, categoryName, levelMin, levelMax, problemType,
  generate(level, random) {
    const value = factory(level, random);
    return {
      ...value, templateId: id, subjectId: 'math', categoryId, categoryName, level,
      difficulty: Math.max(1, Math.ceil(level / 6)), problemType,
      signature: `${id}:${value.prompt.replace(/\d+/g, '#')}`,
    };
  },
});

const choiceProblem = (prompt: string, correct: string, wrong: string[], explanation: string, random: () => number) => {
  const choices = [...new Set([correct, ...wrong])].slice(0, 4).sort(() => random() - 0.5);
  return { prompt, correctAnswer: correct, choices, explanation };
};

export const PROBLEM_TEMPLATES: ProblemTemplate[] = [
  mathTemplate('math-add', 'addition', 'たし算', 1, 6, 'number_input', (level, random) => {
    const max = level < 3 ? 10 : level < 6 ? 50 : 100;
    const a = integer(1, max, random); const b = integer(1, max, random);
    return { prompt: `${a} + ${b} = ?`, correctAnswer: String(a + b), explanation: `${a}と${b}をたすと${a + b}です。` };
  }),
  mathTemplate('math-subtract', 'subtraction', 'ひき算', 2, 7, 'number_input', (level, random) => {
    const max = level < 5 ? 30 : 100; const a = integer(3, max, random); const b = integer(1, a, random);
    return { prompt: `${a} − ${b} = ?`, correctAnswer: String(a - b), explanation: `${a}から${b}をひくと${a - b}です。` };
  }),
  mathTemplate('math-multiply', 'multiplication', 'かけ算', 4, 10, 'number_input', (_level, random) => {
    const a = integer(2, 12, random); const b = integer(2, 12, random);
    return { prompt: `${a} × ${b} = ?`, correctAnswer: String(a * b), explanation: `${a}を${b}回たすと${a * b}です。` };
  }),
  mathTemplate('math-divide', 'division', 'わり算', 6, 12, 'number_input', (_level, random) => {
    const b = integer(2, 12, random); const answer = integer(2, 12, random); const a = b * answer;
    return { prompt: `${a} ÷ ${b} = ?`, correctAnswer: String(answer), explanation: `${b} × ${answer} = ${a}なので、答えは${answer}です。` };
  }),
  mathTemplate('math-decimal', 'decimal', '小数', 9, 16, 'number_input', (_level, random) => {
    const a = integer(11, 99, random) / 10; const b = integer(1, 9, random) / 10;
    const answer = Number((a + b).toFixed(1));
    return { prompt: `${a} + ${b} = ?`, correctAnswer: String(answer), explanation: '小数点の位置をそろえて計算します。' };
  }),
  mathTemplate('math-fraction', 'fraction', '分数', 12, 20, 'multiple_choice', (_level, random) => {
    const denominator = integer(3, 9, random); const a = integer(1, denominator - 1, random); const b = integer(1, denominator - 1, random);
    const numerator = a + b;
    return choiceProblem(`${a}/${denominator} + ${b}/${denominator} は？`, `${numerator}/${denominator}`, [`${numerator + 1}/${denominator}`, `${Math.max(1, numerator - 1)}/${denominator}`, `${numerator}/${denominator + 1}`], '分母が同じ分数は、分子どうしをたします。', random);
  }),
  mathTemplate('math-ratio', 'ratio', '割合・比', 16, 23, 'number_input', (_level, random) => {
    const base = integer(2, 12, random) * 10; const percent = [10, 20, 25, 50][integer(0, 3, random)];
    return { prompt: `${base}の${percent}%はいくつ？`, correctAnswer: String(base * percent / 100), explanation: `${base} × ${percent} ÷ 100で求めます。` };
  }),
  mathTemplate('math-signed', 'signed_number', '正負の数', 20, 27, 'number_input', (_level, random) => {
    const a = integer(-12, 12, random); const b = integer(-12, 12, random);
    return { prompt: `(${a}) + (${b}) = ?`, correctAnswer: String(a + b), explanation: '符号に注意して数直線をイメージします。' };
  }),
  mathTemplate('math-equation', 'equation', '方程式', 23, 38, 'number_input', (level, random) => {
    const x = integer(1, Math.min(20, level), random); const a = integer(2, 9, random); const b = integer(1, 15, random); const c = a * x + b;
    return { prompt: `${a}x + ${b} = ${c} のとき、x = ?`, correctAnswer: String(x), explanation: `両辺から${b}をひき、${a}でわります。` };
  }),
  mathTemplate('math-function', 'function', '関数', 27, 46, 'number_input', (level, random) => {
    const a = integer(2, Math.min(8, Math.ceil(level / 5) + 2), random); const x = integer(-5, 8, random);
    return { prompt: `y = ${a}x + 1。x = ${x} のとき y = ?`, correctAnswer: String(a * x + 1), explanation: `式のxに${x}を代入します。` };
  }),
  mathTemplate('math-simultaneous', 'simultaneous_equations', '連立方程式', 31, 38, 'multiple_choice', (_level, random) => {
    const x = integer(1, 9, random); const y = integer(1, 9, random);
    return choiceProblem(
      `x + y = ${x + y}、2x + y = ${2 * x + y} のとき、xとyは？`,
      `x=${x}, y=${y}`,
      [`x=${y}, y=${x}`, `x=${x + 1}, y=${Math.max(0, y - 1)}`, `x=${Math.max(0, x - 1)}, y=${y + 1}`],
      '2つ目の式から1つ目の式を引くとxが求まり、その値を最初の式へ代入するとyが求まります。', random,
    );
  }),
  mathTemplate('math-linear-function', 'linear_function', '一次関数', 39, 46, 'number_input', (_level, random) => {
    const slope = integer(-5, 6, random) || 2; const intercept = integer(-6, 6, random);
    return {
      prompt: `一次関数 y = ${slope}x ${intercept >= 0 ? '+' : '−'} ${Math.abs(intercept)} の傾きはいくつ？`,
      correctAnswer: String(slope), explanation: 'y=ax+bのaが傾きです。',
    };
  }),
  mathTemplate('math-geometry-angle', 'geometry', '図形', 47, 54, 'number_input', (_level, random) => {
    const a = integer(25, 75, random); const b = integer(25, Math.min(90, 145 - a), random); const answer = 180 - a - b;
    return { prompt: `三角形の2つの内角が${a}°と${b}°です。残りの角は何度？`, correctAnswer: String(answer), explanation: `三角形の内角の和180°から${a}°と${b}°を引きます。` };
  }),
  mathTemplate('math-square-root', 'square_root', '平方根', 55, 62, 'multiple_choice', (_level, random) => {
    const root = integer(2, 6, random); const remainder = [2, 3, 5, 6, 7, 10][integer(0, 5, random)];
    const correct = `${root}√${remainder}`;
    return choiceProblem(
      `√${root * root * remainder} を簡単にすると？`, correct,
      [`${root * remainder}√${remainder}`, `√${root * remainder}`, `${root}√${remainder + 1}`],
      `根号の中を${root * root}×${remainder}に分けると、√${root * root}=${root}なので${correct}です。`, random,
    );
  }),
  mathTemplate('math-quadratic', 'quadratic_equation', '二次方程式', 63, 70, 'number_input', (_level, random) => {
    const p = integer(1, 7, random); const q = integer(p + 1, 10, random);
    return { prompt: `(x − ${p})(x − ${q}) = 0 の解のうち、大きい方は？`, correctAnswer: String(q), explanation: `積が0なのでx=${p}またはx=${q}です。` };
  }),
  mathTemplate('math-factorization', 'factorization', '因数分解', 71, 78, 'multiple_choice', (_level, random) => {
    const p = integer(1, 7, random); const q = integer(p + 1, 9, random); const middle = p + q; const constant = p * q;
    return choiceProblem(
      `x² + ${middle}x + ${constant} を因数分解すると？`, `(x + ${p})(x + ${q})`,
      [`(x − ${p})(x − ${q})`, `(x + ${middle})(x + ${constant})`, `(x + ${p - 1})(x + ${q + 1})`],
      `和が${middle}、積が${constant}になる2数は${p}と${q}です。`, random,
    );
  }),
  mathTemplate('math-pythagorean', 'pythagorean', '三平方の定理', 79, 86, 'number_input', (_level, random) => {
    const triples = [[3, 4, 5], [5, 12, 13], [8, 15, 17], [7, 24, 25]] as const;
    const [a, b, c] = triples[integer(0, triples.length - 1, random)];
    return { prompt: `直角をはさむ2辺が${a}cmと${b}cmの直角三角形があります。斜辺は何cm？`, correctAnswer: String(c), explanation: `${a}²+${b}²=${c}²より、斜辺は${c}cmです。` };
  }),
  mathTemplate('math-exponent', 'exponent', '指数法則', 87, 94, 'multiple_choice', (_level, random) => {
    const base = integer(2, 5, random); const m = integer(2, 5, random); const n = integer(2, 5, random);
    return choiceProblem(
      `${base}^${m} × ${base}^${n} を指数を使って表すと？`, `${base}^${m + n}`,
      [`${base}^${m * n}`, `${base * 2}^${m + n}`, `${base}^${Math.abs(m - n)}`],
      '底が同じ数の積では、指数どうしを足します。', random,
    );
  }),
  mathTemplate('math-probability', 'probability', '確率', 95, 100, 'multiple_choice', (_level, random) => {
    const red = integer(1, 4, random); const blue = red + integer(1, 4, random); const total = red + blue;
    const divisor = (a: number, b: number): number => b === 0 ? a : divisor(b, a % b);
    const gcd = divisor(red, total); const correct = `${red / gcd}/${total / gcd}`;
    return choiceProblem(
      `袋に赤玉が${red}個、青玉が${blue}個あります。1個取り出すとき、赤玉である確率は？`, correct,
      [`${blue}/${total}`, `1/${total}`, `${red}/${blue}`],
      `全${total}個のうち赤玉は${red}個なので、約分すると${correct}です。`, random,
    );
  }),
  mathTemplate('math-statistics', 'statistics', 'データの分析', 95, 100, 'number_input', (_level, random) => {
    const center = integer(10, 40, random); const difference = integer(2, 8, random);
    return { prompt: `${center - difference}、${center}、${center + difference} の平均値は？`, correctAnswer: String(center), explanation: '3つの値の合計を3で割ります。中央の値を中心に左右対称なので、平均値は中央の値と同じです。' };
  }),
];

const japaneseBanks = [
  { id: 'kana', name: 'かな', min: 1, max: 5, rows: [
    ['「ねこ」をカタカナで書くと？', 'ネコ', ['ネゴ', 'ネコー', 'ねコ'], 'カタカナでは「ネコ」と書きます。'],
    ['「あさ」の反対に近いことばは？', 'よる', ['ひる', 'そら', 'うみ'], '一日の時間として、朝の反対に近いのは夜です。'],
  ] },
  { id: 'kanji', name: '漢字', min: 4, max: 14, rows: [
    ['「山」の読みとして正しいものは？', 'やま', ['かわ', 'そら', 'もり'], '「山」は「やま」と読みます。'],
    ['「友情」の「友」の読みは？', 'ゆう', ['ともだち', 'じょう', 'きょう'], '熟語「友情」では「友」を「ゆう」と読みます。'],
  ] },
  { id: 'vocabulary', name: 'ことば', min: 7, max: 18, rows: [
    ['「大切」と意味が近いことばは？', '重要', ['不要', '簡単', '静か'], '「大切」と「重要」は意味が近いことばです。'],
    ['「増加」の反対の意味のことばは？', '減少', ['上昇', '成長', '追加'], '増えることの反対は、減ること（減少）です。'],
  ] },
  { id: 'grammar', name: '文法', min: 12, max: 25, rows: [
    ['「鳥が空を飛ぶ。」の主語は？', '鳥が', ['空を', '飛ぶ', '空'], '「だれが・なにが」に当たる「鳥が」が主語です。'],
    ['「とても美しい花」の「とても」が修飾する語は？', '美しい', ['花', 'とても', '美しい花'], '「とても」は程度を表し、「美しい」を詳しくします。'],
  ] },
  { id: 'connective', name: '接続語', min: 17, max: 28, rows: [
    ['雨が降っていた。（　）、試合は行われた。', 'しかし', ['だから', 'そして', 'たとえば'], '前後が反対の内容なので「しかし」が合います。'],
    ['練習を続けた。（　）、記録が伸びた。', 'その結果', ['しかし', 'ところで', 'または'], '原因と結果をつなぐ「その結果」が合います。'],
  ] },
  { id: 'reading', name: '読解', min: 22, max: 38, rows: [
    ['本文で筆者が最も伝えたいことは？', '小さな継続が力になる', ['速さだけが大切', '失敗してはいけない', '一人で学ぶべき'], '最後の文に、本文全体の要点がまとめられています。'],
    ['主人公が安心した理由は？', '友だちが戻ってきたから', ['雨がやんだから', '宿題が終わったから', '電車が来たから'], '直前の出来事と主人公の気持ちの変化を結びつけます。'],
  ] },
] as const;

for (const bank of japaneseBanks) {
  PROBLEM_TEMPLATES.push({
    id: `japanese-${bank.id}`, subjectId: 'japanese', categoryId: bank.id,
    categoryName: bank.name, levelMin: bank.min, levelMax: bank.max, problemType: 'multiple_choice',
    generate(level, random) {
      const row = bank.rows[integer(0, bank.rows.length - 1, random)];
      const passage = bank.id === 'reading'
        ? (row[0].includes('筆者') ? '毎日少しずつ続けることは、すぐには成果が見えなくても、やがて大きな力になる。' : '雨の中で待っていると、友だちが走って戻ってきた。主人公はほっと息をついた。')
        : undefined;
      const value = choiceProblem(row[0], row[1], [...row[2]], row[3], random);
      return { ...value, passage, templateId: `japanese-${bank.id}`, subjectId: 'japanese', categoryId: bank.id, categoryName: bank.name, level, difficulty: Math.max(1, Math.ceil(level / 6)), problemType: 'multiple_choice', signature: `japanese-${bank.id}:${row[0]}` };
    },
  });
}

const advancedJapaneseBanks = [
  { id: 'parts_of_speech', name: '品詞・文の成分', min: 29, max: 38, rows: [
    { prompt: '「静かな町をゆっくり歩く。」で、動作の様子を表す修飾語は？', answer: 'ゆっくり', wrong: ['静かな', '町を', '歩く'], explanation: '「ゆっくり」は、どのように歩くかを詳しくする副詞です。' },
    { prompt: '「美しい」の品詞は？', answer: '形容詞', wrong: ['形容動詞', '副詞', '連体詞'], explanation: '「美しい」は言い切りが「い」で終わり、性質や状態を表す形容詞です。' },
  ] },
  { id: 'paragraph_structure', name: '文章構成', min: 39, max: 48, rows: [
    { passage: '私は朝の読書を勧めたい。短い時間でも毎日続ければ、多くの言葉に出会えるからだ。', prompt: 'この文章の「理由」に当たる部分は？', answer: '短い時間でも毎日続ければ、多くの言葉に出会えるからだ', wrong: ['私は', '朝の読書', '勧めたい'], explanation: '「からだ」で結ばれた後半が、筆者の主張を支える理由です。' },
    { passage: 'まず材料をそろえる。次に、大きさを測って切る。最後に、部品を組み立てる。', prompt: 'この文章で使われている構成は？', answer: '時間・手順の順序', wrong: ['原因と結果', '対比', '問いと答え'], explanation: '「まず・次に・最後に」が作業の順序を示しています。' },
  ] },
  { id: 'narrative_reading', name: '物語読解', min: 49, max: 58, rows: [
    { passage: '発表の直前、葵の手は震えていた。しかし、友人が小さくうなずくのを見ると、葵はまっすぐ前を向いた。', prompt: '葵が前を向けた理由として最も適切なものは？', answer: '友人の励ましを感じたから', wrong: ['発表が終わったから', '内容を忘れたから', '会場を出たかったから'], explanation: '友人のうなずきをきっかけに、葵の行動が変化しています。' },
    { passage: '健は空になった鳥かごを見つめた。窓の外で羽音がすると、寂しそうに笑った。', prompt: '健の気持ちとして最も適切なものは？', answer: '寂しいが、鳥の自由も受け入れている', wrong: ['鳥に腹を立てている', '何も感じていない', '鳥を捕まえようと喜んでいる'], explanation: '「空の鳥かご」「寂しそうに笑った」の両方から複雑な心情を読み取ります。' },
  ] },
  { id: 'explanatory_reading', name: '説明文読解', min: 59, max: 68, rows: [
    { passage: '森林は二酸化炭素を吸収するだけでなく、多くの生物のすみかにもなる。だから森林を守ることは、気候と生態系の両方を守ることにつながる。', prompt: '本文の要旨として最も適切なものは？', answer: '森林保全は気候と生態系の両方に重要だ', wrong: ['森林には生物がいない', '二酸化炭素だけを守るべきだ', '森林は人間に関係がない'], explanation: '最後の文が、前の内容をまとめた結論になっています。' },
    { passage: '同じ情報でも、図にすると全体の傾向が見えやすく、表にすると正確な数値を比べやすい。目的に応じて表現を選ぶ必要がある。', prompt: '図と表を使い分ける基準は？', answer: '情報を示す目的', wrong: ['文字の大きさ', '紙の色', '書き手の年齢'], explanation: '本文は「目的に応じて」と明示しています。' },
  ] },
  { id: 'logical_reading', name: '論理・主張', min: 69, max: 78, rows: [
    { passage: '便利な道具は時間を節約する。一方で、使い方を考えなければ集中を妨げることもある。したがって、道具を使わないのではなく、目的を決めて使うことが大切だ。', prompt: '筆者の主張は？', answer: '道具は目的を決めて使うべきだ', wrong: ['便利な道具をすべて捨てるべきだ', '集中する必要はない', '道具は必ず時間を浪費する'], explanation: '「したがって」の後に、筆者の結論が示されています。' },
    { passage: '運動には体力向上の効果がある。さらに、気分転換にもなる。この二つの点から、短時間でも運動を習慣にする価値がある。', prompt: '結論を支える根拠はいくつ示されている？', answer: '2つ', wrong: ['1つ', '3つ', '4つ'], explanation: '「体力向上」と「気分転換」の2つです。' },
  ] },
  { id: 'expression', name: '語彙・表現技法', min: 79, max: 88, rows: [
    { prompt: '「時間が飛ぶように過ぎた」で使われている表現技法は？', answer: '比喩', wrong: ['反復', '倒置', '体言止め'], explanation: '時間の速さを「飛ぶ」ことにたとえています。' },
    { prompt: '「石の上にも三年」の意味として最も適切なものは？', answer: '辛くても辛抱して続ければ成果につながる', wrong: ['石は三年で壊れる', 'すぐに諦める方がよい', '同じ場所から動いてはいけない'], explanation: '長く辛抱することの大切さを表すことわざです。' },
  ] },
  { id: 'critical_reading', name: '批判的読解', min: 89, max: 94, rows: [
    { passage: 'アンケートで回答した10人全員が商品Aを選んだ。だから、全国の全員が商品Aを選ぶはずだ。', prompt: 'この推論の問題点は？', answer: '調査人数が少なく、全国を代表しているとは限らない', wrong: ['数字を使っている', '商品名が短い', '全員が回答している'], explanation: '小さな標本の結果を、そのまま全国へ一般化しています。' },
    { passage: '昨年より図書館の利用者が増えた。同じ時期に開館時間も延長された。', prompt: '本文から確実に言えることは？', answer: '利用者増加と開館時間延長が同じ時期に起きた', wrong: ['開館時間延長だけが増加の原因だ', '全員が夜に利用した', '来年も必ず増加する'], explanation: '二つの出来事の関連は示されていますが、因果関係までは断定できません。' },
  ] },
  { id: 'advanced_reading', name: '発展読解', min: 95, max: 100, rows: [
    { passage: '効率とは、単に短い時間で終えることではない。目的に照らして必要な成果を得ながら、資源の使い方を整えることである。時間だけを削れば、かえって成果を損なう場合もある。', prompt: '筆者が否定している効率の捉え方は？', answer: '時間を短くすることだけを効率と考えること', wrong: ['目的を確認すること', '成果と資源の両方を考えること', '方法を見直すこと'], explanation: '冒頭の「単に〜ではない」と最後の文から読み取れます。' },
    { passage: '異なる意見との対話は、自分の考えを捨てるために行うのではない。前提を確かめ、考えの弱い部分を補い、より妥当な結論へ近づくために行うのである。', prompt: '本文における対話の目的は？', answer: '考えを検討し、より妥当な結論へ近づくこと', wrong: ['自分の意見を必ず捨てること', '相手を言い負かすこと', '結論を出さないこと'], explanation: '最終文に対話の目的が三段階で示されています。' },
  ] },
] as const;

for (const bank of advancedJapaneseBanks) {
  PROBLEM_TEMPLATES.push({
    id: `japanese-${bank.id}`, subjectId: 'japanese', categoryId: bank.id,
    categoryName: bank.name, levelMin: bank.min, levelMax: bank.max, problemType: 'multiple_choice',
    generate(level, random) {
      const row = bank.rows[integer(0, bank.rows.length - 1, random)];
      const value = choiceProblem(row.prompt, row.answer, [...row.wrong], row.explanation, random);
      return {
        ...value, passage: 'passage' in row ? row.passage : undefined,
        templateId: `japanese-${bank.id}`, subjectId: 'japanese', categoryId: bank.id,
        categoryName: bank.name, level, difficulty: Math.max(1, Math.ceil(level / 6)),
        problemType: 'multiple_choice', signature: `japanese-${bank.id}:${row.prompt}`,
      };
    },
  });
}

export function availableTemplates(subjectId: OnlineSchoolSubjectId, level: number) {
  const subjectTemplates = PROBLEM_TEMPLATES.filter(template => template.subjectId === subjectId);
  const exact = subjectTemplates.filter(template => level >= template.levelMin && level <= template.levelMax);
  if (exact.length) return exact;
  const maximum = Math.max(...subjectTemplates.map(template => template.levelMax));
  return subjectTemplates.filter(template => template.levelMax === maximum);
}

export function selectNextProblem(input: {
  subjectId: OnlineSchoolSubjectId;
  studentLevel: number;
  categoryProgress?: CategoryProgress[];
  recentAnswers?: RecentAnswer[];
  random?: () => number;
}) {
  const random = input.random || Math.random;
  const templates = availableTemplates(input.subjectId, input.studentLevel);
  const recent = input.recentAnswers || [];
  const recentIds = new Set(recent.slice(-3).map(answer => answer.templateId));
  const weak = [...(input.categoryProgress || [])]
    .filter(item => item.answeredCount >= 3)
    .sort((a, b) => a.accuracy - b.accuracy)[0];
  const roll = random();
  let candidates = templates;
  if (weak && roll >= ONLINE_SCHOOL_CONFIG.selectionWeights.currentLevel && roll < ONLINE_SCHOOL_CONFIG.selectionWeights.currentLevel + ONLINE_SCHOOL_CONFIG.selectionWeights.weakCategory) {
    const weakCandidates = PROBLEM_TEMPLATES.filter(template => template.subjectId === input.subjectId && template.categoryId === weak.categoryId && template.levelMin <= input.studentLevel);
    if (weakCandidates.length) candidates = weakCandidates;
  } else if (roll >= ONLINE_SCHOOL_CONFIG.selectionWeights.currentLevel + ONLINE_SCHOOL_CONFIG.selectionWeights.weakCategory) {
    const review = PROBLEM_TEMPLATES.filter(template => template.subjectId === input.subjectId && template.levelMin <= Math.max(1, input.studentLevel - 3));
    if (review.length) candidates = review;
  }
  const notRecent = candidates.filter(template => !recentIds.has(template.id));
  const pool = notRecent.length ? notRecent : candidates;
  const template = pool[Math.floor(random() * pool.length)] || templates[0];
  return template.generate(input.studentLevel, random);
}

export function normalizeAnswer(value: unknown) {
  return String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, '').toLowerCase();
}

export function isCorrectAnswer(userAnswer: unknown, correctAnswer: unknown) {
  const user = normalizeAnswer(userAnswer); const correct = normalizeAnswer(correctAnswer);
  if (!user) return false;
  const userNumber = Number(user); const correctNumber = Number(correct);
  if (Number.isFinite(userNumber) && Number.isFinite(correctNumber)) return Math.abs(userNumber - correctNumber) < 1e-9;
  return user === correct;
}

export function calculateXP(input: XpInput) {
  if (!input.isCorrect) return 0;
  const { xp } = ONLINE_SCHOOL_CONFIG;
  const hard = input.difficulty >= xp.hardProblemFromDifficulty ? xp.hardProblem : 0;
  const streak = Math.min(xp.maximumStreakBonus, Math.floor(input.consecutiveCorrect / xp.streakEvery) * xp.streakBonus);
  return xp.correct + hard + streak;
}

export function calculateNextLevel(level: number, levelXp: number, earnedXp: number, recentResults: boolean[]): LevelResult {
  const window = recentResults.slice(-ONLINE_SCHOOL_CONFIG.recentAccuracyWindow);
  const accuracy = window.length ? window.filter(Boolean).length / window.length : 0;
  const eligible = window.length >= ONLINE_SCHOOL_CONFIG.levelUpMinimumAnswers && accuracy >= ONLINE_SCHOOL_CONFIG.levelUpAccuracy;
  let nextLevel = Math.max(1, level); let remainingXp = Math.max(0, levelXp) + earnedXp; let leveledUp = false;
  if (eligible && remainingXp >= xpRequiredForLevel(nextLevel)) {
    remainingXp -= xpRequiredForLevel(nextLevel); nextLevel += 1; leveledUp = true;
  }
  return { level: nextLevel, levelXp: remainingXp, leveledUp, reviewMode: window.length >= 5 && accuracy < ONLINE_SCHOOL_CONFIG.reviewModeAccuracy };
}

export function weakestCategories(items: CategoryProgress[], limit = 3) {
  return [...items].filter(item => item.answeredCount >= 2).sort((a, b) => a.accuracy - b.accuracy).slice(0, limit);
}

export function nextStudyStreak(lastStudyDate: string | null, currentStreak: number, today: string) {
  if (!lastStudyDate) return 1;
  if (lastStudyDate === today) return Math.max(1, currentStreak);
  const previous = new Date(`${lastStudyDate}T00:00:00Z`).getTime();
  const current = new Date(`${today}T00:00:00Z`).getTime();
  return current - previous === 86_400_000 ? Math.max(1, currentStreak) + 1 : 1;
}

export function idempotencyKey(sessionId: string, problemInstanceId: string, answerId: string) {
  return `${sessionId}:${problemInstanceId}:${answerId}`;
}
