import crypto from 'node:crypto';
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

const clean = (value: unknown, max = 2000) => String(value || '').normalize('NFKC').trim().slice(0, max);

const linkedStudents = async (user: any) => {
  const db = adminDb();
  const ids = new Set<string>((Array.isArray(user.profile.student_ids) ? user.profile.student_ids : []).map((value: unknown) => clean(value, 128)).filter(Boolean));
  const reverse = await db.collection('users').where('parent_uid', '==', user.uid).limit(20).get();
  reverse.docs.filter(doc => doc.data().role === 'student').forEach(doc => ids.add(doc.id));
  const docs = ids.size ? await db.getAll(...[...ids].slice(0, 20).map(id => db.collection('users').doc(id))) : [];
  return docs.filter(doc => doc.exists && doc.data()?.role === 'student').map(doc => ({
    id: doc.id,
    name: clean(doc.data()?.student_name || doc.data()?.name, 120) || '生徒',
    grade: clean(doc.data()?.grade, 40),
    school_id: clean(doc.data()?.school_id || doc.data()?.school_code || doc.data()?.school || doc.data()?.classroom, 120),
    school_name: clean(doc.data()?.school_name || doc.data()?.school || doc.data()?.classroom, 120),
  }));
};

const createInquiry = async ({ user, question, source, faq, subject, category, student }: { user: any; question: string; source: string; faq?: string; subject?: string; category?: string; student?: any }) => {
  const db = adminDb();
  const day = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());
  const digest = crypto.createHash('sha256').update(`${user.uid}\u0000${day}\u0000${normalize(question)}`).digest('hex');
  const ref = db.collection('parent_inquiries').doc(`parent_inquiry_${digest}`);
  await db.runTransaction(async transaction => {
    const existing = await transaction.get(ref);
    if (existing.exists) return;
    transaction.create(ref, {
      parent_id: user.uid,
      parent_name: user.profile.parent_name || user.profile.name || '',
      subject: clean(subject, 120) || 'お問い合わせ',
      category: clean(category, 40) || 'other',
      student_id: student?.id || null,
      student_name: student?.name || null,
      content: question,
      status: 'open',
      source,
      faq_question: faq || null,
      destination: 'support_center',
      school_id: student?.school_id || user.profile.school_id || user.profile.school_code || null,
      school_name: student?.school_name || user.profile.school_name || user.profile.school || user.school || null,
      messages: [{ sender_role: 'parent', sender_id: user.uid, sender_name: user.profile.parent_name || user.profile.name || '保護者', text: question, created_at_iso: new Date().toISOString() }],
      message_count: 1,
      unread_for_admin: true,
      unread_for_parent: false,
      created_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    });
  });
  return ref.id;
};

export async function GET(request: NextRequest) {
  try {
    if (request.nextUrl.searchParams.get('mine') === '1') {
      const user = await getServerUser(request);
      if (!['parent', 'guardian'].includes(user.role)) throw new Error('forbidden');
      const students = await linkedStudents(user);
      const snap = await adminDb().collection('parent_inquiries')
        .where('parent_id', '==', user.uid)
        .orderBy('created_at', 'desc')
        .limit(20)
        .get();
      const inquiries = snap.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter((item: any) => item.parent_id === user.uid);
      return Response.json({ ok: true, inquiries, students });
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
    const question = clean(body.question);
    if (!['answer', 'send', 'reply', 'mark_read'].includes(action)) return Response.json({ ok: false, error: 'invalid action' }, { status: 400 });
    if (action !== 'mark_read' && !question) return Response.json({ ok: false, error: 'question is required' }, { status: 400 });
    if (question.length > 2000) return Response.json({ ok: false, error: 'question is too long' }, { status: 400 });

    if (action === 'reply' || action === 'mark_read') {
      const inquiryId = clean(body.inquiry_id, 160);
      if (!inquiryId) return Response.json({ ok: false, error: 'inquiry_id is required' }, { status: 400 });
      const ref = adminDb().collection('parent_inquiries').doc(inquiryId);
      await adminDb().runTransaction(async transaction => {
        const snap = await transaction.get(ref);
        if (!snap.exists || clean(snap.data()?.parent_id, 128) !== user.uid) throw new Error('forbidden');
        if (action === 'mark_read') {
          transaction.update(ref, { unread_for_parent: false, parent_read_at: FieldValue.serverTimestamp() });
          return;
        }
        if (!question) throw new Error('question is required');
        const messages = Array.isArray(snap.data()?.messages) ? snap.data()!.messages.slice(-99) : [];
        messages.push({ sender_role: 'parent', sender_id: user.uid, sender_name: user.profile.parent_name || user.profile.name || '保護者', text: question, created_at_iso: new Date().toISOString() });
        transaction.update(ref, {
          messages,
          message_count: FieldValue.increment(1),
          status: 'open',
          unread_for_admin: true,
          unread_for_parent: false,
          updated_at: FieldValue.serverTimestamp(),
        });
      });
      return Response.json({ ok: true });
    }

    if (action === 'send') {
      const students = await linkedStudents(user);
      const requestedStudentId = clean(body.student_id, 128);
      const student = requestedStudentId ? students.find(item => item.id === requestedStudentId) : students[0];
      if (requestedStudentId && !student) throw new Error('forbidden');
      const inquiryId = await createInquiry({ user, question, source: 'parent_school_contact', subject: clean(body.subject, 120), category: clean(body.category, 40), student });
      return Response.json({ ok: true, sent: true, inquiry_id: inquiryId, message: 'サポートセンターへ問い合わせを送信しました。' });
    }

    const faq = findAnswer(question);
    if (!faq) {
      const inquiryId = await createInquiry({ user, question, source: 'faq_unanswered', subject: 'FAQで解決しなかった問い合わせ', category: 'other' });
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
