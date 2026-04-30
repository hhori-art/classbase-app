import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
import { getNotificationSettings, roleLineEnabled } from '@/lib/line';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, isAdminLike, jsonError } from '@/lib/server-auth';

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    if (!isAdminLike(user)) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const { tasks } = await request.json(); 

    if (!tasks || !Array.isArray(tasks)) {
      return NextResponse.json({ error: 'Bad Request' }, { status: 400 });
    }

    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    
    // ★ カギがない場合、ターミナルにわかりやすくエラーを出す
    if (!token) {
      console.error("【エラー】.env.local に LINE_CHANNEL_ACCESS_TOKEN が設定されていません、またはサーバーの再起動忘れです！");
      return NextResponse.json({ error: 'トークンが設定されていません' }, { status: 500 });
    }

    const notificationSettings = await getNotificationSettings();

    // 各ユーザーへ個別の内容を送信
    const promises = tasks.map(async (task: any) => {
      const userId = String(task.uid || '');
      const lineUserId = String(task.userId || '');
      const role = String(task.role || 'teacher');

      if (!lineUserId || !roleLineEnabled(notificationSettings, role)) {
        return { ok: false, skipped: true };
      }

      if (userId) {
        const userSnap = await adminDb().collection('users').doc(userId).get();
        const target = userSnap.data() || {};
        const prefs = target.notification_preferences || {};
        if (prefs.line === false) return { ok: false, skipped: true };
        if (task.kind && prefs[task.kind] === false) return { ok: false, skipped: true };
      }

      const res = await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          to: lineUserId,
          messages: [{ type: 'text', text: task.text }]
        })
      });
      
      // ★ LINE側から拒否された場合、詳細な理由をターミナルに出す
      if (!res.ok) {
        const errorData = await res.json();
        console.error(`【LINE API エラー】ユーザー(${task.userId})への送信失敗:`, errorData);
      }
      return res;
    });

    const results = await Promise.all(promises);

    return NextResponse.json({ success: true, count: results.filter((r: any) => r?.ok !== false).length });
  } catch (error: any) {
    console.error('Push API Error:', error.message);
    return jsonError(error, 500);
  }
}
