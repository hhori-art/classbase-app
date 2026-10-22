import 'server-only';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getNotificationSettings, roleLineEnabled } from '@/lib/line';
import { isDeliverableEmail, pushLine, sendEmail, stableEmailIdempotencyKey, stableLineRetryKey, userAllows } from '@/lib/server/notify-channels';
import { loadSchoolStaffRecipients, notifyStaff, type StaffRecipient } from '@/lib/server/staff-recipients';
import { queuePushToUsers } from '@/lib/server/web-push';

// 生徒とAIチューターの会話から、自傷・虐待・いじめなど心配な内容を検知し、
// safety_alerts に記録して保護者・管理者へ通知する。
// 検知は返信を止めない（失敗しても会話は続け、ログだけ残す）。

export type SafetyCategory = 'self_harm' | 'abuse' | 'violence' | 'sexual' | 'bullying' | 'runaway';
export type SafetySeverity = 'high' | 'medium';
export type SafetyFinding = { category: SafetyCategory; severity: SafetySeverity; source: 'keyword' | 'moderation'; matched?: string };

export const SAFETY_CATEGORY_LABELS: Record<SafetyCategory, string> = {
  self_harm: '自傷・希死念慮',
  abuse: '家庭での暴力・虐待',
  violence: '他者への暴力',
  sexual: '性的な被害・誘い出し',
  bullying: 'いじめ',
  runaway: '家出',
};

const SEVERITY_RANK: Record<SafetySeverity, number> = { medium: 1, high: 2 };
/** 同じ生徒・同じ分類の通知はこの時間枠で1回にまとめる。 */
export const SAFETY_ALERT_WINDOW_MS = 6 * 60 * 60 * 1000;

const KEYWORD_RULES: Array<{ category: SafetyCategory; severity: SafetySeverity; patterns: RegExp[] }> = [
  {
    category: 'self_harm',
    severity: 'high',
    patterns: [
      /死にたい|しにたい|氏にたい|死んでしまいたい|死のうと|死ぬしかない|死んだほうが(まし|いい|楽)/,
      /消えたい|きえたい|いなくなりたい|生まれてこなければ/,
      /自殺|じさつ|自死|自傷/,
      /リスカ|リストカット|アムカ|手首を切|腕を切って/,
      /首を(吊|つ)|首吊り|飛び降り(たい|よう|る)/,
      /生きて(る|いる|いく)?意味(が|は)?(ない|無い|わからない)|生きる意味(が|は)?(ない|無い)|生きてるのがつらい|生きるのがつらい/,
      /オーバードーズ|薬を(大量|たくさん)(に)?飲/,
    ],
  },
  {
    category: 'abuse',
    severity: 'high',
    patterns: [
      /虐待/,
      /(父|母|親|お父さん|お母さん|おとうさん|おかあさん|パパ|ママ|兄|姉|義父|義母|継父|継母).{0,12}(殴|なぐられ|なぐって|叩かれ|たたかれ|蹴られ|蹴って|暴力|首を絞)/,
      /(殴|なぐ)られ(る|た|て)|蹴られ(る|た|て)|首を絞められ/,
      /ご飯を(食べさせて|もらえ)(もらえない|ない)|家に入れてもらえない|閉じ込められ/,
    ],
  },
  {
    category: 'violence',
    severity: 'high',
    patterns: [
      /殺したい|ころしたい|殺してやる|ころしてやる|ぶっ殺|ぶっころ/,
      /刺したい|刺してやる|さしてやる/,
      /(爆破|放火)(したい|してやる|する)/,
      /(ナイフ|包丁|刃物).{0,10}(持って(いく|行く)|で刺)/,
    ],
  },
  {
    category: 'sexual',
    severity: 'high',
    patterns: [
      /(裸|はだか|下着|エッチな|えっちな).{0,6}(写真|画像|動画|自撮り)/,
      /(写真|画像|動画).{0,10}(送って(と|って)言われ|送れって|要求され)/,
      /(体|からだ|胸|おしり|お尻).{0,6}(触られ|さわられ)/,
      /(知らない|ネットの|snsの|ゲームの)(人|大人|おじさん|男|女).{0,15}(会おう|会いたい|会うこと|会う約束|家に来|泊ま)/,
      /性的な|わいせつ|レイプ|痴漢/,
    ],
  },
  {
    category: 'bullying',
    severity: 'medium',
    patterns: [
      /いじめ|イジメ|虐め/,
      /無視され(る|て|た)|仲間(外|はず)れ|悪口を言われ|陰口|からかわれ(る|て|た)/,
      /(お金|金)を(取|と)られ|パシリ|靴を隠され|物を隠され/,
    ],
  },
  {
    category: 'runaway',
    severity: 'medium',
    patterns: [
      /家出|家を出たい|家に帰りたくない|家にいたくない/,
    ],
  },
];

const normalizeForDetection = (value: string) =>
  String(value || '').normalize('NFKC').toLowerCase().replace(/[\s　]+/g, '');

/** 日本語のキーワード・パターンによる検知（モデレーションAPIが使えない場合の安全網）。 */
export function detectSafetyKeywords(text: string): SafetyFinding[] {
  const normalized = normalizeForDetection(text);
  if (!normalized) return [];
  const findings: SafetyFinding[] = [];
  for (const rule of KEYWORD_RULES) {
    for (const pattern of rule.patterns) {
      const match = normalized.match(pattern);
      if (match) {
        findings.push({ category: rule.category, severity: rule.severity, source: 'keyword', matched: match[0].slice(0, 40) });
        break;
      }
    }
  }
  return findings;
}

type ModerationResult = { flagged?: boolean; categories?: Record<string, boolean>; category_scores?: Record<string, number> };
export type ModerationFn = (text: string) => Promise<ModerationResult | null>;

/** OpenAI Moderation の結果を、教室で対応すべき分類に読み替える（歴史の戦争などで誤検知しにくいものだけ採用）。 */
export function findingsFromModeration(result: ModerationResult | null): SafetyFinding[] {
  if (!result) return [];
  const categories = result.categories || {};
  const scores = result.category_scores || {};
  const findings: SafetyFinding[] = [];
  if (categories['self-harm'] || categories['self-harm/intent'] || categories['self-harm/instructions']) {
    findings.push({ category: 'self_harm', severity: 'high', source: 'moderation' });
  }
  if (categories['sexual/minors']) findings.push({ category: 'sexual', severity: 'high', source: 'moderation' });
  if (categories['harassment/threatening'] || (categories.violence && Number(scores.violence || 0) >= 0.8)) {
    findings.push({ category: 'violence', severity: 'medium', source: 'moderation' });
  }
  return findings;
}

async function defaultModeration(text: string): Promise<ModerationResult | null> {
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) return null;
  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({ apiKey, timeout: 8000, maxRetries: 1 });
  const response = await client.moderations.create({ model: 'omni-moderation-latest', input: text.slice(0, 8000) });
  return (response.results?.[0] as unknown as ModerationResult | undefined) || null;
}

/** キーワードとモデレーションを合わせ、分類ごとに最も重い判定を1つ残す。モデレーション失敗時はキーワードだけで判定する。 */
export async function detectSafetyConcerns(text: string, moderate: ModerationFn = defaultModeration): Promise<SafetyFinding[]> {
  const keywordFindings = detectSafetyKeywords(text);
  let moderationFindings: SafetyFinding[] = [];
  try {
    moderationFindings = findingsFromModeration(await moderate(text));
  } catch (error) {
    console.error('AIチャットのモデレーション確認に失敗しました（キーワード判定のみで継続）', error instanceof Error ? error.message : error);
  }
  const byCategory = new Map<SafetyCategory, SafetyFinding>();
  for (const finding of [...keywordFindings, ...moderationFindings]) {
    const current = byCategory.get(finding.category);
    if (!current || SEVERITY_RANK[finding.severity] > SEVERITY_RANK[current.severity]) byCategory.set(finding.category, finding);
  }
  return [...byCategory.values()];
}

const clean = (value: unknown, max = 200) => String(value || '').normalize('NFKC').trim().slice(0, max);
const INACTIVE = ['suspended', 'withdrawn', 'archived'];

type Recipient = { id: string; data: FirebaseFirestore.DocumentData };

async function loadLinkedParents(studentId: string, student: FirebaseFirestore.DocumentData): Promise<Recipient[]> {
  const db = adminDb();
  const ids = new Set<string>([
    ...(Array.isArray(student.parent_ids) ? student.parent_ids : []),
    student.parent_uid,
  ].map(value => clean(value, 128)).filter(id => id && !id.includes('/')));
  const reverse = await db.collection('users').where('student_ids', 'array-contains', studentId).limit(10).get();
  reverse.docs.forEach(doc => ids.add(doc.id));
  if (!ids.size) return [];
  const docs = await db.getAll(...[...ids].slice(0, 20).map(id => db.collection('users').doc(id)));
  return docs
    .filter(doc => doc.exists)
    .map(doc => ({ id: doc.id, data: doc.data() || {} }))
    .filter(item => ['parent', 'guardian'].includes(String(item.data.role || '').toLowerCase()))
    .filter(item => !INACTIVE.some(status => item.data.account_status === status || item.data.status === status));
}

export type StudentSafetyCheckInput = {
  studentId: string;
  student: FirebaseFirestore.DocumentData;
  text: string;
  requestId: string;
  source?: 'ai_chat';
  moderate?: ModerationFn;
  now?: number;
};

/**
 * 生徒の発言を検査し、心配な内容があれば safety_alerts を作成して保護者・管理者に通知する。
 * 同じ生徒・分類は SAFETY_ALERT_WINDOW_MS の枠内で1件にまとめ、通知は最初の1回だけ送る。
 */
export async function runStudentSafetyCheck(input: StudentSafetyCheckInput) {
  const text = String(input.text || '');
  const findings = await detectSafetyConcerns(text, input.moderate);
  if (!findings.length) return { findings, created: [] as string[] };

  const db = adminDb();
  const now = input.now ?? Date.now();
  const bucket = Math.floor(now / SAFETY_ALERT_WINDOW_MS);
  const studentName = clean(input.student.student_name || input.student.name, 120) || '生徒';
  const schoolId = clean(input.student.school_id || input.student.school_code || input.student.school_name || input.student.school, 120) || null;
  const schoolName = clean(input.student.school_name || input.student.school, 120) || null;
  const excerpt = clean(text, 200);
  const created: Array<{ id: string; finding: SafetyFinding }> = [];

  for (const finding of findings) {
    const ref = db.collection('safety_alerts').doc(`ai_${input.studentId}_${finding.category}_${bucket}`);
    const isNew = await db.runTransaction(async transaction => {
      const snap = await transaction.get(ref);
      if (snap.exists) {
        const current = snap.data() || {};
        transaction.update(ref, {
          occurrence_count: FieldValue.increment(1),
          latest_excerpt: excerpt,
          latest_request_id: input.requestId,
          ...(SEVERITY_RANK[finding.severity] > SEVERITY_RANK[(current.severity as SafetySeverity) || 'medium'] ? { severity: finding.severity } : {}),
          last_detected_at: FieldValue.serverTimestamp(),
          updated_at: FieldValue.serverTimestamp(),
        });
        return false;
      }
      transaction.create(ref, {
        student_id: input.studentId,
        student_name: studentName,
        school_id: schoolId,
        school_name: schoolName,
        category: finding.category,
        category_label: SAFETY_CATEGORY_LABELS[finding.category],
        severity: finding.severity,
        detection_source: finding.source,
        matched: finding.matched || null,
        excerpt,
        latest_excerpt: excerpt,
        request_id: input.requestId,
        latest_request_id: input.requestId,
        source: input.source || 'ai_chat',
        status: 'open',
        memo: '',
        occurrence_count: 1,
        created_at: FieldValue.serverTimestamp(),
        last_detected_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      });
      return true;
    });
    if (isNew) created.push({ id: ref.id, finding });
  }

  if (created.length) {
    try {
      await notifySafetyAlerts({ studentId: input.studentId, student: input.student, studentName, schoolId, schoolName, excerpt, created });
    } catch (error) {
      console.error('安全アラートの通知に失敗しました', error);
    }
  }
  return { findings, created: created.map(item => item.id) };
}

async function notifySafetyAlerts(params: {
  studentId: string;
  student: FirebaseFirestore.DocumentData;
  studentName: string;
  schoolId: string | null;
  schoolName: string | null;
  excerpt: string;
  created: Array<{ id: string; finding: SafetyFinding }>;
}) {
  const db = adminDb();
  const [parents, staff] = await Promise.all([
    loadLinkedParents(params.studentId, params.student),
    loadSchoolStaffRecipients(params.schoolId),
  ]);
  const top = [...params.created].sort((a, b) => SEVERITY_RANK[b.finding.severity] - SEVERITY_RANK[a.finding.severity])[0];
  const alertId = top.id;
  const high = top.finding.severity === 'high';
  const labels = params.created.map(item => SAFETY_CATEGORY_LABELS[item.finding.category]).join('・');

  // 保護者には会話内容を含めず、落ち着いた文面で声かけをお願いする。
  const parentTitle = 'お子さまのAIチャットについて';
  const parentMessage = `${params.studentName}さんのAIチャットで、心配な内容が見られました。声かけをお願いします。気になることがあれば、教室へお気軽にご相談ください。`;
  const batch = db.batch();
  for (const parent of parents) {
    batch.set(db.collection('user_notifications').doc(`${alertId}_${parent.id}`), {
      user_id: parent.id,
      role: 'parent',
      title: parentTitle,
      message: parentMessage,
      kind: 'safety_alert',
      link: '/parent/messages',
      safety_alert_id: alertId,
      student_id: params.studentId,
      read: false,
      created_at: FieldValue.serverTimestamp(),
    });
  }
  if (parents.length) {
    await batch.commit();
    // 端末通知はロック画面に出るため、名前も会話内容も含めない。
    queuePushToUsers(parents.map(parent => parent.id), {
      title: parentTitle,
      body: '気になる様子が見られました。アプリでご確認ください。',
      link: '/parent/messages',
    }, { kind: 'safety_alert' });
  }

  const severityLabel = high ? '緊急度：高' : '緊急度：中';
  await notifyStaff(staff, {
    idPrefix: alertId,
    title: high ? '【至急確認】AIチャットで心配な内容を検知しました' : '【確認】AIチャットで気になる内容を検知しました',
    message: `${params.studentName}さん${params.schoolName ? `（${params.schoolName}）` : ''}：${labels}（${severityLabel}）。抜粋「${params.excerpt.slice(0, 80)}」`,
    kind: 'safety_alert',
    masterLink: '/master/safety-alerts',
    extra: { safety_alert_id: alertId, student_id: params.studentId },
  });

  // 高リスクだけ LINE・メールでも知らせる（本文は含めない）。
  if (!high) return;
  const settings = await getNotificationSettings();
  const parentText = `【ClassBase】${parentMessage}`;
  const staffText = `【ClassBase】${params.studentName}さんのAIチャットで「${labels}」に関する心配な内容を検知しました。管理画面の通知から確認してください。`;
  const targets: Array<{ recipient: Recipient | StaffRecipient; role: string; text: string; title: string }> = [
    ...parents.map(recipient => ({ recipient, role: 'parent', text: parentText, title: parentTitle })),
    ...staff.map(recipient => ({ recipient, role: 'admin', text: staffText, title: 'AIチャットで心配な内容を検知しました' })),
  ];
  await Promise.all(targets.map(async ({ recipient, role, text, title }) => {
    const lineUserId = clean(recipient.data.line_user_id, 128);
    if (lineUserId && roleLineEnabled(settings, role) && userAllows(recipient.data, 'line', 'safety_alert')) {
      const result = await pushLine(lineUserId, text, stableLineRetryKey(alertId, recipient.id, 'line'));
      if (!result.ok) console.warn('安全アラートのLINE送信に失敗しました', result.error);
    }
    const email = clean(recipient.data.email, 320);
    if (settings.email_enabled && email && isDeliverableEmail(email) && userAllows(recipient.data, 'email', 'safety_alert')) {
      const result = await sendEmail(email, `【ClassBase】${title}`, text, stableEmailIdempotencyKey(alertId, recipient.id, 'email'));
      if (!result.ok) console.warn('安全アラートのメール送信に失敗しました', result.error);
    }
  }));
}
