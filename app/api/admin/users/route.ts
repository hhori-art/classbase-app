import { NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin'; // Firebase Adminのインポート

// ---------------------------------------------------------
// ヘルパー: 1人のユーザーに関連するデータを全削除する関数
// ---------------------------------------------------------
async function deleteUserData(userId: string) {
  // 1. 関連コレクションの定義
  const collections = [
    'attendance',
    'submissions',
    'requests',
    'teacher_availability',
    'shift_assignments'
  ];

  // 2. 各コレクションから user_id が一致するドキュメントを検索して削除
  // Firestoreには「一括削除」がないため、Query -> Batch Delete の手順を踏みます
  const deletePromises = collections.map(async (colName) => {
    const snapshot = await adminDb.collection(colName).where('user_id', '==', userId).get();
    if (snapshot.empty) return;

    const batch = adminDb.batch();
    snapshot.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });
    await batch.commit();
  });

  await Promise.all(deletePromises);

  // 3. Authユーザーの削除
  try {
    await adminAuth.deleteUser(userId);
  } catch (e) {
    console.log(`Auth user ${userId} not found or already deleted.`);
  }

  // 4. プロフィール(usersコレクション)の削除
  await adminDb.collection('users').doc(userId).delete();
}

// ---------------------------------------------------------
// DELETE: 削除機能 (個別削除 & 生徒一括削除)
// ---------------------------------------------------------
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const targetId = searchParams.get('id');

    // A. 個別削除モード (ID指定あり)
    if (targetId) {
      await deleteUserData(targetId);
      return NextResponse.json({ success: true, message: '削除しました' });
    }

    // B. 全生徒削除モード (ID指定なし)
    // roleが 'student' のユーザーを検索 (最大500件)
    const snapshot = await adminDb
      .collection('users')
      .where('role', '==', 'student')
      .limit(500)
      .get();

    if (snapshot.empty) {
      return NextResponse.json({ success: true, count: 0, message: '削除対象がいません' });
    }

    const userIds = snapshot.docs.map(doc => doc.id);

    // 並列処理で削除実行
    // (数が多い場合はPromise.allの並列数を制限する必要がありますが、500程度ならVercelのタイムアウト内に収まる想定)
    await Promise.all(userIds.map(id => deleteUserData(id)));

    return NextResponse.json({ 
      success: true, 
      count: userIds.length,
      message: `${userIds.length}件削除しました。まだ残っている場合はもう一度ボタンを押してください。`
    });

  } catch (error: any) {
    console.error('DELETE Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// ---------------------------------------------------------
// POST: 作成・更新機能
// ---------------------------------------------------------
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { users } = body; 
    
    // クラス設定(ルール)を取得
    const rulesSnapshot = await adminDb.collection('class_settings').get();
    const rules = rulesSnapshot.docs.map(doc => doc.data());

    const results = [];
    const errors = [];
    const processedIds = new Set();

    for (const user of users) {
      // ID決定 (IDがない場合はスキップ)
      const loginId = user.lifetime_id || user.student_id;
      if (!loginId) {
        errors.push({ name: user.student_name, error: 'ID(生涯番号)がありません' });
        continue;
      }

      // 重複チェック (今回のリクエスト内での重複)
      const strId = String(loginId).trim();
      if (processedIds.has(strId)) continue;
      processedIds.add(strId);

      const email = `${strId}@classbase.local`;
      const password = user.password || 'class1234'; // パスワードがない場合はデフォルト

      // ロール設定
      const role = user.role || 'student';

      // 生徒の場合のみURL自動設定
      let autoUrl1 = null;
      let autoUrl2 = null;

      if (role === 'student') {
        const scienceRule = rules.find((r: any) => 
          r.grade === user.grade && 
          r.day_of_week === user.day_of_week && 
          r.subject_name === user.science_subject
        );
        const socialRule = rules.find((r: any) => 
          r.grade === user.grade && 
          r.day_of_week === user.day_of_week && 
          r.subject_name === user.social_subject
        );
        autoUrl1 = scienceRule ? scienceRule.zoom_url : null;
        autoUrl2 = socialRule ? socialRule.zoom_url : null;
      }

      let userId = '';

      // Firebase Authでユーザー検索 (メールアドレスで確認)
      try {
        const existingUser = await adminAuth.getUserByEmail(email);
        userId = existingUser.uid;
        
        // 既存ユーザー: パスワード更新
        await adminAuth.updateUser(userId, {
          password: password,
          displayName: user.student_name
        });

      } catch (authError: any) {
        // ユーザーが存在しない場合(auth/user-not-found)は新規作成
        if (authError.code === 'auth/user-not-found') {
          try {
            const newUser = await adminAuth.createUser({
              email: email,
              password: password,
              emailVerified: true,
              displayName: user.student_name
            });
            userId = newUser.uid;
          } catch (createError: any) {
            errors.push({ name: user.student_name, error: createError.message });
            continue;
          }
        } else {
          // その他のエラー
          errors.push({ name: user.student_name, error: authError.message });
          continue;
        }
      }

      // Firestoreへの保存 (upsert相当: merge: true を使用)
      await adminDb.collection('users').doc(userId).set({
        id: userId, // ドキュメント内にIDを持たせておくと便利
        role: role,
        student_name: user.student_name,
        name_kana: user.name_kana || '',
        grade: user.grade || '',
        student_id: user.student_id || '',
        lifetime_id: user.lifetime_id || '',
        classroom: user.classroom || '',
        phone_number: user.phone_number || '',
        email: email,
        day_of_week: user.day_of_week || '',
        science_subject: user.science_subject || '',
        social_subject: user.social_subject || '',
        zoom_url: autoUrl1, // 自動設定されたURL
        zoom_url_2: autoUrl2,
        raw_password: password, // ※セキュリティ的には非推奨だが要件通り保存
        updated_at: new Date()
      }, { merge: true });

      results.push(user.student_name);
    }

    return NextResponse.json({ success: true, createdCount: results.length, results, errors });

  } catch (error: any) {
    console.error('POST Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}