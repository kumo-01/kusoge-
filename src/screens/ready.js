// ④ 準備画面: 遊び方の表示と準備完了ボタン
import { icon, noEmoji, GAME_ICON } from '../core/icons.js';
import { h, now } from '../core/util.js';
import { getGame } from '../games/registry.js';
import { playerCard, linkFor, roomSummary, PLAYERS } from './common.js';
import { TEAMS, TEAM_CPU_BIT, BOT_DOGS, autoTeamBits } from '../games/gomuBattle/constants.js';
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
    countdownEl = h('div.start-countdown', { hidden: true }, h('div.cd-label', null, app.room?.state?.solo ? 'まもなく始まります' : '全員そろいました。まもなく始まります'), h('div.cd-num', null, '3'));
    lastShown = null;

    const tips = (def?.tips || []).map(noEmoji);
    const TIPS_SHOWN = 6; // 長いルールは、最初の数行だけ見せて残りはたたむ
    el.replaceChildren(
      h(
        'div.screen.screen-ready',
        null,
        h('header.ready-head', { style: { '--g': def?.color || '#1d2747' } },
          h('div.ready-icon', { 'aria-hidden': 'true' }, h('span.emo', null, icon(GAME_ICON[def?.id] || 'dice', 36))),
          h('h2.screen-title', null, def ? def.title : 'ゲーム'),
          def ? h('p', null, noEmoji(def.description)) : null),
        h(
          'div.ready-layout',
          null,
          h(
            'div.ready-side',
            null,
            nameCard(s, room),
            optionsCard(def, s, isHost),
            s.solo ? null : h('div.players-row.compact', null, cards),
            h('div.ready-actions', null,
              h(
                `button.btn.btn-xl.${myReady ? 'btn-light' : 'btn-primary'}`,
                { onclick: () => { app.sound.play('ready'); room.setReady(!myReady); } },
                s.solo ? (myReady ? 'やめる' : 'スタート') : myReady ? '準備OKを取り消す' : '準備OK',
              ),
              !sum.enough ? h('p.small.warn-text', null, '相手の参加を待っています。2人以上で始められます（最大4人）。') : !sum.allConnected ? h('p.small.warn-text', null, '接続が切れている人を待っています。') : null,
              isHost ? h('button.btn.btn-ghost', { onclick: () => room.goSelect() }, 'ゲームを選び直す') : null),
            countdownEl,
          ),
          h(
            'section.card.howto',
            null,
            h('h3', null, '操作'),
            def
              ? h('table.controls', null,
                  h('tbody', null, def.controls.map(([k, v]) => h('tr', null, h('td', null, h('kbd', null, noEmoji(k))), h('td', null, noEmoji(v))))))
              : null,
            tips.length
              ? [
                  h('h3', null, 'ルール'),
                  h('ul.tips', null, tips.slice(0, TIPS_SHOWN).map((t) => h('li', null, t))),
                  tips.length > TIPS_SHOWN
                    ? h('details.tips-more', null,
                        h('summary', null, `ルールの続きを見る（あと${tips.length - TIPS_SHOWN}件）`),
                        h('ul.tips', null, tips.slice(TIPS_SHOWN).map((t) => h('li', null, t))))
                    : null,
                  def.id === 'dogKart' ? h('p.small', null, '人間のうち、先に3周した人が勝ち。') : null,
                ]
              : null,
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
    return h('div.card.name-card', null, h('label.option-label', null, 'あなたの名前', h('span.muted', null, '（ゲーム中に吹き出しで出ます）')), input);
  }

  function optionsCard(def, s, isHost) {
    // ひとりのときだけの設定（CPU）は、2 人以上では出さない。needs: その設定が 0 のときは出さない
    // showIf: ほかの設定がその値のときだけ出す（例: チーム分けはチーム戦のときだけ）
    const opts = (def?.options || []).filter((opt) => (!opt.soloOnly || s.solo) && (!opt.needs || s.options?.[opt.needs]) && (!opt.showIf || s.options?.[opt.showIf.key] === opt.showIf.value));
    if (!opts.length) return null;
    const set = (opt, v) => {
      if (s.options?.[opt.key] === v) return;
      app.sound.play('click');
      app.room.setOption(opt.key, v);
    };
    const control = (opt) => {
      if (opt.ui === 'teams') return teamsControl(opt, s, isHost, set);
      const idx = Math.max(0, opt.choices.findIndex((c) => c.value === s.options?.[opt.key]));
      const cur = opt.choices[idx];
      if (opt.ui === 'slider') {
        // スライダー: 左右に動かして選ぶ（離したときに決まる）
        const val = h('span.opt-value', null, noEmoji(cur?.label ?? ''));
        const range = h('input.opt-range', { type: 'range', min: '0', max: String(opt.choices.length - 1), step: '1', value: String(idx), disabled: !isHost, 'aria-label': opt.label });
        range.value = String(idx);
        const fill = () => range.style.setProperty('--fill', `${(Number(range.value) / Math.max(1, opt.choices.length - 1)) * 100}%`);
        fill();
        range.addEventListener('pointerdown', () => (holding = true));
        range.addEventListener('input', () => {
          val.textContent = noEmoji(opt.choices[Number(range.value)]?.label ?? '');
          fill();
        });
        range.addEventListener('change', () => {
          const c = opt.choices[Number(range.value)];
          holding = false;
          pending = false;
          if (c) set(opt, c.value);
        });
        const ends = h('div.opt-ends', null, h('span', null, noEmoji(opt.choices[0].label)), h('span', null, noEmoji(opt.choices[opt.choices.length - 1].label)));
        return h('div.opt-slider', null, h('div.opt-slider-row', null, range, val), ends);
      }
      if (opt.ui === 'gallery') {
        // 写真を並べて選ぶ（写真の左上に名前）。写真のない選択肢（ランダム）は絵文字の札
        return h('div.opt-gallery', null,
          opt.choices.map((c) => {
            const on = s.options?.[opt.key] === c.value;
            return h(`button.opt-tile${on ? '.on' : ''}${c.img ? '' : '.no-img'}`, {
              type: 'button',
              disabled: !isHost && !on,
              'aria-pressed': on ? 'true' : 'false',
              title: noEmoji(c.label),
              onclick: isHost && !on ? () => set(opt, c.value) : null,
            },
            c.img ? h('img', { src: c.img, alt: '', loading: 'lazy', decoding: 'async', draggable: 'false' }) : h('span.opt-tile-big', null, icon('dice', 36)),
            h('span.opt-tile-name', null, noEmoji(c.label)),
            on ? h('span.opt-tile-check', null, icon('check', 14)) : null);
          }));
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
          h('span.opt-value', null, noEmoji(cur?.label ?? '')));
      }
      return h('div.chips', null,
        opt.choices.map((c) => {
          const on = s.options?.[opt.key] === c.value;
          return h(`button.chip${on ? '.on' : ''}`, {
            disabled: !isHost && !on,
            'aria-pressed': on ? 'true' : 'false',
            onclick: isHost && !on ? () => set(opt, c.value) : null,
          }, noEmoji(c.label));
        }));
    };
    return h('div.card.options-card', null,
      opts.map((opt) =>
        h(`div.option-row${opt.ui === 'toggle' ? '.is-toggle' : ''}`, null,
          h('div.option-label', null, noEmoji(opt.label)),
          control(opt))),
      isHost ? null : h('div.small.muted', null, '設定はホストが決めます'));
  }

  /**
   * チーム分け: 参加する人（席）と CPU を、あか・あおの 2 列に並べる。ホストが押すと、もう片方のチームへ移る
   * 値はビット（0〜3 = 人の席、4〜 = CPU。1 = あお）。-1 は自動（交互）
   */
  function teamsControl(opt, s, isHost, set) {
    const slots = s.solo ? [0] : roomSummary(s).occupied;
    const nBots = Math.max(0, s.options?.bots | 0);
    const cur = s.options?.[opt.key];
    const bits = Number.isInteger(cur) && cur >= 0 ? cur : autoTeamBits(slots, nBots);
    const members = [
      ...slots.map((slot) => ({ bit: slot, name: s.players[slot]?.name || PLAYERS[slot]?.name || `プレイヤー${slot + 1}`, cpu: false })),
      ...Array.from({ length: nBots }, (_, k) => ({ bit: TEAM_CPU_BIT + k, name: `${BOT_DOGS[k % BOT_DOGS.length].name}（CPU）`, cpu: true })),
    ];
    const col = (t) =>
      h('div.team-col', { style: { '--c': TEAMS[t].css } },
        h('div.team-col-head', null, TEAMS[t].name),
        members
          .filter((m) => ((bits >> m.bit) & 1) === t)
          .map((m) =>
            h(`button.team-member${m.cpu ? '.is-cpu' : ''}`, {
              type: 'button',
              disabled: !isHost,
              title: isHost ? `${TEAMS[1 - t].name}へ移す` : '',
              onclick: isHost ? () => set(opt, bits ^ (1 << m.bit)) : null,
            }, h('span', null, m.name), isHost ? icon('reverse', 14) : null)));
    const empty = [0, 1].some((t) => !members.some((m) => ((bits >> m.bit) & 1) === t));
    return h('div.opt-teams', null,
      h('div.team-cols', null, col(0), col(1)),
      empty ? h('p.small.warn-text', null, '片方のチームがだれもいません（このまま始めると、交互に分けます）') : null,
      isHost
        ? h('div.team-foot', null,
            h('span.small.muted', null, '名前を押すと、もう片方のチームへ移ります'),
            Number.isInteger(cur) && cur >= 0 ? h('button.chip', { type: 'button', onclick: () => set(opt, -1) }, '自動（交互）にもどす') : null)
        : null);
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
