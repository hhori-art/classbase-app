import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
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

    // 各講師へ個別の内容を送信
    const promises = tasks.map(async (task: any) => {
      const res = await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          to: task.userId,
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

    await Promise.all(promises);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Push API Error:', error.message);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}