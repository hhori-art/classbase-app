import { randomUUID } from 'node:crypto';
import { adminBucket } from '@/lib/firebase-admin';
import { DIGITAL_FILE_MAX_BYTES, DIGITAL_FILE_TYPES } from '@/lib/rewards';

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

const startsWith = (bytes: Uint8Array, signature: number[]) => signature.every((value, index) => bytes[index] === value);
const ascii = (bytes: Uint8Array, start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));

const IMAGE_TYPES: Record<string, { extension: string; valid: (bytes: Uint8Array) => boolean }> = {
  'image/jpeg': { extension: 'jpg', valid: bytes => startsWith(bytes, [0xff, 0xd8, 0xff]) },
  'image/png': { extension: 'png', valid: bytes => startsWith(bytes, [0x89, 0x50, 0x4e, 0x47]) },
  'image/webp': { extension: 'webp', valid: bytes => ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP' },
};

const DIGITAL_SIGNATURES: Record<string, (bytes: Uint8Array) => boolean> = {
  'application/pdf': bytes => ascii(bytes, 0, 5) === '%PDF-',
  'image/png': IMAGE_TYPES['image/png'].valid,
  'image/jpeg': IMAGE_TYPES['image/jpeg'].valid,
  'image/webp': IMAGE_TYPES['image/webp'].valid,
  'application/zip': bytes => startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]),
  'audio/mpeg': bytes => ascii(bytes, 0, 3) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0),
};

/** 景品・ガチャの表示画像。生徒画面に直接表示するためダウンロードトークン付きURLを返す。 */
export async function saveRewardImage(file: File, folder: string, uploadedBy: string) {
  if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) throw new Error('画像はJPEG・PNG・WebPの4MB以内にしてください');
  const imageType = IMAGE_TYPES[String(file.type || '').toLowerCase()];
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!imageType || !imageType.valid(bytes)) throw new Error('画像の形式を確認してください');
  const token = randomUUID();
  const path = `${folder}/${randomUUID()}.${imageType.extension}`;
  const bucket = adminBucket();
  await bucket.file(path).save(Buffer.from(bytes), {
    resumable: false,
    validation: 'crc32c',
    metadata: { contentType: file.type, metadata: { firebaseStorageDownloadTokens: token, uploadedBy, purpose: 'reward_image' } },
  });
  const url = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket.name)}/o/${encodeURIComponent(path)}?alt=media&token=${encodeURIComponent(token)}`;
  return { path, url };
}

/** デジタル景品のファイル。公開URLは作らず、受け取った生徒にだけ署名付きURLを発行する。 */
export async function saveDigitalRewardFile(file: File, rewardId: string, uploadedBy: string) {
  const type = String(file.type || '').toLowerCase();
  const extension = DIGITAL_FILE_TYPES[type];
  if (!extension || file.size <= 0 || file.size > DIGITAL_FILE_MAX_BYTES) {
    throw new Error('ダウンロード景品はPDF・画像・ZIP・MP3の4MB以内にしてください');
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!DIGITAL_SIGNATURES[type]?.(bytes)) throw new Error('ファイルの形式を確認してください');
  const path = `reward_files/${rewardId}/${randomUUID()}.${extension}`;
  await adminBucket().file(path).save(Buffer.from(bytes), {
    resumable: false,
    validation: 'crc32c',
    metadata: { contentType: type, metadata: { uploadedBy, purpose: 'reward_digital_file' } },
  });
  const baseName = String(file.name || '').replace(/[\\/\u0000-\u001f]/g, '_').trim().slice(0, 120);
  return { path, name: baseName || `reward.${extension}`, size: file.size, contentType: type };
}
