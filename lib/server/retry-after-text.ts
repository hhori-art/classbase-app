/** 待ち時間（秒）を、画面に出す言葉にする。 */
export function retryAfterText(seconds: number | undefined) {
  if (!seconds || seconds <= 0) return 'しばらく';
  if (seconds < 60) return `${seconds}秒`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes}分`;
  return `${Math.ceil(minutes / 60)}時間`;
}
