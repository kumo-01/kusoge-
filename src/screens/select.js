// ③ ゲーム選択画面: 登録されたゲームをカードで表示。選べるのはホストだけ
// 一番上の「ランダムで選ぶ」: カードを順に光らせるルーレットのあと、選ばれたゲームのカードが光り続ける
import { h } from '../core/util.js';
import { GAMES } from '../games/registry.js';

export function mount(el, app) {
  let lit = null; // いま光っているゲーム
  let picked = false; // ルーレットが止まった
  let timer = null;

  function spin() {
    if (timer) return;
    picked = false;
    // だんだん遅くなるルーレット。止まる所は先に決めておく（同じゲームが続けて当たることもある）
    const goal = Math.floor(Math.random() * GAMES.length);
    const start = GAMES.findIndex((g) => g.id === lit) + 1;
    const steps = GAMES.length * 3 + ((goal - start + GAMES.length * 10) % GAMES.length);
    let k = 0;
    const tick = () => {
      lit = GAMES[(start + k) % GAMES.length].id;
      k++;
      if (k > steps) {
        timer = null;
        picked = true;
        app.sound.play('ready');
        render();
        el.querySelector('.game-card.is-picked')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        return;
      }
      app.sound.play('click');
      render();
      const left = steps - k;
      timer = setTimeout(tick, 55 + Math.max(0, 9 - left) ** 2 * 6);
    };
    tick();
  }

  function render() {
    const room = app.room;
    const isHost = room.role === 'host';
    const spinning = !!timer;
    el.replaceChildren(
      h(
        'div.screen.screen-select',
        null,
        h('h2.screen-title', null, room.solo ? '🎮 ひとりで遊ぶゲームを選ぼう' : '🎮 ゲームを選ぼう'),
        isHost ? null : h('p.sub', null, 'ホストがゲームを選んでいます…'),
        isHost
          ? h('div.random-row', null,
              h('button.btn.btn-primary.btn-random', { onclick: spin, disabled: spinning }, spinning ? '🎲 選んでいます…' : picked ? '🎲 もう一度ランダムで選ぶ' : '🎲 ランダムで選ぶ'),
              picked && lit ? h('p.small.center', null, `「${GAMES.find((g) => g.id === lit)?.title}」に決まり！光っているカードを押して始めよう`) : null)
          : null,
        h(
          'div.game-grid',
          null,
          GAMES.map((g) =>
            h(
              `button.game-card${isHost ? '' : '.is-locked'}${g.id === lit ? (picked ? '.is-picked' : '.is-lit') : ''}`,
              {
                onclick: isHost && !spinning ? () => room.chooseGame(g.id) : null,
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
        isHost ? h('div.btn-row.center', null, room.solo ? h('button.btn.btn-ghost', { onclick: () => app.disband() }, '← タイトルへ') : h('button.btn.btn-ghost', { onclick: () => room.goHome() }, '← ホームへ')) : null,
      ),
    );
  }
  render();
  return {
    update: render,
    destroy() {
      clearTimeout(timer);
      timer = null;
    },
  };
}
