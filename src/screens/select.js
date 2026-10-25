// ③ ゲーム選択画面: 登録されたゲームをカードで表示。選べるのはホストだけ
import { h } from '../core/util.js';
import { GAMES } from '../games/registry.js';

export function mount(el, app) {
  function render() {
    const room = app.room;
    const isHost = room.role === 'host';
    el.replaceChildren(
      h(
        'div.screen.screen-select',
        null,
        h('h2.screen-title', null, '🎮 ゲームを選ぼう'),
        isHost ? null : h('p.sub', null, 'ホストがゲームを選んでいます…'),
        h(
          'div.game-grid',
          null,
          GAMES.map((g) =>
            h(
              `button.game-card${isHost ? '' : '.is-locked'}`,
              {
                onclick: isHost ? () => room.chooseGame(g.id) : null,
                disabled: !isHost,
                'aria-label': `${g.title}を選ぶ`,
              },
              h('div.game-card-art', null, h('span', null, g.emoji), h('span.paw', null, '🐾')),
              h('div.game-card-body', null,
                h('div.game-card-title', null, g.title),
                h('div.game-card-tag', null, g.players),
                h('p', null, g.tagline)),
              isHost ? h('div.game-card-cta', null, 'これで遊ぶ！') : null,
            ),
          ),
        ),
        h('p.small.muted.center', null, 'ほかのミニゲームは今後追加予定です。'),
        isHost ? h('div.btn-row.center', null, h('button.btn.btn-ghost', { onclick: () => room.goHome() }, '← ホームへ')) : null,
      ),
    );
  }
  render();
  return { update: render, destroy() {} };
}
