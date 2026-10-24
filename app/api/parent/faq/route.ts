import crypto from 'node:crypto';
import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError } from '@/lib/server-auth';
import { loadSchoolStaffRecipients, notifyStaff } from '@/lib/server/staff-recipients';

export const runtime = 'nodejs';

const FAQ_LIST = [
  { q: '欠席連絡はどこからできますか？', a: 'メニューの「欠席連絡」（ホームの通塾カレンダー）で日付を選び、「欠席する」を選んで送信してください。送信するとお子さまと教室に届きます。取り消しも同じ画面からできます。', keywords: ['欠席', '休み', '休む', '遅刻', '連絡'] },
  { q: '振替受講はできますか？', a: 'ホームの通塾カレンダーで休む日を選び、「振替先をいま決める」から同じ単元の別の日の授業を選ぶと、その場で振替が確定します。「欠席して、振替はお子さまが選ぶ」を選ぶと、お子さまの画面に振替先の選択が表示されます。', keywords: ['振替', '変更', '別日', '受講日'] },
  { q: '録画はどこで確認できますか？', a: '授業の録画は、生徒画面の「授業録画」から見られます。録画の視聴状況は、保護者画面の「学習状況」で確認できます。', keywords: ['録画', '視聴', '動画', '見逃し'] },
  { q: '宿題提出状況を確認したいです', a: '保護者画面の「学習状況」で、宿題の提出状況を確認できます。表示がない場合は、まだ提出の記録がありません。', keywords: ['宿題', '提出', '課題'] },
  { q: '通知設定を変更したいです', a: 'メニューの「設定」から、LINE・アプリ内通知などのオン・オフを変更できます。', keywords: ['通知', 'メール', 'LINE', 'ライン', '設定'] },
  { q: '受講講座の登録はどこで行いますか？', a: 'メニューの「受講講座」から、いつでも登録・変更できます。教室から登録のお願いが出ているときは、ホームにも案内が表示されます。', keywords: ['講座', '登録', 'カリキュラム', '受講', '科目'] },
  { q: 'ログインできない場合はどうすればよいですか？', a: 'ID・パスワードをご確認ください。パスワードを忘れたときは、ログイン画面の「パスワードを忘れた方」から再設定できます。解決しない場合は、教室へお電話などでご連絡ください。', keywords: ['ログイン', 'パスワード', 'id', 'ID', '入れない'] },
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

/** 保護者からの新規連絡・返信を、マスターと担当校舎の理社講座管理者へアプリ内通知する。失敗しても送信自体は成功扱い。 */
const notifyStaffOfInquiry = async (inquiryId: string, inquiry: { subject?: string | null; student_name?: string | null; school_id?: string | null; parent_name?: string | null }, text: string, isReply: boolean) => {
  try {
    const recipients = await loadSchoolStaffRecipients(inquiry.school_id || null);
    const who = [inquiry.parent_name || '保護者', inquiry.student_name ? `（${inquiry.student_name}さん）` : ''].join('');
    await notifyStaff(recipients, {
      idPrefix: `parent_inquiry_staff_${inquiryId}`,
      title: isReply ? '保護者から追加の連絡が届きました' : '保護者から新しい連絡が届きました',
      message: `${who}「${clean(inquiry.subject, 120) || 'お問い合わせ'}」: ${text.slice(0, 120)}`,
      kind: 'parent_inquiry',
      masterLink: '/master/parent-inquiries',
      extra: { inquiry_id: inquiryId },
    });
  } catch (error) {
    console.error('保護者連絡の管理者通知に失敗しました', error);
  }
};

const createInquiry = async ({ user, question, source, faq, subject, category, student }: { user: any; question: string; source: string; faq?: string; subject?: string; category?: string; student?: any }) => {
  const db = adminDb();
  const day = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());
  // 同じ日に同じお子さま・件名・内容を二重送信した場合だけ1件にまとめる。
  const digest = crypto.createHash('sha256').update([user.uid, day, student?.id || '', normalize(clean(subject, 120)), normalize(question)].join('\u0000')).digest('hex');
  const ref = db.collection('parent_inquiries').doc(`parent_inquiry_${digest}`);
  let created: Record<string, any> | null = null;
  await db.runTransaction(async transaction => {
    created = null;
    const existing = await transaction.get(ref);
    if (existing.exists) return;
    created = {
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
    };
    transaction.create(ref, created);
  });
  const createdInquiry = created as Record<string, any> | null;
  if (createdInquiry) await notifyStaffOfInquiry(ref.id, createdInquiry, question, false);
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
        .orderBy('updated_at', 'desc')
        .limit(30)
        .get();
      const inquiries = snap.docs
        .map(doc => {
          const data = doc.data() || {};
          // 教室が開いた時刻（既読表示用）。未読に戻っている（unread_for_admin）ときは出さない。
          const readAt = data.unread_for_admin === true ? null : data.admin_read_at?.toDate?.()?.toISOString?.() || null;
          return { id: doc.id, ...data, admin_read_at_iso: readAt };
        })
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
      let repliedInquiry: Record<string, any> | null = null;
      await adminDb().runTransaction(async transaction => {
        repliedInquiry = null;
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
        repliedInquiry = snap.data() || {};
      });
      const replied = repliedInquiry as Record<string, any> | null;
      if (replied) await notifyStaffOfInquiry(inquiryId, replied, question, true);
      return Response.json({ ok: true });
    }

    if (action === 'send') {
      const students = await linkedStudents(user);
      const requestedStudentId = clean(body.student_id, 128);
      const student = requestedStudentId ? students.find(item => item.id === requestedStudentId) : students[0];
      if (requestedStudentId && !student) throw new Error('forbidden');
      // FAQで解決しなかった質問は、保護者が「教室に質問として送る」を押した場合だけ送信される。
      const fromFaq = body.from_faq === true;
      const inquiryId = await createInquiry({
        user,
        question,
        source: fromFaq ? 'faq_unanswered' : 'parent_school_contact',
        subject: clean(body.subject, 120) || (fromFaq ? 'FAQで解決しなかった質問' : ''),
        category: clean(body.category, 40) || 'other',
        student,
      });
      return Response.json({ ok: true, sent: true, inquiry_id: inquiryId, message: '教室へ連絡を送信しました。' });
    }

    const faq = findAnswer(question);
    if (!faq) {
      // 本人の確認なしに問い合わせを作らない。画面の「教室に質問として送る」で action: 'send' を呼ぶ。
      return Response.json({
        ok: true,
        answered: false,
        needs_support: true,
        answer: 'よくある質問から回答を見つけられませんでした。教室に確認したい場合は「教室に質問として送る」を押してください。',
      });
    }

    return Response.json({ ok: true, answered: true, faq: faq.q, answer: faq.a });
  } catch (error) {
    return jsonError(error);
  }
}
