const knownAttendanceHeader = (text: string) =>
  /個人コード|職員コード|支給年月|適用開始日|勤務日|実働開始|日付/.test(text.slice(0, 4000));

export function decodeCsvBytes(bytes: Uint8Array) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  const utf8 = new TextDecoder('utf-8').decode(bytes);
  if (knownAttendanceHeader(utf8)) return utf8;
  try {
    const shiftJis = new TextDecoder('shift_jis').decode(bytes);
    if (knownAttendanceHeader(shiftJis)) return shiftJis;
  } catch {
    // Shift-JIS非対応ランタイムではUTF-8の結果を返す。
  }
  return utf8;
}
