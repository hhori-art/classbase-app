const CLASS_DAY_ORDER = ['日', '月', '火', '水', '木', '金', '土'] as const;

export const parseClassDays = (value: unknown): string[] => {
  const values = Array.isArray(value) ? value : [value];
  const found = new Set<string>();

  values.forEach(item => {
    const normalized = String(item || '').normalize('NFKC').replace(/曜日/g, '');
    const matches = normalized.match(/[日月火水木金土]/g) || [];
    matches.forEach(day => found.add(day));
  });

  return CLASS_DAY_ORDER.filter(day => found.has(day));
};

export const formatClassDays = (value: unknown, separator = '・') => (
  parseClassDays(value).join(separator)
);
