// 旧登録者APIは現行の受講判定・署名付き参加許可証を通らず、
// 任意のZoomミーティングへ外部書き込みできるため廃止した。
export async function POST() {
  return Response.json({
    success: false,
    error: 'This endpoint has been retired. Use the authorized class participation flow.',
  }, { status: 410 });
}
