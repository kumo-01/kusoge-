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
  // ゲームの中（アイテム・表示）
  bone: '<path d="m8 8 8 8"/><circle cx="6.5" cy="8" r="2"/><circle cx="8" cy="6.5" r="2"/><circle cx="17.5" cy="16" r="2"/><circle cx="16" cy="17.5" r="2"/>',
  banana: '<path d="M5 5c0 8 5 13 13 13 1.2 0 2-.6 2-1.5S19.2 15 18 15c-5.5 0-9-4-9-10"/><path d="M5 5 4 3M9 5l.6-2"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/>',
  disc: '<ellipse cx="12" cy="12" rx="9" ry="4.5"/><ellipse cx="12" cy="11" rx="4" ry="1.6"/>',
  person: '<circle cx="12" cy="7" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>',
  umbrella: '<path d="M3 12a9 9 0 0 1 18 0z"/><path d="M12 12v7a2 2 0 0 1-4 0"/>',
  house: '<path d="M3 11 12 3l9 8"/><path d="M5 10v10h14V10"/><path d="M10 20v-5h4v5"/>',
  log: '<path d="M5 8h14a4 4 0 0 1 0 8H5"/><ellipse cx="5" cy="12" rx="2.5" ry="4"/>',
  bomb: '<circle cx="11" cy="14" r="7"/><path d="m15.5 9 2-2"/><path d="M19 4.5 20 3.5M20.5 7H22M18.5 2.5V1"/>',
  rod: '<path d="M3 21 18 4"/><path d="M18 4v11"/><path d="M18 15a2 2 0 1 1-2 2"/>',
  giant: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
  reverse: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  license: '<rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="8" cy="12" r="2.5"/><path d="M14 10h5M14 14h4"/>',
  thick: '<circle cx="12" cy="12" r="6.5" stroke-width="4"/>',
  triple: '<path d="M12 21V4M12 21 5 7M12 21l7-14"/>',
  bounce: '<path d="M3 5l8 14 10-14"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  cloud: '<path d="M7 18h10a4 4 0 0 0 0-8 6 6 0 0 0-11.5 1.5A3.3 3.3 0 0 0 7 18z"/>',
  spiral: '<path d="M12 12a1 1 0 1 1 1 1 3 3 0 1 1-3-3 5 5 0 1 1 5 5 7 7 0 1 1-7-7"/>',
  scissors: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"/>',
  candy: '<circle cx="12" cy="12" r="5"/><path d="M7 12 3 9v6zM17 12l4-3v6z"/>',
  heal: '<path d="M12 20s-8-5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 9c0 6-8 11-8 11z"/><path d="M12 9v5M9.5 11.5h5"/>',
  heart: '<path d="M12 20s-8-5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 9c0 6-8 11-8 11z"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>',
  ring: '<ellipse cx="12" cy="12" rx="8.5" ry="5.5"/>',
  food: '<path d="M3 12h18a9 8 0 0 1-18 0z"/><circle cx="9" cy="9" r="1.5"/><circle cx="14" cy="8" r="1.5"/>',
  camera: '<path d="M3 7h4l2-3h6l2 3h4v13H3z"/><circle cx="12" cy="13" r="4"/>',
  gear: '<circle cx="12" cy="12" r="3.5"/><path d="M12 2v3M12 19v3M4.9 4.9 7 7M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1"/>',
  fullscreen: '<path d="M3 9V3h6M21 9V3h-6M3 15v6h6M21 15v6h-6"/>',
  phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
  car: '<path d="M4 17h16v-5l-2.5-5h-11L4 12z"/><path d="M4 12h16"/><circle cx="8" cy="17" r="2"/><circle cx="16" cy="17" r="2"/>',
  wheel: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2"/><path d="M12 3v7M4.5 16.5l5.8-3.5M19.5 16.5l-5.8-3.5"/>',
  pen: '<path d="M4 20l4-1 11-11-3-3L5 16z"/><path d="m14 7 3 3"/>',
  eraser: '<path d="M8 20 3 15 13 5l7 7-8 8z"/><path d="M8 20h13M8 10l6 6"/>',
  hand: '<path d="M8 13V5a1.5 1.5 0 0 1 3 0v6M11 10V4a1.5 1.5 0 0 1 3 0v6M14 10V5a1.5 1.5 0 0 1 3 0v8a7 7 0 0 1-12 5l-2-4a1.5 1.5 0 0 1 2.5-1.5L8 15"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  headphones: '<path d="M3 18v-6a9 9 0 0 1 18 0v6"/><rect x="2" y="15" width="5" height="6" rx="1"/><rect x="17" y="15" width="5" height="6" rx="1"/>',
  wifi: '<path d="M2 9a15 15 0 0 1 20 0M5 13a10 10 0 0 1 14 0M8.5 16.5a5 5 0 0 1 7 0"/><path d="M12 20h.01"/>',
  trophy: '<path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4M12 14v4M8 21h8"/>',
  gift: '<rect x="3" y="9" width="18" height="12"/><path d="M12 9v12M3 13h18"/><path d="M12 9c-1.5-3.5-6-4-6-1.5S12 9 12 9s6 .5 6-1.5-4.5-2-6 1.5"/>',
  burst: '<path d="m12 2 2 6 6-2-4 5 6 3-7 1 1 7-4-5-4 5 1-7-7-1 6-3-4-5 6 2z"/>',
  mouse: '<rect x="6" y="3" width="12" height="18" rx="6"/><path d="M12 7v4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  // ゲーム
  flag: '<path d="M4 22V3"/><path d="M4 4h15l-3 5 3 5H4"/>',
  crosshair: '<circle cx="12" cy="12" r="8"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>',
  angle: '<path d="M3 20h18"/><path d="M3 20 17 5"/><path d="M10 20a7 7 0 0 0-2.2-5.1"/>',
  map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
  zap: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  arrow: '<path d="M12 20V5"/><path d="m5 11 7-7 7 7"/>',
  drum: '<ellipse cx="12" cy="9" rx="8" ry="3"/><path d="M4 9v7c0 1.7 3.6 3 8 3s8-1.3 8-3V9"/><path d="m17 2-4 6M7 2l4 6"/>',
};

/** ゲームごとのアイコン */
export const GAME_ICON = { dogKart: 'flag', gomuBattle: 'crosshair', angleDuel: 'angle', prefBattle: 'map', reaction: 'zap', rhythm: 'drum' };

/** 文の頭の絵文字 → アイコン（ゲーム中のお知らせ・状態の文を、絵文字なしで出すため） */
const EMOJI_ICON = {
  '🍖': 'food', '🥏': 'disc', '🍌': 'banana', '🪵': 'log', '💣': 'bomb', '💪': 'giant', '🏠': 'house', '🎣': 'rod',
  '👴': 'reverse', '🪪': 'license', '🦴': 'bone', '💥': 'burst', '🏁': 'flag', '⚡': 'zap', '👑': 'crown', '⚠': 'alert',
  '☔': 'umbrella', '🎵': 'music', '🎥': 'camera', '⚙': 'gear', '⛶': 'fullscreen', '📱': 'phone', '📶': 'wifi', '⏸': 'pause',
  '🛡': 'shield', '🧑': 'person', '🎯': 'target', '🏆': 'trophy', '🗾': 'map', '🎁': 'gift', '🍬': 'candy', '🌀': 'spiral',
  '✂': 'scissors', '⭐': 'star', '🖱': 'mouse', '🎧': 'headphones', '🥁': 'drum', '✅': 'check', '✔': 'check', '⌛': 'clock',
  '⏱': 'clock', '🔥': 'zap', '🚗': 'car', '🎡': 'wheel', '🔱': 'triple', '🏓': 'bounce', '💨': 'cloud', '✨': 'star',
};

/** 文の頭の絵文字を、アイコン + 絵文字なしの文に（頭にないときは文だけ） */
export function iconText(text, size = 18) {
  if (typeof text !== 'string') return text;
  const m = text.match(/^\s*((?:\p{Extended_Pictographic}|\p{Regional_Indicator})[\uFE0F\u200D]*)/u);
  const name = m ? EMOJI_ICON[m[1].replace(/[\uFE0F\u200D]/g, '')] : null;
  const rest = noEmoji(text);
  return name ? h('span.icon-text', null, icon(name, size), rest) : rest;
}

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
