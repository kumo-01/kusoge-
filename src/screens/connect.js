// ① 接続画面: 部屋の作成・招待URLの表示・ゲストの参加
import { spinner } from '../core/icons.js';
import { h } from '../core/util.js';
import { dogAvatar, PLAYERS } from './common.js';

export function mount(el, app) {
  function render() {
    const room = app.room;
    let body;
    if (!room) body = renderStart();
    else if (room.role === 'host') body = renderHostLobby(room);
    else body = renderGuestJoin(room);
    el.replaceChildren(h('div.screen.screen-connect', null, body));
  }

  /** タイトル: 大きな名前と、4 匹が並ぶ「プレイヤー選択」の画面 */
  function hero() {
    return h(
      'div.hero',
      null,
      h('h1.logo', null, 'わんわんパーティー'),
      h('p.lead', null, '1〜4人で遊ぶ、犬のミニゲーム集。招待URLを送れば、友だちとすぐ対戦できます。'),
      h('ol.hero-dogs', { 'aria-label': '遊べる犬' },
        PLAYERS.map((p, i) => h(`li.hero-dog.player-${p.color}`, { style: { '--i': i } },
          h('span.hero-p', null, `P${i + 1}`),
          h('span.hero-face', { html: dogAvatar(p.kind, 96) }),
          h('span.hero-name', null, p.name)))),
      h('p.app-version', null, typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'),
    );
  }

  function renderStart() {
    const info = app.connectInfo;
    return h(
      'div.connect-wrap',
      null,
      hero(),
      info.notice || info.error
        ? h('div.start-msgs', null,
            info.notice ? h('div.notice', null, info.notice) : null,
            info.error ? h('div.error-box', { role: 'alert' }, info.error) : null)
        : null,
      h(
        'div.start-choices',
        null,
        h(
          'section.card.choice',
          null,
          h('h2', null, '友だちと遊ぶ'),
          h('p', null, '部屋を作ると、あなたが柴犬（ホスト）になります。表示される招待URLを、遊ぶ相手（3人まで）に送ってください。相手はURLを開くだけで参加できます。'),
          modePicker(info.busy),
          h('button.btn.btn-primary.btn-xl', { onclick: () => app.createRoom(), disabled: info.busy }, info.busy ? '部屋を作っています…' : '部屋を作る'),
        ),
        h(
          'section.card.choice',
          null,
          h('h2', null, 'ひとりで遊ぶ'),
          h('p', null, '部屋を作らずに、すぐ遊べます。CPU の犬と対戦したり、記録に挑戦したりできます。通信はしません。'),
          h('button.btn.btn-secondary.btn-xl', { onclick: () => app.startSolo(), disabled: info.busy }, 'ひとりで遊ぶ'),
        ),
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
        h('h2.screen-title', null, '部屋ができました'),
        h('p', null, 'この招待URLを、遊ぶ相手に送ってください。ホストのほかに3人まで参加できます。'),
        h('div.invite-row', null,
          input,
          h('button.btn.btn-primary', { onclick: () => app.copyText(url) }, 'URLをコピー')),
        h('p.small.muted', null, room.net?.transport === 'relay' ? '通信: サーバー経由' : '通信: P2P（直接）'),
        h('div.waiting', null, spinner(), 'ゲストの参加を待っています。1人参加すれば先へ進めます。'),
        signalingNote(room),
        h('details.hint', null,
          h('summary', null, '1台のPCでテストするには？'),
          h('p', null, '別のブラウザ、またはシークレットウィンドウでこのURLを開くと、2人目として参加できます（3人目・4人目も同じ方法です）。同じブラウザの別タブでも参加できます。')),
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
          h('h2.screen-title', null, '部屋に参加できませんでした'),
          h('div.error-box', null, f.text),
          h('div.btn-row', null,
            f.kind !== 'rejected' ? h('button.btn.btn-primary', { onclick: () => room.retry() }, 'もう一度参加する') : null,
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
        h('div.waiting.big', null, spinner(), label),
        h('p.small.muted', null, 'あなたはゲストとして参加します。参加した順に、コーギー・プードル・パグになります。'),
        h('button.btn.btn-ghost', { onclick: () => app.goTop() }, 'やめて戻る'),
      ),
    );
  }

  /** 通信モードの選択（部屋を作る前） */
  function modePicker(busy) {
    const mode = app.roomMode;
    const choices = [
      { value: 'server', label: 'サーバー経由', desc: 'どんな回線でもつながりやすく、全員が同じ条件で遊べます。迷ったらこちら。' },
      { value: 'p2p', label: 'P2P（直接）', desc: 'ホストの端末と直接つなぎます。近くの人どうしなら遅れが少なくなりますが、回線によってはつながりません。' },
    ];
    const cur = choices.find((c) => c.value === mode);
    return h('div.mode-picker', null,
      h('div.option-label', null, '通信のしかた'),
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
    return h('p.small.warn-text', null, '接続仲介サーバーに再接続しています。しばらくお待ちください。');
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
