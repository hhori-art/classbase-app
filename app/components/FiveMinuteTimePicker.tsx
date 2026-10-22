'use client';

const HOURS = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, '0'));
const MINUTES = Array.from({ length: 12 }, (_, index) => String(index * 5).padStart(2, '0'));

export default function FiveMinuteTimePicker({ value, onChange, className, label = '時刻' }: {
  value: string;
  onChange: (value: string) => void;
  className: string;
  label?: string;
}) {
  const [hour = '', minute = ''] = /^\d{2}:\d{2}$/.test(value) ? value.split(':') : ['', ''];
  const selectClass = `${className} min-w-0`;

  return (
    <span className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1">
      <select
        aria-label={`${label}の時`}
        value={hour}
        onChange={event => onChange(event.target.value ? `${event.target.value}:${minute || '00'}` : '')}
        className={selectClass}
      >
        <option value="">時</option>
        {HOURS.map(item => <option key={item} value={item}>{item}時</option>)}
      </select>
      <span aria-hidden="true" className="font-bold text-fg-muted">:</span>
      <select
        aria-label={`${label}の分（5分単位）`}
        value={minute}
        onChange={event => {
          if (!event.target.value) return onChange('');
          onChange(`${hour || '00'}:${event.target.value}`);
        }}
        className={selectClass}
      >
        <option value="">分</option>
        {MINUTES.map(item => <option key={item} value={item}>{item}分</option>)}
      </select>
    </span>
  );
}
