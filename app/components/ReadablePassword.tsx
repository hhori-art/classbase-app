type ReadablePasswordProps = {
  value?: string;
  placeholder?: string;
  compact?: boolean;
};

const passwordFont = {
  fontFamily: '"Verdana", "Arial", "Helvetica Neue", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontVariantNumeric: 'tabular-nums',
  fontFeatureSettings: '"tnum" 1, "zero" 1',
};

const splitPassword = (value: string) => value.match(/.{1,4}/g) || [value];

export default function ReadablePassword({
  value,
  placeholder = '********',
  compact = false,
}: ReadablePasswordProps) {
  const displayValue = String(value || placeholder).trim() || placeholder;
  const chunks = splitPassword(displayValue);

  return (
    <div className="inline-flex max-w-full flex-col gap-1">
      <p
        aria-label={displayValue}
        className={`inline-flex max-w-full flex-wrap items-center gap-1.5 rounded-xl border-2 border-blue-200 bg-white px-3 text-gray-950 shadow-sm ${
          compact ? 'py-1.5 text-lg' : 'py-2 text-2xl'
        }`}
        style={passwordFont}
      >
        {chunks.map((chunk, index) => (
          <span
            key={`${chunk}-${index}`}
            className="rounded-md bg-blue-50 px-1.5 font-black leading-tight tracking-[0.18em]"
          >
            {chunk}
          </span>
        ))}
      </p>
      {value && (
        <p className="text-[9px] font-black leading-tight text-slate-500">
          ※4文字ごとに区切って表示しています。入力時にスペースは不要です。
        </p>
      )}
    </div>
  );
}
