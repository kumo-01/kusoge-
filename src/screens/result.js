// ⑥ 結果画面
import { h } from '../core/util.js';
import { getGame } from '../games/registry.js';
import { dogAvatar, PLAYERS } from './common.js';

export function mount(el, app) {
  let played = false;
  function render() {
    const room = app.room;
    const s = room.state;
    const r = s.result;
    const isHost = room.role === 'host';
    const def = getGame(r?.gameId);
    const me = isHost ? 'host' : 'guest';
    if (!played && r) {
      played = true;
      app.sound.play(r.winner === me ? 'finish' : 'lose');
    }
    const col = (who) =>
      h(`div.result-player.player-${PLAYERS[who].color}${r?.winner === who ? '.is-winner' : ''}`, null,
        r?.winner === who ? h('div.crown', null, '👑') : null,
        h('div.avatar', { html: dogAvatar(PLAYERS[who].kind, 96) }),
        who === me ? h('span.me-badge.inline', null, 'あなた') : null,
        h('div.player-name', null, `${PLAYERS[who].name}（${PLAYERS[who].role}）`),
        h('div.result-headline', null, r?.[who]?.headline || ''),
        h('div.small', null, r?.[who]?.detail || ''));

    el.replaceChildren(
      h('div.screen.screen-result', null,
        h('div.confetti', { 'aria-hidden': 'true' }, Array.from({ length: 24 }, (_, i) => h('i', { style: { '--i': i } }))),
        h('p.sub', null, def ? `${def.emoji} ${def.title}` : ''),
        h('h2.result-title', null, r?.title || '結果'),
        h('div.result-row', null, col('host'), col('guest')),
        r?.stats?.length
          ? h('div.card.stats-card', null,
              h('table.stats', null,
                h('thead', null, h('tr', null, h('th', null, ''), h('th', null, `🔴 ${PLAYERS.host.name}`), h('th', null, `🔵 ${PLAYERS.guest.name}`))),
                h('tbody', null, r.stats.map((x) => h('tr', null, h('th', null, x.label), h('td', null, x.host), h('td', null, x.guest))))))
          : null,
        h('div.card.action-card', null,
          isHost
            ? h('button.btn.btn-primary.btn-xl', { onclick: () => room.goSelect() }, '🎮 ゲーム選択へ戻る')
            : h('div.waiting', null, h('span.paw-spinner', null, '🐾'), 'ホストの操作を待っています…'))),
    );
  }
  render();
  return { update: render, destroy() {} };
}
