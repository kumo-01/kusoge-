// ④ 準備画面: 遊び方の表示と準備完了ボタン
import { h, now } from '../core/util.js';
import { getGame } from '../games/registry.js';
import { playerCard, linkFor, roomSummary } from './common.js';
import { MAX_PLAYERS, NAME_MAX, cleanName } from '../core/protocol.js';

export function mount(el, app) {
  let countdownEl = null;
  let lastShown = null;
  // スライダーを動かしている間・名前を入力している間は、画面を作り直さない（作り直すと操作が途切れる）。離したら作り直す
  let holding = false;
  let pending = false;
  const release = () => {
    if (!holding || document.activeElement?.classList?.contains('name-input')) return;
    // スライダーの change（値が決まる）が先に届くように、少し待ってから
    setTimeout(() => {
      holding = false;
      if (pending) {
        pending = false;
        render();
      }
    }, 0);
  };
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);
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
    if (holding) {
      pending = true;
      return;
    }
    const room = app.room;
    const s = room.state;
    const isHost = room.role === 'host';
    const def = getGame(s.gameId);
    const myReady = s.players[room.slot]?.ready === true;
    const sum = roomSummary(s);
    const cards = [];
    for (let i = 0; i < (s.solo ? 1 : MAX_PLAYERS); i++) cards.push(playerCard(i, { me: i === room.slot, status: linkFor(app, i), ready: s.players[i].ready, colorWord: def?.colorWord || '', nick: s.players[i].name || '' }));
    countdownEl = h('div.start-countdown', { hidden: true }, h('div.cd-label', null, app.room?.state?.solo ? 'まもなく開始' : '全員準備OK！まもなく開始'), h('div.cd-num', null, '3'));
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
            def?.tips?.length ? [h('h3', null, '💡 ルール'), h('ul.tips', null, def.tips.map((t) => h('li', null, t))), def.id === 'dogKart' ? h('p.small', null, '🏁 人間のうち、先に3周した人が勝ち！') : null] : null,
          ),
          h(
            'div.ready-side',
            null,
            nameCard(s, room),
            optionsCard(def, s, isHost),
            s.solo ? null : h('div.players-row.compact.three', null, cards),
            h(
              `button.btn.btn-xl.${myReady ? 'btn-ghost' : 'btn-primary'}`,
              { onclick: () => { app.sound.play('ready'); room.setReady(!myReady); } },
              s.solo ? (myReady ? 'やめる' : '▶ スタート！') : myReady ? '準備完了を取り消す' : '✋ 準備完了！',
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

  /** 自分の名前（ゲーム中に吹き出しで出る。この端末に保存される） */
  function nameCard(s, room) {
    const cur = s.players[room.slot ?? 0]?.name || '';
    const input = h('input.name-input', {
      type: 'text',
      maxlength: String(NAME_MAX * 2),
      value: cur,
      placeholder: 'なまえ（10文字まで）',
      autocomplete: 'off',
      enterkeyhint: 'done',
      'aria-label': 'プレイヤー名',
    });
    const commit = () => {
      const n = cleanName(input.value);
      input.value = n;
      if (n !== (room.state.players[room.slot ?? 0]?.name || '')) room.setName(n);
    };
    input.addEventListener('focus', () => (holding = true));
    input.addEventListener('blur', () => {
      commit();
      holding = false;
      if (pending) {
        pending = false;
        render();
      }
    });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // 入力中のキーでゲームの操作が動かないように
      if (e.key === 'Enter') input.blur();
    });
    return h('div.card.name-card', null, h('label.option-label', null, '🏷 あなたの名前（ゲーム中に吹き出しで出ます）'), input);
  }

  function optionsCard(def, s, isHost) {
    // ひとりのときだけの設定（CPU）は、2 人以上では出さない。needs: その設定が 0 のときは出さない
    const opts = (def?.options || []).filter((opt) => (!opt.soloOnly || s.solo) && (!opt.needs || s.options?.[opt.needs]));
    if (!opts.length) return null;
    const set = (opt, v) => {
      if (s.options?.[opt.key] === v) return;
      app.sound.play('click');
      app.room.setOption(opt.key, v);
    };
    const control = (opt) => {
      const idx = Math.max(0, opt.choices.findIndex((c) => c.value === s.options?.[opt.key]));
      const cur = opt.choices[idx];
      if (opt.ui === 'slider') {
        // スライダー: 左右に動かして選ぶ（離したときに決まる）
        const val = h('span.opt-value', null, cur?.label ?? '');
        const range = h('input.opt-range', { type: 'range', min: '0', max: String(opt.choices.length - 1), step: '1', value: String(idx), disabled: !isHost, 'aria-label': opt.label });
        range.value = String(idx);
        const fill = () => range.style.setProperty('--fill', `${(Number(range.value) / Math.max(1, opt.choices.length - 1)) * 100}%`);
        fill();
        range.addEventListener('pointerdown', () => (holding = true));
        range.addEventListener('input', () => {
          val.textContent = opt.choices[Number(range.value)]?.label ?? '';
          fill();
        });
        range.addEventListener('change', () => {
          const c = opt.choices[Number(range.value)];
          holding = false;
          pending = false;
          if (c) set(opt, c.value);
        });
        const ends = h('div.opt-ends', null, h('span', null, opt.choices[0].label), h('span', null, opt.choices[opt.choices.length - 1].label));
        return h('div.opt-slider', null, h('div.opt-slider-row', null, range, val), ends);
      }
      if (opt.ui === 'toggle') {
        // トグル: 押すたびに切り替わる（選択肢の 1 つ目が「オン」）
        const on = idx === 0;
        const other = opt.choices[on ? 1 : 0];
        return h('div.opt-toggle-row', null,
          h(`button.opt-toggle${on ? '.on' : ''}`, {
            type: 'button',
            role: 'switch',
            'aria-checked': on ? 'true' : 'false',
            'aria-label': opt.label,
            disabled: !isHost,
            onclick: isHost ? () => set(opt, other.value) : null,
          }, h('span.opt-knob')),
          h('span.opt-value', null, cur?.label ?? ''));
      }
      return h('div.chips', null,
        opt.choices.map((c) => {
          const on = s.options?.[opt.key] === c.value;
          return h(`button.chip${on ? '.on' : ''}`, {
            disabled: !isHost && !on,
            'aria-pressed': on ? 'true' : 'false',
            onclick: isHost && !on ? () => set(opt, c.value) : null,
          }, c.label);
        }));
    };
    return h('div.card.options-card', null,
      opts.map((opt) =>
        h(`div.option-row${opt.ui === 'toggle' ? '.is-toggle' : ''}`, null,
          h('div.option-label', null, '⚙ ', opt.label),
          control(opt))),
      isHost ? null : h('div.small.muted', null, '設定はホストが決めます'));
  }

  render();
  return {
    update: render,
    destroy() {
      clearInterval(timer);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
    },
  };
}
