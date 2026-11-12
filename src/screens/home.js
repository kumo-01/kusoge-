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
      cards.push(playerCard(i, { me: i === room.slot, status: linkFor(app, i), nick: room.state?.players?.[i]?.name || '' }));
    }
    el.replaceChildren(
      h(
        'div.screen.screen-home',
        null,
        h('h2.screen-title', null, 'メンバー'),
        h('div.players-row', null, cards),
        h(
          'div.card.action-card',
          null,
          isHost
            ? [
                h('button.btn.btn-primary.btn-xl', { onclick: () => room.goSelect() }, 'ゲームを選ぶ'),
                !sum.enough || !sum.allConnected ? h('p.small.warn-text', null, 'ゲームは先に選べます。始めるには2人以上が必要です（最大4人）。') : null,
                h('p.small.muted', null, '招待URLは、上の「招待URL」からいつでも見られます。3人まで参加できます。'),
              ]
            : h('div.waiting', null, h('span.paw-spinner', null, '🐾'), 'ホストがゲームを選ぶのを待っています…'),
        ),
      ),
    );
  }
  render();
  return { update: render, destroy() {} };
}
