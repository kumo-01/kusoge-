// ② ホーム画面: 2人の接続状態。ホストがゲーム選択へ進める
import { h } from '../core/util.js';
import { playerCard, guestStatusFor, hostStatusFor } from './common.js';

export function mount(el, app) {
  function render() {
    const room = app.room;
    const isHost = room.role === 'host';
    const guest = guestStatusFor(app);
    el.replaceChildren(
      h(
        'div.screen.screen-home',
        null,
        h('h2.screen-title', null, '🏠 ホーム'),
        h('div.players-row', null,
          playerCard('host', { me: isHost, status: hostStatusFor(app) }),
          h('div.vs-badge', null, 'VS'),
          playerCard('guest', { me: !isHost, status: guest })),
        h(
          'div.card.action-card',
          null,
          isHost
            ? [
                h('button.btn.btn-primary.btn-xl', { onclick: () => room.goSelect() }, '🎮 ゲームを選ぶ'),
                guest !== 'connected' ? h('p.small.warn-text', null, 'ゲストがいなくてもゲームは選べますが、対戦開始には2人そろう必要があります。') : null,
              ]
            : h('div.waiting', null, h('span.paw-spinner', null, '🐾'), 'ホストがゲームを選ぶのを待っています…'),
        ),
      ),
    );
  }
  render();
  return { update: render, destroy() {} };
}
