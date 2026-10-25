import { defineConfig } from 'vite';

// GitHub Pages ではリポジトリ名のサブパス（例: https://user.github.io/repo/）で配信される。
// base を相対パス './' にしておくと、どのサブパスに置いても静的ファイルを正しく読み込める。
// 必要なら環境変数 BASE_PATH で上書き可能（例: BASE_PATH=/kusoge-/ npm run build）。
export default defineConfig({
  base: process.env.BASE_PATH || './',
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 900,
  },
  server: {
    host: true,
  },
});
