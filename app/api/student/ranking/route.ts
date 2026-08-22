import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError, requireRole } from '@/lib/server-auth';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireRole(user, ['student']);

    const limitParam = Math.min(Math.max(Number(request.nextUrl.searchParams.get('limit') || 20), 1), 50);
    const snap = await adminDb()
      .collection('users')
      .where('role', '==', 'student')
      .select('student_name', 'name', 'selected_badge', 'total_coins', 'login_streak')
      .limit(1000)
      .get();

    const ranking = snap.docs
      .map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          is_me: doc.id === user.uid,
          student_name: data.student_name || data.name || '生徒',
          selected_badge: data.selected_badge || '',
          total_coins: Number(data.total_coins || 0),
          login_streak: Number(data.login_streak || 0),
        };
      })
      .sort((a, b) => b.total_coins - a.total_coins)
      .slice(0, limitParam)
      .map((player, index) => ({
        ...player,
        rank: index + 1,
      }));

    if (!ranking.some((player) => player.id === user.uid)) {
      const meDoc = await adminDb().collection('users').doc(user.uid).get();
      const me = meDoc.data();
      if (me) {
        ranking.push({
          id: meDoc.id,
          rank: 0,
          is_me: true,
          student_name: me.student_name || me.name || '生徒',
          selected_badge: me.selected_badge || '',
          total_coins: Number(me.total_coins || 0),
          login_streak: Number(me.login_streak || 0),
        });
      }
    }

    const responseRanking = ranking.map((player) => {
      return {
        id: player.id,
        rank: player.rank,
        is_me: player.is_me,
        student_name: player.student_name,
        selected_badge: player.selected_badge,
        total_coins: player.total_coins,
        login_streak: player.login_streak,
      };
    });

    return Response.json({ ok: true, ranking: responseRanking });
  } catch (error) {
    return jsonError(error);
  }
}
