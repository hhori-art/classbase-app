import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// 削除機能 (個別削除 & 全削除)
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const targetId = searchParams.get('id');

    // A. 個別削除モード (ID指定あり)
    if (targetId) {
      // 関連データを削除
      await supabaseAdmin.from('attendance').delete().eq('user_id', targetId);
      await supabaseAdmin.from('submissions').delete().eq('user_id', targetId);
      await supabaseAdmin.from('requests').delete().eq('user_id', targetId);
      await supabaseAdmin.from('teacher_availability').delete().eq('user_id', targetId);
      await supabaseAdmin.from('shift_assignments').delete().eq('user_id', targetId);

      // ユーザー削除
      const { error } = await supabaseAdmin.auth.admin.deleteUser(targetId);
      if (error) throw error;
      
      // プロフィールも念のため (Auth削除で消える設定なら不要だが安全策)
      await supabaseAdmin.from('profiles').delete().eq('id', targetId);

      return NextResponse.json({ success: true, message: '削除しました' });
    }

    // B. 全生徒削除モード (ID指定なし)
    const { data: students } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('role', 'student')
      .limit(500);

    if (!students || students.length === 0) {
      return NextResponse.json({ success: true, count: 0, message: '削除対象がいません' });
    }

    const userIds = students.map(s => s.id);

    // 関連データ削除
    await supabaseAdmin.from('attendance').delete().in('user_id', userIds);
    await supabaseAdmin.from('submissions').delete().in('user_id', userIds);
    await supabaseAdmin.from('requests').delete().in('user_id', userIds);

    // ユーザー削除
    const deletePromises = userIds.map(id => supabaseAdmin.auth.admin.deleteUser(id));
    await Promise.all(deletePromises);
    
    await supabaseAdmin.from('profiles').delete().in('id', userIds);

    return NextResponse.json({ 
      success: true, 
      count: userIds.length,
      message: `${userIds.length}件削除しました。まだ残っている場合はもう一度ボタンを押してください。`
    });

  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// 作成・更新機能
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { users } = body; 
    const { data: rules } = await supabaseAdmin.from('class_settings').select('*');
    const results = [];
    const errors = [];
    const processedIds = new Set();

    for (const user of users) {
      // ID決定
      const loginId = user.lifetime_id || user.student_id;
      if (!loginId) {
        errors.push({ name: user.student_name, error: 'ID(生涯番号)がありません' });
        continue;
      }
      const strId = String(loginId).trim();
      if (processedIds.has(strId)) continue;
      processedIds.add(strId);

      const email = `${strId}@classbase.local`;
      const password = user.password || 'class1234';

      // ★修正: ロール指定があればそれを使う。なければ生徒。
      const role = user.role || 'student';

      // 生徒の場合のみURL自動設定
      let autoUrl1 = null;
      let autoUrl2 = null;
      if (role === 'student') {
        const scienceRule = rules?.find(r => r.grade === user.grade && r.day_of_week === user.day_of_week && r.subject_name === user.science_subject);
        const socialRule = rules?.find(r => r.grade === user.grade && r.day_of_week === user.day_of_week && r.subject_name === user.social_subject);
        autoUrl1 = scienceRule ? scienceRule.zoom_url : null;
        autoUrl2 = socialRule ? socialRule.zoom_url : null;
      }

      let userId = '';
      const { data: existUsers } = await supabaseAdmin.auth.admin.listUsers();
      const existUser = existUsers.users.find(u => u.email === email);

      if (existUser) {
        userId = existUser.id;
        // パスワード更新
        await supabaseAdmin.auth.admin.updateUserById(userId, { password: password });
      } else {
        const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
          email: email, password: password, email_confirm: true, user_metadata: { name: user.student_name }
        });
        if (authError) {
          errors.push({ name: user.student_name, error: authError.message });
          continue;
        }
        userId = authData.user!.id;
      }

      await supabaseAdmin.from('profiles').upsert({
        id: userId,
        role: role, // ★修正: 正しいロールを保存
        student_name: user.student_name,
        name_kana: user.name_kana,
        grade: user.grade,
        student_id: user.student_id,
        lifetime_id: user.lifetime_id,
        classroom: user.classroom,
        phone_number: user.phone_number,
        email: email,
        day_of_week: user.day_of_week,
        science_subject: user.science_subject,
        social_subject: user.social_subject,
        zoom_url: autoUrl1,
        zoom_url_2: autoUrl2,
        raw_password: password
      });
      results.push(user.student_name);
    }
    return NextResponse.json({ success: true, createdCount: results.length, results, errors });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}