/**
 * 宿題などの写真を、送る前に小さくする（スマホの写真は1枚で数MBになり、サーバーの上限を超えやすい）。
 * 長い辺を maxSide 以下の JPEG にする。読み込めない形式（端末が対応していない HEIC など）は元のまま返す。
 */
export async function compressImageForUpload(file: File, options: { maxSide?: number; quality?: number; skipBelowBytes?: number } = {}) {
  const maxSide = options.maxSide ?? 2000;
  const quality = options.quality ?? 0.85;
  const skipBelowBytes = options.skipBelowBytes ?? 1_500_000;
  if (typeof window === 'undefined' || !file.type.startsWith('image/')) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size <= skipBelowBytes) { bitmap.close?.(); return file; }
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext('2d');
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg', lastModified: Date.now() });
  } catch {
    return file;
  }
}
