// 画面の切り替えと共通UI（ヘッダー・確認ダイアログ・トースト・接続オーバーレイ）
import { h } from './util.js';
import * as connect from '../screens/connect.js';
import * as home from '../screens/home.js';
import * as select from '../screens/select.js';
import * as ready from '../screens/ready.js';
import * as game from '../screens/game.js';
import * as result from '../screens/result.js';
import { statusPill, PLAYERS } from '../screens/common.js';

const SCREENS = { connect, home, select, ready, game, result };

export class ScreenRouter {
  constructor(app, root) {
    this.app = app;
    this.header = h('header.app-header');
    this.main = h('main.app-main');
    this.overlay = h('div.app-overlay');
    this.toasts = h('div.toasts', { 'aria-live': 'polite' });
    this.modalRoot = h('div.modal-root');
    root.append(this.header, this.main, this.overlay, this.toasts, this.modalRoot);
    this.currentKey = null;
    this.current = null;
    this._headerTimer = setInterval(() => this.renderHeader(), 1000);
  }

  keyFor() {
    const room = this.app.room;
    if (!room) return 'connect';
    if (room.role === 'host') return room.state.screen === 'lobby' ? 'connect' : room.state.screen;
    if (!room.state) return 'connect';
    return room.state.screen === 'lobby' ? 'home' : room.state.screen;
  }

  render() {
    const key = this.keyFor();
    if (key !== this.currentKey) {
      try {
        this.current?.destroy();
      } catch (err) {
        console.error(err);
      }
      this.main.replaceChildren();
      this.currentKey = key;
      document.body.dataset.screen = key;
      this.current = SCREENS[key].mount(this.main, this.app);
      window.scrollTo(0, 0);
    } else {
      this.current?.update();
    }
    this.renderHeader();
    this.renderOverlay();
  }

  renderHeader() {
    const app = this.app;
    const room = app.room;
    const key = this.currentKey;
    if (!room || key === 'connect' || key === 'game') {
      this.header.hidden = true;
      return;
    }
    this.header.hidden = false;
    const isHost = room.role === 'host';
    if (room.solo) {
      this.header.replaceChildren(
        h('div.header-left', null,
          h('span.header-logo', null, '🐾 わんわんパーティー'),
          h('span.role-badge.red', null, '🐶 ひとりモード')),
        h('div.header-right', null,
          h('button.btn.btn-small.btn-light', { onclick: () => app.toggleMute(), title: '効果音のオン/オフ' }, app.sound.muted ? '🔇' : '🔊'),
          h('button.btn.btn-small.btn-light', { onclick: () => app.toggleMusic(), title: 'BGM のオン/オフ' }, app.music.muted ? '🎵✕' : '🎵'),
          h('button.btn.btn-small.btn-ghost', { onclick: () => app.disband() }, 'タイトルへ')),
      );
      return;
    }
    const rtt = room.rtt != null ? `${Math.round(room.rtt)}ms` : '';
    let status;
    if (isHost) {
      // ゲストの席ごとの状態（空いている席は「未参加」）
      status = h('span.status-group', null, ...[1, 2].flatMap((slot) => [`${PLAYERS[slot].role}: `, statusPill(room.state.players[slot].link, room.state.players[slot].link === 'connected' ? (room.net.rttOf(slot) != null ? `${Math.round(room.net.rttOf(slot))}ms` : '') : '')]));
    } else {
      status = h('span.status-group', null, 'ホスト: ', statusPill(room.linkState === 'connected' ? 'connected' : room.linkState, room.linkState === 'connected' ? rtt : ''));
    }
    const mine = PLAYERS[room.slot ?? 1] || PLAYERS[1];
    const waiting = isHost ? [1, 2].filter((slot) => room.state.players[slot].link === 'waiting') : [];

    this.header.replaceChildren(
      h('div.header-left', null,
        h('span.header-logo', null, '🐾 わんわんパーティー'),
        h(`span.role-badge.${mine.color}`, null, `${mine.icon} ${mine.role}（${mine.name}）`)),
      h('div.header-right', null,
        status,
        isHost && room.signaling !== 'online' ? h('span.pill.pill-warn', { title: 'シグナリングサーバーとの接続。ゲーム中のデータ通信には影響しません' }, '仲介サーバー再接続中') : null,
        isHost ? h('button.btn.btn-small.btn-light', { onclick: () => app.showInvite() }, '🔗 招待URL') : null,
        ...waiting.map((slot) => h('button.btn.btn-small.btn-light', { onclick: () => app.confirmFreeSlot(slot) }, waiting.length > 1 ? `${PLAYERS[slot].role}の席を空ける` : '新しいゲストを招待')),
        h('button.btn.btn-small.btn-light', { onclick: () => app.toggleMute(), title: '効果音のオン/オフ' }, app.sound.muted ? '🔇' : '🔊'),
        h('button.btn.btn-small.btn-light', { onclick: () => app.toggleMusic(), title: 'BGM のオン/オフ' }, app.music.muted ? '🎵✕' : '🎵'),
        isHost
          ? h('button.btn.btn-small.btn-danger', { onclick: () => app.disband() }, '解散')
          : h('button.btn.btn-small.btn-ghost', { onclick: () => app.leave() }, '退出')),
    );
  }

  renderOverlay() {
    const room = this.app.room;
    const show = room && room.role === 'guest' && room.state && room.linkState !== 'connected';
    if (!show) {
      this.overlay.hidden = true;
      this.overlay.replaceChildren();
      return;
    }
    this.overlay.hidden = false;
    const f = room.failure;
    this.overlay.replaceChildren(
      h('div.overlay-card.card', null,
        f
          ? [
              h('h2', null, '😢 ホストに接続できません'),
              h('p', null, f.text),
              h('div.btn-row', null,
                f.kind !== 'rejected' ? h('button.btn.btn-primary', { onclick: () => room.retry() }, '🔁 もう一度試す') : null,
                h('button.btn.btn-ghost', { onclick: () => this.app.goTop() }, '接続画面へ戻る')),
            ]
          : [
              h('div.waiting.big', null, h('span.paw-spinner', null, '🐾'), 'ホストに再接続しています…'),
              h('p.small', null, '通信が切れました。自動で再接続を試みています。'),
              h('button.btn.btn-ghost', { onclick: () => this.app.goTop() }, 'あきらめて接続画面へ戻る'),
            ]),
    );
  }

  toast(text, ms = 3200) {
    const t = h('div.toast', null, text);
    this.toasts.append(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => t.remove(), 400);
    }, ms);
  }

  /** 確認ダイアログ（誤操作防止） */
  confirm({ title, text, ok = 'OK', cancel = 'キャンセル', danger = false }) {
    return new Promise((resolve) => {
      const close = (v) => {
        document.removeEventListener('keydown', onKey);
        box.remove();
        resolve(v);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') close(false);
      };
      const okBtn = h(`button.btn.${danger ? 'btn-danger' : 'btn-primary'}`, { onclick: () => close(true) }, ok);
      const box = h('div.modal-backdrop', { onclick: (e) => e.target === box && close(false) },
        h('div.modal.card', { role: 'dialog', 'aria-modal': 'true' },
          h('h2', null, title),
          text ? h('p', null, text) : null,
          h('div.btn-row', null, h('button.btn.btn-ghost', { onclick: () => close(false) }, cancel), okBtn)));
      document.addEventListener('keydown', onKey);
      this.modalRoot.append(box);
      okBtn.focus();
    });
  }

  /** 任意の内容を表示するダイアログ */
  dialog(title, content) {
    const close = () => {
      document.removeEventListener('keydown', onKey);
      box.remove();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    const box = h('div.modal-backdrop', { onclick: (e) => e.target === box && close() },
      h('div.modal.card', { role: 'dialog', 'aria-modal': 'true' },
        h('h2', null, title),
        content,
        h('div.btn-row', null, h('button.btn.btn-ghost', { onclick: close }, '閉じる'))));
    document.addEventListener('keydown', onKey);
    this.modalRoot.append(box);
  }
}
