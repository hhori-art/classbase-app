/**
 * 脆弱性を探る典型的なアクセス（このアプリには存在しない PHP・WordPress・設定ファイルなど）。
 * 監視のため /api/security/probe へ振り替えて記録し、404 を返す。
 */
const PROBE_PATTERN = /(?:\.(?:php\d?|phtml|asp|aspx|jsp|cgi|pl|env|ini|sql|bak|old|swp|git|svn|htaccess|htpasswd|DS_Store)(?:$|\/))|(?:^\/(?:wp-admin|wp-login|wp-content|wp-includes|xmlrpc|phpmyadmin|pma|cgi-bin|vendor\/phpunit|\.git|\.env|\.aws|\.ssh|actuator|server-status|boaform|HNAP1))/i;

export function isProbePath(pathname: string) {
  return PROBE_PATTERN.test(pathname);
}
