import { redirect } from 'next/navigation';

// PF 学習状況は /master/science-social（校舎運営ダッシュボード）に統合した。
export default function MasterPFPage() {
  redirect('/master/science-social');
}
