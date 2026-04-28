import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError } from '@/lib/server-auth';

export const runtime = 'nodejs';

const FAQ_LIST = [
  { q: '欠席連絡はどこからできますか？', a: '保護者ホームのカレンダーで日付を選び、「欠席」を選択して送信してください。送信後は管理者側で確認されます。', keywords: ['欠席', '休み', '休む', '遅刻', '連絡'] },
  { q: '振替受講はできますか？', a: '保護者ホームのカレンダーで希望日を選び、「振替」を選択して希望内容を送信してください。確認後に案内されます。', keywords: ['振替', '変更', '別日', '受講日'] },
  { q: '録画はどこで確認できますか？', a: '保護者ダッシュボードの録画視聴欄で、お子さまの録画視聴状況を確認できます。生徒本人は生徒画面の授業録画から視聴できます。', keywords: ['録画', '視聴', '動画', '見逃し'] },
  { q: '宿題提出状況を確認したいです', a: '保護者ホームの宿題提出欄に、提出履歴や提出日時が表示されます。表示がない場合はまだ提出記録がありません。', keywords: ['宿題', '提出', '課題'] },
  { q: '通知設定を変更したいです', a: '下部ナビの「通知設定」から、メール・LINE・アプリ内通知などのオンオフを変更できます。', keywords: ['通知', 'メール', 'LINE', 'ライン', '設定'] },
  { q: '受講講座の登録はどこで行いますか？', a: '管理者から登録依頼が出ると、保護者画面にポップアップが表示されます。期間内に受講講座を選択して登録してください。', keywords: ['講座', '登録', 'カリキュラム', '受講', '科目'] },
  { q: 'ログインできない場合はどうすればよいですか？', a: 'ID・パスワードをご確認ください。解決しない場合は、この画面下部の問い合わせ送信からサポートセンターへご連絡ください。', keywords: ['ログイン', 'パスワード', 'id', 'ID', '入れない'] },
];

const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, '');

const findAnswer = (question: string) => {
  const normalized = normalize(question);
  let best = { score: 0, faq: FAQ_LIST[0] };
  FAQ_LIST.forEach(faq => {
    const score = faq.keywords.reduce((sum, keyword) => sum + (normalized.includes(normalize(keyword)) ? 2 : 0), 0)
      + (normalized.includes(normalize(faq.q.slice(0, 6))) ? 1 : 0);
    if (score > best.score) best = { score, faq };
  });
  return best.score > 0 ? best.faq : null;
};

const createInquiry = async ({ user, question, source, faq }: { user: any; question: string; source: string; faq?: string }) => {
  const ref = adminDb().collection('parent_inquiries').doc();
  await ref.set({
    parent_id: user.uid,
    parent_name: user.profile.parent_name || user.profile.name || '',
    content: question,
    status: 'open',
    source,
    faq_question: faq || null,
    destination: 'support_center',
    created_at: FieldValue.serverTimestamp(),
    updated_at: FieldValue.serverTimestamp(),
  });
  return ref.id;
};

export async function GET(request: NextRequest) {
  try {
    if (request.nextUrl.searchParams.get('mine') === '1') {
      const user = await getServerUser(request);
      if (!['parent', 'guardian'].includes(user.role)) throw new Error('forbidden');
      const snap = await adminDb().collection('parent_inquiries').orderBy('created_at', 'desc').limit(100).get();
      const inquiries = snap.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter((item: any) => item.parent_id === user.uid)
        .slice(0, 20);
      return Response.json({ ok: true, inquiries });
    }
    return Response.json({ ok: true, faqs: FAQ_LIST.map(({ q }) => ({ q })) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    if (!['parent', 'guardian'].includes(user.role)) throw new Error('forbidden');

    const body = await request.json();
    const action = String(body.action || 'answer');
    const question = String(body.question || '').trim();
    if (!question) return Response.json({ ok: false, error: 'question is required' }, { status: 400 });

    if (action === 'send') {
      const inquiryId = await createInquiry({ user, question, source: 'parent_support_center' });
      return Response.json({ ok: true, sent: true, inquiry_id: inquiryId, message: 'サポートセンターへ問い合わせを送信しました。' });
    }

    const faq = findAnswer(question);
    if (!faq) {
      const inquiryId = await createInquiry({ user, question, source: 'faq_unanswered' });
      return Response.json({
        ok: true,
        answered: false,
        needs_support: true,
        inquiry_id: inquiryId,
        answer: 'よくある質問から回答を見つけられませんでした。サポートセンターに確認依頼を送信しました。回答をお待ちください。',
      });
    }

    return Response.json({ ok: true, answered: true, faq: faq.q, answer: faq.a });
  } catch (error) {
    return jsonError(error);
  }
}
