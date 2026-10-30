// ② ホーム画面: 参加している人の接続状態。ホストがゲーム選択へ進める
import { h } from '../core/util.js';
import { playerCard, linkFor, roomSummary } from './common.js';
import { MAX_PLAYERS } from '../core/protocol.js';

export function mount(el, app) {
  function render() {
    const room = app.room;
    const isHost = room.role === 'host';
    const sum = roomSummary(room.state);
    const cards = [];
    for (let i = 0; i < MAX_PLAYERS; i++) {
      if (i > 0) cards.push(h('div.vs-badge', null, 'VS'));
      cards.push(playerCard(i, { me: i === room.slot, status: linkFor(app, i) }));
    }
    el.replaceChildren(
      h(
        'div.screen.screen-home',
        null,
        h('h2.screen-title', null, '🏠 ホーム'),
        h('div.players-row.three', null, cards),
        h(
          'div.card.action-card',
          null,
          isHost
            ? [
                h('button.btn.btn-primary.btn-xl', { onclick: () => room.goSelect() }, '🎮 ゲームを選ぶ'),
                !sum.enough || !sum.allConnected ? h('p.small.warn-text', null, '相手がいなくてもゲームは選べますが、対戦開始には2人以上そろう必要があります（最大3人）。') : null,
                h('p.small.muted', null, '招待URLは2人まで使えます（ヘッダーの「招待URL」から確認できます）。'),
              ]
            : h('div.waiting', null, h('span.paw-spinner', null, '🐾'), 'ホストがゲームを選ぶのを待っています…'),
        ),
      ),
    );
  }
  render();
  return { update: render, destroy() {} };
}
