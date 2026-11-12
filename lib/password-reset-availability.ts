/**
 * パスワードを忘れたときの自分での再設定（生徒・保護者の照合／講師の確認済みメール／「メールが使えない」の依頼）を受け付けるか。
 * セキュリティチェック（KDL診断）が終わるまでは止め、サポートセンターへの電話を案内する（2026-11-04 決定）。
 * 再開するときは Vercel の環境変数 NEXT_PUBLIC_PASSWORD_RESET_ENABLED=true を入れて反映する（画面とAPIの両方が切り替わる）。
 * 管理者が発行する再設定リンク（/api/auth/password-reset）とログイン中の端末からの変更は止めない。
 */
export function selfServicePasswordResetEnabled() {
  return process.env.NEXT_PUBLIC_PASSWORD_RESET_ENABLED === 'true';
}

export const PASSWORD_SUPPORT_PHONE = '078-321-4123';
export const PASSWORD_SUPPORT_HOURS = '18:00〜21:00';
