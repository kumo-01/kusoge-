// ④ 準備画面: 遊び方の表示と準備完了ボタン
import { h, now } from '../core/util.js';
import { getGame } from '../games/registry.js';
import { playerCard, linkFor, roomSummary } from './common.js';
import { MAX_PLAYERS } from '../core/protocol.js';

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
    const myReady = s.players[room.slot]?.ready === true;
    const sum = roomSummary(s);
    const cards = [];
    for (let i = 0; i < MAX_PLAYERS; i++) cards.push(playerCard(i, { me: i === room.slot, status: linkFor(app, i), ready: s.players[i].ready, colorWord: def?.colorWord || '' }));
    countdownEl = h('div.start-countdown', { hidden: true }, h('div.cd-label', null, '全員準備OK！まもなく開始'), h('div.cd-num', null, '3'));
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
            def?.tips?.length ? [h('h3', null, '💡 ルール'), h('ul.tips', null, def.tips.map((t) => h('li', null, t))), h('p.small', null, '🏁 人間のうち、先に3周した人が勝ち！')] : null,
          ),
          h(
            'div.ready-side',
            null,
            optionsCard(def, s, isHost),
            h('div.players-row.compact.three', null, cards),
            h(
              `button.btn.btn-xl.${myReady ? 'btn-ghost' : 'btn-primary'}`,
              { onclick: () => { app.sound.play('ready'); room.setReady(!myReady); } },
              myReady ? '準備完了を取り消す' : '✋ 準備完了！',
            ),
            !sum.enough ? h('p.small.warn-text', null, '相手の参加を待っています…（2人以上そろうと開始できます。最大3人）') : !sum.allConnected ? h('p.small.warn-text', null, '接続が切れている人を待っています…') : null,
            isHost ? h('button.btn.btn-ghost', { onclick: () => room.goSelect() }, '← ゲーム選択へ戻る') : null,
            countdownEl,
          ),
        ),
      ),
    );
    tickCountdown();
  }

  function optionsCard(def, s, isHost) {
    if (!def?.options?.length) return null;
    return h('div.card.options-card', null,
      def.options.map((opt) =>
        h('div.option-row', null,
          h('div.option-label', null, '⚙ ', opt.label),
          h('div.chips', null,
            opt.choices.map((c) => {
              const on = s.options?.[opt.key] === c.value;
              return h(`button.chip${on ? '.on' : ''}`, {
                disabled: !isHost && !on,
                'aria-pressed': on ? 'true' : 'false',
                onclick: isHost && !on ? () => { app.sound.play('click'); app.room.setOption(opt.key, c.value); } : null,
              }, c.label);
            })),
          isHost ? null : h('div.small.muted', null, '設定はホストが決めます'))));
  }

  render();
  return {
    update: render,
    destroy() {
      clearInterval(timer);
    },
  };
}
