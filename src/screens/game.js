// ⑤ ゲーム画面のオーバーレイ（3D描画とHUDはゲームモジュールが担当）
// ホスト専用ボタン（一時停止・中止・解散）と、一時停止/再接続/再開カウントダウンの表示。
import { h, now } from '../core/util.js';
import { PLAYERS } from './common.js';

const REASON_TEXT = {
  disconnect: '通信が切れたため一時停止中',
  host: 'ホストが一時停止中',
  hidden: 'ホストが画面を離れています',
};

export function mount(el, app) {
  let cdEl = null;
  let lastCd = null;
  const timer = setInterval(tick, 100);

  const onKey = (e) => {
    if (e.code !== 'Escape' || app.room.role !== 'host') return;
    const m = app.room.state.match;
    if (m?.status === 'running') app.room.pauseGame();
  };
  window.addEventListener('keydown', onKey);

  function resumeAt() {
    return app.room.resumeAt || 0;
  }

  function tick() {
    if (!cdEl) return;
    const m = app.room.state?.match;
    const at = resumeAt();
    const remain = at - now();
    if (m?.status !== 'resuming' || remain <= 0) {
      cdEl.hidden = true;
      lastCd = null;
      return;
    }
    const n = Math.ceil(remain / 1000);
    cdEl.hidden = false;
    if (n !== lastCd) {
      lastCd = n;
      cdEl.textContent = String(n);
      cdEl.classList.remove('pop');
      void cdEl.offsetWidth;
      cdEl.classList.add('pop');
      app.sound.play('beep');
    }
  }

  function render() {
    const room = app.room;
    const s = room.state;
    const m = s?.match;
    const isHost = room.role === 'host';
    cdEl = h('div.resume-countdown', { hidden: true });
    lastCd = null;

    const muteBtn = h('span.btn-pair', null,
      h('button.btn.btn-small.btn-light', { onclick: () => app.toggleMute(), title: '効果音のオン/オフ' }, app.sound.muted ? '🔇' : '🔊'),
      h('button.btn.btn-small.btn-light', { onclick: () => app.toggleMusic(), title: 'BGM のオン/オフ' }, app.music.muted ? '🎵✕' : '🎵'));
    const topButtons = isHost
      ? h('div.game-topbar', null,
          muteBtn,
          h('button.btn.btn-small.btn-light', { onclick: () => room.pauseGame(), disabled: m?.status !== 'running', title: 'Esc' }, '⏸ 一時停止'),
          h('button.btn.btn-small.btn-danger', { onclick: () => confirmAbort() }, '✖ ゲームを中止'))
      : h('div.game-topbar', null, muteBtn);

    let panel = null;
    const guests = (m?.players || []).filter((slot) => slot > 0);
    const sitting = !isHost && m && !m.players.includes(room.slot);
    if (sitting) {
      // この試合に参加していない人（試合の途中で入ってきた人）は、終わるまで待つ
      panel = h('div.pause-panel.card', null,
        h('div.waiting.big', null, h('span.paw-spinner', null, '🐾'), 'いま対戦中です。終わるまでお待ちください'),
        h('p.small.muted', null, '次のレースから参加できます。'));
    } else if (m && m.status === 'loading') {
      const away = guests.some((g) => s.players[g].link !== 'connected' && s.players[g].link !== 'syncing');
      panel = h('div.pause-panel.card', null,
        h('div.waiting.big', null, h('span.paw-spinner', null, '🐾'), isHost ? (away ? 'みんなの接続を待っています…' : 'みんなの読み込みを待っています…') : 'ゲームを読み込んでいます…'),
        isHost ? hostPanelButtons(false) : null);
    } else if (m && m.status === 'paused') {
      panel = h('div.pause-panel.card', null,
        h('h2', null, '⏸ 一時停止中'),
        h('p', null, REASON_TEXT[m.reason] || '一時停止中'),
        statusLine(room),
        isHost ? hostPanelButtons(true) : h('p.small.muted', null, 'ホストが再開するまでお待ちください。'));
    }

    el.replaceChildren(h('div.screen-game-overlay', null, topButtons, panel ? h('div.pause-backdrop', null, panel) : null, cdEl));
    tick();
  }

  function statusLine(room) {
    const m = room.state.match;
    if (room.role === 'host') {
      const guests = (m?.players || []).filter((slot) => slot > 0);
      const name = (slot) => PLAYERS[slot].role;
      const waiting = guests.filter((g) => room.state.players[g].link === 'waiting');
      const left = guests.filter((g) => room.state.players[g].link === 'none');
      const syncing = guests.filter((g) => room.state.players[g].link === 'syncing');
      if (waiting.length) return h('div.waiting', null, h('span.paw-spinner', null, '🐾'), `${waiting.map(name).join('・')}の再接続を待っています…（時間制限なし）`);
      if (left.length) return h('p.warn-text', null, `${left.map(name).join('・')}が退出しました。ゲームを中止してください。`);
      if (syncing.length) return h('div.waiting', null, h('span.paw-spinner', null, '🔄'), `${syncing.map(name).join('・')}にゲーム状態を送っています…`);
      if (room.state.hostHidden) return h('p.small', null, 'このタブに戻ると再開できます。');
      return h('p.ok-text', null, '✔ みんなと同期しました。再開できます！');
    }
    if (room.linkState !== 'connected') return h('div.waiting', null, h('span.paw-spinner', null, '🐾'), 'ホストに再接続しています…');
    if (!room.isSynced) return h('div.waiting', null, h('span.paw-spinner', null, '🔄'), 'ゲーム状態を復元しています…');
    return h('p.ok-text', null, '✔ 復元完了。ホストの再開を待っています');
  }

  function hostPanelButtons(withResume) {
    const room = app.room;
    return h('div.btn-col', null,
      withResume ? h('button.btn.btn-primary.btn-xl', { onclick: () => room.resumeGame(), disabled: !room.canResume }, '▶ ゲーム再開') : null,
      h('button.btn.btn-secondary', { onclick: () => confirmAbort() }, 'ゲームを中止してゲーム選択へ'),
      h('button.btn.btn-ghost', { onclick: () => app.disband() }, '部屋を解散'));
  }

  async function confirmAbort() {
    const ok = await app.confirm({ title: 'ゲームを中止しますか？', text: '全員がゲーム選択画面に戻ります。', ok: '中止する', danger: true });
    if (ok) app.room.abortGame?.();
  }

  render();
  return {
    update: render,
    destroy() {
      clearInterval(timer);
      window.removeEventListener('keydown', onKey);
    },
  };
}
