// 画面共通のパーツ（犬のアバター、プレイヤーカードなど）
import { h } from '../core/util.js';

export const PLAYERS = {
  host: { name: '柴犬', role: 'ホスト', kind: 'shiba', color: 'red' },
  guest: { name: 'コーギー', role: 'ゲスト', kind: 'corgi', color: 'blue' },
};

/** 犬の顔の SVG（外部画像なし） */
export function dogAvatar(kind, size = 96) {
  const shiba = kind === 'shiba';
  const fur = shiba ? '#f2a04b' : '#e8893a';
  const furDark = shiba ? '#d9822e' : '#c96d22';
  const cream = '#fff4dc';
  const ears = shiba
    ? `<path d="M22 40 L30 10 L48 30 Z" fill="${fur}" stroke="${furDark}" stroke-width="2" stroke-linejoin="round"/>
       <path d="M28 34 L32 18 L42 30 Z" fill="#ffd9b0"/>
       <path d="M98 40 L90 10 L72 30 Z" fill="${fur}" stroke="${furDark}" stroke-width="2" stroke-linejoin="round"/>
       <path d="M92 34 L88 18 L78 30 Z" fill="#ffd9b0"/>`
    : `<path d="M18 46 L20 2 L52 30 Z" fill="${fur}" stroke="${furDark}" stroke-width="2" stroke-linejoin="round"/>
       <path d="M25 38 L25 14 L44 31 Z" fill="#ffc9a8"/>
       <path d="M102 46 L100 2 L68 30 Z" fill="${fur}" stroke="${furDark}" stroke-width="2" stroke-linejoin="round"/>
       <path d="M95 38 L95 14 L76 31 Z" fill="#ffc9a8"/>`;
  const face = shiba
    ? `<ellipse cx="60" cy="80" rx="30" ry="22" fill="${cream}"/>
       <circle cx="45" cy="50" r="3.4" fill="${cream}"/><circle cx="75" cy="50" r="3.4" fill="${cream}"/>`
    : `<path d="M54 30 Q60 26 66 30 L70 70 L50 70 Z" fill="${cream}"/>
       <ellipse cx="60" cy="82" rx="28" ry="20" fill="${cream}"/>`;
  const tongue = shiba ? '' : `<path d="M56 92 Q60 104 64 92 Z" fill="#ff7a93"/>`;
  return `<svg viewBox="0 0 120 120" width="${size}" height="${size}" aria-hidden="true">
    ${ears}
    <ellipse cx="60" cy="66" rx="42" ry="38" fill="${fur}" stroke="${furDark}" stroke-width="2"/>
    ${face}
    <ellipse cx="44" cy="62" rx="5.5" ry="6.5" fill="#2b2118"/><circle cx="46" cy="59.5" r="2" fill="#fff"/>
    <ellipse cx="76" cy="62" rx="5.5" ry="6.5" fill="#2b2118"/><circle cx="78" cy="59.5" r="2" fill="#fff"/>
    <ellipse cx="60" cy="76" rx="7" ry="5" fill="#2b2118"/><circle cx="58" cy="74.5" r="1.6" fill="#fff"/>
    <path d="M60 81 Q60 88 53 88 M60 81 Q60 88 67 88" stroke="#2b2118" stroke-width="2.4" fill="none" stroke-linecap="round"/>
    ${tongue}
    <ellipse cx="31" cy="77" rx="6" ry="3.6" fill="#ff9aa8" opacity=".75"/>
    <ellipse cx="89" cy="77" rx="6" ry="3.6" fill="#ff9aa8" opacity=".75"/>
  </svg>`;
}

const LINK_LABEL = {
  connected: ['オンライン', 'ok'],
  waiting: ['復帰待ち', 'warn'],
  syncing: ['同期中', 'info'],
  none: ['未参加', 'off'],
  reconnecting: ['再接続中', 'warn'],
  connecting: ['接続中', 'info'],
  failed: ['切断', 'bad'],
};

export function statusPill(state, extra) {
  const [label, tone] = LINK_LABEL[state] || [state, 'off'];
  return h(`span.pill.pill-${tone}`, null, h('span.dot'), label, extra ? ` ${extra}` : '');
}

/** プレイヤーカード */
export function playerCard(who, { me = false, status = 'connected', ready = null, extra = null } = {}) {
  const p = PLAYERS[who];
  return h(
    `div.player-card.player-${p.color}${me ? '.is-me' : ''}`,
    null,
    me ? h('span.me-badge', null, 'あなた') : null,
    h('div.avatar', { html: dogAvatar(p.kind, 88) }),
    h('div.player-name', null, p.name),
    h('div.player-role', null, `${p.role}・${p.color === 'red' ? '赤' : '青'}のカート`),
    statusPill(status),
    ready === null ? null : h(`div.ready-badge${ready ? '.on' : ''}`, null, ready ? '✔ 準備OK' : '準備中…'),
    extra,
  );
}

export function guestStatusFor(app) {
  return app.room.role === 'host' ? app.room.state.guest : app.room.state?.guest || 'connected';
}

export function hostStatusFor(app) {
  if (app.room.role === 'host') return 'connected';
  const ls = app.room.linkState;
  return ls === 'connected' ? 'connected' : ls === 'failed' ? 'failed' : 'reconnecting';
}
