import type { OnlineSchoolSubject } from './types';

export const ONLINE_SCHOOL_SUBJECTS: OnlineSchoolSubject[] = [
  {
    id: 'math',
    course: 'science',
    name: '算数・数学',
    shortName: '数学',
    description: '計算から図形・関数まで、今のLevelに合った問題に挑戦',
  },
  {
    id: 'japanese',
    course: 'humanities',
    name: '国語',
    shortName: '国語',
    description: 'ことば・漢字・文法・読解を少しずつ身につける',
  },
];

export const subjectById = (id: string) => ONLINE_SCHOOL_SUBJECTS.find(subject => subject.id === id);

export const ONLINE_SCHOOL_CATEGORIES: Record<string, Array<{ id: string; name: string }>> = {
  math: [
    { id: 'addition', name: 'たし算' }, { id: 'subtraction', name: 'ひき算' },
    { id: 'multiplication', name: 'かけ算' }, { id: 'division', name: 'わり算' },
    { id: 'decimal', name: '小数' }, { id: 'fraction', name: '分数' },
    { id: 'ratio', name: '割合・比' }, { id: 'signed_number', name: '正負の数' },
    { id: 'equation', name: '方程式' }, { id: 'function', name: '関数' },
    { id: 'simultaneous_equations', name: '連立方程式' }, { id: 'linear_function', name: '一次関数' },
    { id: 'geometry', name: '図形' }, { id: 'square_root', name: '平方根' },
    { id: 'quadratic_equation', name: '二次方程式' }, { id: 'factorization', name: '因数分解' },
    { id: 'pythagorean', name: '三平方の定理' }, { id: 'exponent', name: '指数法則' },
    { id: 'probability', name: '確率' }, { id: 'statistics', name: 'データの分析' },
  ],
  japanese: [
    { id: 'kana', name: 'かな' }, { id: 'kanji', name: '漢字' },
    { id: 'vocabulary', name: 'ことば' }, { id: 'grammar', name: '文法' },
    { id: 'connective', name: '接続語' }, { id: 'reading', name: '読解' },
    { id: 'parts_of_speech', name: '品詞・文の成分' }, { id: 'paragraph_structure', name: '文章構成' },
    { id: 'narrative_reading', name: '物語読解' }, { id: 'explanatory_reading', name: '説明文読解' },
    { id: 'logical_reading', name: '論理・主張' }, { id: 'expression', name: '語彙・表現技法' },
    { id: 'critical_reading', name: '批判的読解' }, { id: 'advanced_reading', name: '発展読解' },
  ],
};
