import { fileURLToPath } from 'node:url';

// 開発サーバー（next dev）は画面の即時更新に eval を使うため、開発時だけ 'unsafe-eval' を残す。
const isDev = process.env.NODE_ENV !== 'production';
// Zoom の確認が済んだら CSP_STRICT_EVAL=true で、本番の CSP からも 'unsafe-eval' を外せる。
const strictEval = process.env.CSP_STRICT_EVAL === 'true';
const CSP_REPORT_PATH = '/api/security/csp-report';

function buildContentSecurityPolicy({ allowEval, reportUri }) {
  // 'wasm-unsafe-eval' は Zoom Meeting SDK の WebAssembly 用（JavaScript の eval は許さない）。
  const evalSource = allowEval ? "'unsafe-eval'" : "'wasm-unsafe-eval'";
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src 'self' 'unsafe-inline' ${evalSource} https://source.zoom.us https://*.zoom.us`,
    "style-src 'self' 'unsafe-inline' https://source.zoom.us https://fonts.googleapis.com",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data: https://fonts.gstatic.com https://source.zoom.us",
    "connect-src 'self' https://*.googleapis.com https://*.firebaseio.com https://*.firebase.com https://*.firebaseapp.com https://securetoken.googleapis.com https://identitytoolkit.googleapis.com https://firestore.googleapis.com https://content-firebaseappcheck.googleapis.com https://www.google.com/recaptcha/ https://source.zoom.us https://*.zoom.us wss://*.zoom.us https://app.monoxer.com",
    "media-src 'self' blob: data: https:",
    "worker-src 'self' blob:",
    "frame-src 'self' https://*.zoom.us https://app.monoxer.com https://www.google.com/recaptcha/ https://recaptcha.google.com/recaptcha/",
    "manifest-src 'self'",
    ...(reportUri ? [`report-uri ${reportUri}`] : []),
  ].join('; ');
}

// 実際に効かせる CSP（Zoom Meeting SDK のため、当面は 'unsafe-eval' を残す）。
const contentSecurityPolicy = buildContentSecurityPolicy({ allowEval: isDev || !strictEval });
// 'unsafe-eval' なしの CSP を「報告だけ」で試し、違反は /api/security/csp-report へ送らせる。
const contentSecurityPolicyReportOnly = buildContentSecurityPolicy({ allowEval: isDev, reportUri: CSP_REPORT_PATH });

/** @type {import('next').NextConfig} */
const nextConfig = {
  // 必要に応じて設定を追加しますが、基本は空でOKです
  reactStrictMode: true,
  // 日本語の文節区切り（BudouX）がサーバー描画で使う linkedom は、任意の canvas が無いと代わりの簡易版を使う。
  // その「無ければ」を毎回探して警告になるため、最初から簡易版につないでおく（動きは同じ）。
  webpack(config) {
    config.resolve.alias = {
      ...config.resolve.alias,
      canvas: fileURLToPath(new URL('./node_modules/linkedom/commonjs/canvas-shim.cjs', import.meta.url)),
    };
    return config;
  },
  // Next.js 15 の組み込みlintはFlat Configへ旧CLIオプションを渡すため、
  // buildスクリプトで先に `npm run lint` を実行してからビルドする。
  eslint: { ignoreDuringBuilds: true },
  async headers() {
    return [
      {
        // 端末通知の Service Worker は更新がすぐ届くよう、ブラウザに保存させない。
        source: '/push-sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
        ],
      },
      {
        // API の応答は個人情報を含むため、ブラウザや途中の経路に保存させない（middleware でも同じ値を付ける）。
        source: '/api/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store' },
        ],
      },
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'geolocation=(), microphone=(self), camera=(self), fullscreen=(self)',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains',
          },
          {
            key: 'Content-Security-Policy',
            value: contentSecurityPolicy,
          },
          {
            key: 'Content-Security-Policy-Report-Only',
            value: contentSecurityPolicyReportOnly,
          },
        ],
      },
    ];
  },
};

export default nextConfig;
