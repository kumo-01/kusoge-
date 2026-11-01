import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';

// 画面に出すバージョン: 最後のコミットの日時（日本時間）とコミットの短い ID。git が使えなければビルドした日時
function appVersion() {
  const fmt = (d) => {
    const j = new Date(d.getTime() + 9 * 3600e3);
    const p = (n) => String(n).padStart(2, '0');
    return `${j.getUTCFullYear()}.${p(j.getUTCMonth() + 1)}.${p(j.getUTCDate())}-${p(j.getUTCHours())}${p(j.getUTCMinutes())}`;
  };
  try {
    const [t, sha] = execSync('git log -1 --format="%ct %h"', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().split(' ');
    return `v${fmt(new Date(+t * 1000))} (${sha})`;
  } catch {
    return `v${fmt(new Date())}`;
  }
}

// GitHub Pages ではリポジトリ名のサブパス（例: https://user.github.io/repo/）で配信される。
// base を相対パス './' にしておくと、どのサブパスに置いても静的ファイルを正しく読み込める。
// 必要なら環境変数 BASE_PATH で上書き可能（例: BASE_PATH=/kusoge-/ npm run build）。
export default defineConfig({
  base: process.env.BASE_PATH || './',
  define: {
    __APP_VERSION__: JSON.stringify(appVersion()),
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 900,
  },
  server: {
    host: true,
  },
});
