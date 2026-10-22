import { Fragment, type ReactNode } from 'react';
import { phraseChunks } from '@/lib/phrase';
import { cn } from '@/lib/cn';

/**
 * 文節の切れ目でだけ改行する文字列（iPhone の Safari でも効くよう <wbr> を入れる）。
 * 文字列以外（アイコンや要素）はそのまま表示する。改行文字は保ったまま、行ごとに区切る。
 */
export function Phrase({ children, className }: { children: ReactNode; className?: string }) {
  if (typeof children !== 'string') return <>{children}</>;
  const lines = children.split('\n');
  return (
    <span className={cn('cb-phrase', className)}>
      {lines.map((line, lineIndex) => (
        <Fragment key={lineIndex}>
          {lineIndex > 0 && <br />}
          {phraseChunks(line).map((chunk, index) => (
            <Fragment key={index}>{index > 0 && <wbr />}{chunk}</Fragment>
          ))}
        </Fragment>
      ))}
    </span>
  );
}

/** ReactNode のうち文字列だけを Phrase にする（ボタンの中身など、文字とアイコンが混ざる場所用）。 */
export function phrased(node: ReactNode): ReactNode {
  if (typeof node === 'string') return <Phrase>{node}</Phrase>;
  if (Array.isArray(node)) return node.map((item, index) => (typeof item === 'string' ? <Phrase key={`p${index}`}>{item}</Phrase> : item));
  return node;
}
