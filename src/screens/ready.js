// ④ 準備画面: 遊び方の表示と準備完了ボタン
import { h, now } from '../core/util.js';
import { getGame } from '../games/registry.js';
import { playerCard, guestStatusFor, hostStatusFor } from './common.js';

export function mount(el, app) {
  let countdownEl = null;
  let lastShown = null;
  const timer = setInterval(tickCountdown, 100);

  function startAt() {
    const room = app.room;
    return room.role === 'host' ? room._startAt : room.startAt;
  }

  function tickCountdown() {
    if (!countdownEl) return;
    const at = startAt();
    if (!at) {
      countdownEl.hidden = true;
      lastShown = null;
      return;
    }
    const sec = Math.max(1, Math.ceil((at - now()) / 1000));
    countdownEl.hidden = false;
    if (sec !== lastShown) {
      lastShown = sec;
      countdownEl.querySelector('.cd-num').textContent = String(sec);
      app.sound.play('beep');
    }
  }

  function render() {
    const room = app.room;
    const s = room.state;
    const isHost = room.role === 'host';
    const def = getGame(s.gameId);
    const me = isHost ? 'host' : 'guest';
    const myReady = s.ready[me];
    const guest = guestStatusFor(app);
    countdownEl = h('div.start-countdown', { hidden: true }, h('div.cd-label', null, '2人とも準備OK！まもなく開始'), h('div.cd-num', null, '3'));
    lastShown = null;

    el.replaceChildren(
      h(
        'div.screen.screen-ready',
        null,
        h('h2.screen-title', null, def ? `${def.emoji} ${def.title}` : 'ゲーム'),
        def ? h('p.sub', null, def.description) : null,
        h(
          'div.ready-layout',
          null,
          h(
            'div.card.howto',
            null,
            h('h3', null, '⌨ 操作方法'),
            def
              ? h('table.controls', null,
                  h('tbody', null, def.controls.map(([k, v]) => h('tr', null, h('td', null, h('kbd', null, k)), h('td', null, v)))))
              : null,
            def?.tips?.length ? [h('h3', null, '💡 ルール'), h('ul.tips', null, def.tips.map((t) => h('li', null, t))), h('p.small', null, '🏁 先に3周したほうが勝ち！')] : null,
          ),
          h(
            'div.ready-side',
            null,
            h('div.players-row.compact', null,
              playerCard('host', { me: isHost, status: hostStatusFor(app), ready: s.ready.host }),
              playerCard('guest', { me: !isHost, status: guest, ready: s.ready.guest })),
            h(
              `button.btn.btn-xl.${myReady ? 'btn-ghost' : 'btn-primary'}`,
              { onclick: () => { app.sound.play('ready'); room.setReady(!myReady); } },
              myReady ? '準備完了を取り消す' : '✋ 準備完了！',
            ),
            guest !== 'connected' ? h('p.small.warn-text', null, 'ゲストの接続を待っています…（2人そろうと開始できます）') : null,
            isHost ? h('button.btn.btn-ghost', { onclick: () => room.goSelect() }, '← ゲーム選択へ戻る') : null,
            countdownEl,
          ),
        ),
      ),
    );
    tickCountdown();
  }

  render();
  return {
    update: render,
    destroy() {
      clearInterval(timer);
    },
  };
}
