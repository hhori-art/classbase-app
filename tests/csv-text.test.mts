import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeCsvBytes } from '../lib/csv-text';

test('UTF-8の旧勤怠CSVを読み込む', () => {
  const bytes = new TextEncoder().encode('職員コード,氏名,日付\n001,山田太郎,2026/10/01');
  assert.match(decodeCsvBytes(bytes), /^職員コード,氏名,日付/);
});

test('BOM付きUTF-16LEの旧勤怠CSVを読み込む', () => {
  const source = '日付,氏名\n2026/10/01,山田太郎';
  const bytes = new Uint8Array([0xff, 0xfe, ...Buffer.from(source, 'utf16le')]);
  assert.equal(decodeCsvBytes(bytes), source);
});

test('Shift-JISの日本語ヘッダーを自動判定する', () => {
  // Shift-JISの「日付\n」。UTF-8としては不正なバイト列なので文字コード判定も検証できる。
  const bytes = new Uint8Array([0x93, 0xfa, 0x95, 0x74, 0x0a]);
  assert.equal(decodeCsvBytes(bytes), '日付\n');
});
