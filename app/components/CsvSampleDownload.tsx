'use client';

import { Download } from 'lucide-react';
import { buttonClass } from '@/app/components/ui';

type CsvValue = string | number | boolean | null | undefined;

type CsvSampleDownloadProps = {
  filename: string;
  headers: string[];
  rows: CsvValue[][];
  label?: string;
  className?: string;
};

const escapeCsvValue = (value: CsvValue) => {
  const text = String(value ?? '');
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
};

export default function CsvSampleDownload({
  filename,
  headers,
  rows,
  label = 'CSV例をダウンロード',
  className = '',
}: CsvSampleDownloadProps) {
  const handleDownload = () => {
    const csv = [headers, ...rows]
      .map(row => row.map(escapeCsvValue).join(','))
      .join('\r\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <button
      type="button"
      onClick={handleDownload}
      className={buttonClass('secondary', 'sm', className)}
    >
      <Download size={14} aria-hidden />
      {label}
    </button>
  );
}
