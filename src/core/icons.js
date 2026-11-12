// 画面で使うアイコン（線で描く 24 × 24 の SVG。色は文字の色）。絵文字をアイコンとして使わない
import { h } from './util.js';

const P = {
  volume: '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/>',
  mute: '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="m22 9-6 6"/><path d="m16 9 6 6"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  musicOff: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/><path d="m2 2 20 20"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  play: '<path d="M7 4v16l13-8z"/>',
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  dice: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="16" cy="16" r="1.4"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  loader: '<path d="M21 12a9 9 0 1 1-6.2-8.6"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  alert: '<path d="M12 3 2 21h20z"/><path d="M12 10v5"/><path d="M12 18h.01"/>',
  crown: '<path d="M3 18h18L19 7l-5 5-2-7-2 7-5-5z"/>',
  // ゲーム
  flag: '<path d="M4 22V3"/><path d="M4 4h15l-3 5 3 5H4"/>',
  crosshair: '<circle cx="12" cy="12" r="8"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>',
  angle: '<path d="M3 20h18"/><path d="M3 20 17 5"/><path d="M10 20a7 7 0 0 0-2.2-5.1"/>',
  map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
  zap: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  drum: '<ellipse cx="12" cy="9" rx="8" ry="3"/><path d="M4 9v7c0 1.7 3.6 3 8 3s8-1.3 8-3V9"/><path d="m17 2-4 6M7 2l4 6"/>',
};

/** ゲームごとのアイコン */
export const GAME_ICON = { dogKart: 'flag', gomuBattle: 'crosshair', angleDuel: 'angle', prefBattle: 'map', reaction: 'zap', rhythm: 'drum' };

/** アイコンの SVG 文字列 */
export function iconSvg(name, size = 20) {
  return `<svg class="ic" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
}

/** アイコンの要素（span の中に SVG） */
export function icon(name, size = 20, cls = '') {
  return h(`span.icon${cls ? `.${cls}` : ''}`, { html: iconSvg(name, size), 'aria-hidden': 'true' });
}

/** 読み込み中のくるくる */
export function spinner() {
  return icon('loader', 20, 'spin');
}

const EMOJI = /(?:\p{Extended_Pictographic}|\p{Regional_Indicator})(?:️|‍|\p{Extended_Pictographic}|\p{Emoji_Modifier})*/gu;

/** 文の中の絵文字を取りのぞく（ゲームの説明・ルール・結果の文） */
export function noEmoji(text) {
  if (typeof text !== 'string') return text;
  return text.replace(EMOJI, '').replace(/[️‍]/g, '').replace(/\s{2,}/g, ' ').trim();
}
