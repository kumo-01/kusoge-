// ① 接続画面: 部屋の作成・招待URLの表示・ゲストの参加
import { h } from '../core/util.js';
import { dogAvatar } from './common.js';

export function mount(el, app) {
  function render() {
    const room = app.room;
    let body;
    if (!room) body = renderStart();
    else if (room.role === 'host') body = renderHostLobby(room);
    else body = renderGuestJoin(room);
    el.replaceChildren(h('div.screen.screen-connect', null, body));
  }

  function hero() {
    return h(
      'div.hero',
      null,
      h('div.hero-dogs', null,
        h('div.hero-dog.bounce-a', { html: dogAvatar('shiba', 110) }),
        h('div.hero-vs', null, 'VS'),
        h('div.hero-dog.bounce-b', { html: dogAvatar('corgi', 110) })),
      h('h1.logo', null, h('span.logo-sub', null, '2〜3人で遊ぶミニゲーム集'), 'わんわんパーティー'),
      h('p.lead', null, '招待URLを送るだけで、友だちとオンライン対戦！'),
    );
  }

  function renderStart() {
    const info = app.connectInfo;
    return h(
      'div.connect-wrap',
      null,
      hero(),
      h(
        'div.card.connect-card',
        null,
        info.notice ? h('div.notice', null, info.notice) : null,
        info.error ? h('div.error-box', null, '⚠ ', info.error) : null,
        modePicker(info.busy),
        h(
          'button.btn.btn-primary.btn-xl',
          { onclick: () => app.createRoom(), disabled: info.busy },
          info.busy ? '部屋を作っています…' : '🏠 部屋を作る',
        ),
        h('p.small', null, '部屋を作るとあなたが「ホスト（柴犬）」になります。表示された招待URLを、遊ぶ相手（1〜2人）に送ってください。'),
        h('p.small.muted', null, '招待された人は、URLを開くだけで参加できます（コード入力は不要）。'),
      ),
      h(
        'div.card.connect-card.solo-card',
        null,
        h('button.btn.btn-secondary.btn-xl', { onclick: () => app.startSolo(), disabled: info.busy }, '🐶 ひとりで遊ぶ'),
        h('p.small', null, '部屋を作らずに、すぐ 1 人で遊べます（通信なし）。記録に挑戦したり、練習したりしよう。'),
      ),
    );
  }

  function renderHostLobby(room) {
    const url = room.inviteUrl;
    const input = h('input.invite-input', { value: url, readonly: true, onfocus: (e) => e.target.select(), 'aria-label': '招待URL' });
    return h(
      'div.connect-wrap',
      null,
      hero(),
      h(
        'div.card.connect-card',
        null,
        h('h2', null, '🎉 部屋ができました！'),
        h('p.small.muted', null, room.net?.transport === 'relay' ? '通信モード: ☁ サーバー' : '通信モード: ⚡ P2P（直接）'),
        h('p', null, 'この招待URLを相手に送ってください。最大3人（ホスト + ゲスト2人）で遊べます。'),
        h('div.invite-row', null,
          input,
          h('button.btn.btn-secondary', { onclick: () => app.copyText(url) }, '📋 コピー')),
        h('div.waiting', null, h('span.paw-spinner', null, '🐾'), 'ゲストの参加を待っています…（1人でもそろえば先へ進めます）'),
        signalingNote(room),
        h('details.hint', null,
          h('summary', null, '1台のPCでテストするには？'),
          h('p', null, '別のブラウザ、またはシークレットウィンドウでこのURLを開くと、2人目として参加できます（3人目も同じ方法です）。同じブラウザの別タブでも参加できます。')),
        h('button.btn.btn-ghost', { onclick: () => app.disband() }, '部屋を閉じる'),
      ),
    );
  }

  function renderGuestJoin(room) {
    const f = room.failure;
    if (f) {
      return h(
        'div.connect-wrap',
        null,
        hero(),
        h(
          'div.card.connect-card',
          null,
          h('h2', null, '😢 接続できませんでした'),
          h('div.error-box', null, f.text),
          h('div.btn-row', null,
            f.kind !== 'rejected' ? h('button.btn.btn-primary', { onclick: () => room.retry() }, '🔁 もう一度試す') : null,
            h('button.btn.btn-ghost', { onclick: () => app.goTop() }, '接続画面へ戻る')),
          troubleshooting(),
        ),
      );
    }
    const label = room.linkState === 'reconnecting' ? '部屋に再接続しています…' : '部屋に参加しています…';
    return h(
      'div.connect-wrap',
      null,
      hero(),
      h(
        'div.card.connect-card',
        null,
        h('div.waiting.big', null, h('span.paw-spinner', null, '🐾'), label),
        h('p.small.muted', null, 'あなたは「ゲスト」として参加します（1人目はコーギー、2人目はプードル）。'),
        h('button.btn.btn-ghost', { onclick: () => app.goTop() }, 'やめて戻る'),
      ),
    );
  }

  /** 通信モードの選択（部屋を作る前） */
  function modePicker(busy) {
    const mode = app.roomMode;
    const choices = [
      { value: 'server', label: '☁ サーバー', desc: 'Cloudflare のサーバーが計算します。どんな回線でもつながりやすく、全員が同じ条件で遊べます。' },
      { value: 'p2p', label: '⚡ P2P（直接）', desc: 'ホストとゲストが直接つながり、ホストの端末が計算します。近くの人どうしなら遅れが少なくなります。回線によってはつながりません（そのときは「サーバー」で作り直してください）。' },
    ];
    const cur = choices.find((c) => c.value === mode);
    return h('div.mode-picker', null,
      h('div.option-label', null, '通信モード'),
      h('div.chips', null,
        choices.map((c) =>
          h(`button.chip${c.value === mode ? '.on' : ''}`, {
            disabled: busy,
            'aria-pressed': c.value === mode ? 'true' : 'false',
            onclick: c.value === mode ? null : () => { app.sound?.play('click'); app.setRoomMode(c.value); },
          }, c.label))),
      h('p.small.muted', null, cur.desc));
  }

  function signalingNote(room) {
    if (room.signaling === 'online') return null;
    return h('p.small.warn-text', null, '⚠ 接続仲介サーバーに再接続しています。しばらくお待ちください…');
  }

  function troubleshooting() {
    return h('details.hint', null,
      h('summary', null, 'つながらないときは'),
      h('ul', null,
        h('li', null, 'ホストのページが開いたままか確認してください（ホストが更新すると以前の部屋は終了します）。'),
        h('li', null, '会社・学校のネットワークや一部のモバイル回線では WebRTC が通らないことがあります。P2P（直接）の部屋につながらないときは、ホストに「サーバー」モードで部屋を作り直してもらってください。'),
        h('li', null, '広告ブロッカーやVPNを一時的に切ると改善することがあります。'),
        h('li', null, 'ホストに新しい招待URLを作ってもらってください。')));
  }

  render();
  return { update: render, destroy() {} };
}
