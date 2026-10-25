// アプリの起動とトップレベルの状態（どの部屋にいるか）を管理する。
import './styles/main.css';
import { h } from './core/util.js';
import { ScreenRouter } from './core/screen.js';
import { HostRoom, GuestRoom } from './core/room.js';
import { InputManager } from './core/input.js';
import { sound } from './core/audio.js';
import { createMusic } from './core/music.js';
import { describePeerError } from './core/network.js';
import { readInviteParams, loadGuestSession, clearInviteParams, clearGuestSession } from './core/reconnect.js';

const CLOSE_TEXT = {
  disband: 'ホストが部屋を解散しました。',
  host_left: 'ホストがページを閉じたため、部屋は終了しました。',
  kicked: 'ホストがゲスト枠をリセットしました。',
  left: '部屋から退出しました。',
  self: '部屋を解散しました。',
};

class App {
  constructor(root) {
    this.sound = sound;
    this.music = createMusic(sound);
    this.input = new InputManager();
    this.room = null;
    this.connectInfo = { busy: false, error: null, notice: null };
    this.gameLayer = h('div.game-layer');
    root.append(this.gameLayer);
    this.router = new ScreenRouter(this, root);
    // ホストのページ終了は部屋の終了（補助的な通知。届く保証はない）
    window.addEventListener('pagehide', () => {
      if (this.room?.role === 'host') this.room.disband('host_left');
    });
  }

  boot() {
    const invite = readInviteParams();
    if (invite?.invalid) {
      this.connectInfo.error = '招待URLの形式が正しくありません。URLを最後までコピーできているか確認してください。';
      clearInviteParams();
    } else if (invite) {
      this.joinRoom(invite);
      return;
    }
    this.render();
  }

  render() {
    this.router.render();
    this._updateMusic();
  }

  /** 画面に合わせて BGM を切り替える（ゲーム中はレース曲、それ以外はメニュー曲） */
  _updateMusic() {
    const key = this.router.currentKey;
    const m = this.room?.state?.match;
    if (key === 'game') {
      this.music.play('race');
      this.music.setDim(!m || m.status !== 'running');
    } else {
      this.music.play('menu');
      this.music.setDim(false);
    }
  }

  _bindRoom(room) {
    room.on('change', () => this.render());
    room.on('toast', (t) => this.router.toast(t));
    room.on('closed', ({ reason }) => this._onClosed(reason));
  }

  async createRoom() {
    if (this.room || this.connectInfo.busy) return;
    this.connectInfo = { busy: true, error: null, notice: null };
    this.render();
    const room = new HostRoom({ sound, music: this.music, input: this.input, layer: this.gameLayer });
    try {
      await room.create();
    } catch (err) {
      console.warn('[app] 部屋を作れませんでした', err?.type || err?.message);
      room.disband('failed');
      this.connectInfo = { busy: false, error: `部屋を作成できませんでした。${describePeerError(err?.type || 'server-error')}`, notice: null };
      this.render();
      return;
    }
    this.connectInfo.busy = false;
    this.room = room;
    this._bindRoom(room);
    this.render();
  }

  joinRoom(invite) {
    const session = loadGuestSession();
    const token = session && session.room === invite.room && session.key === invite.key ? session.token : null;
    if (session && !token) clearGuestSession(); // 別の部屋の古い情報は捨てる
    const room = new GuestRoom({ invite, token, sound, music: this.music, input: this.input, layer: this.gameLayer });
    this.room = room;
    this._bindRoom(room);
    this.render();
    room.start();
  }

  _onClosed(reason) {
    const wasHost = this.room?.role === 'host';
    this.room = null;
    clearInviteParams();
    this.connectInfo = { busy: false, error: null, notice: wasHost ? CLOSE_TEXT.self : CLOSE_TEXT[reason] || '部屋から出ました。' };
    if (reason === 'failed') this.connectInfo.notice = null;
    this.render();
  }

  /** 接続画面へ戻る（ゲストの接続失敗時など） */
  goTop() {
    const room = this.room;
    if (!room) return;
    if (room.role === 'guest') room.close('left');
    else room.disband();
  }

  async disband() {
    if (this.room?.role !== 'host') return;
    const ok = await this.confirm({
      title: '部屋を解散しますか？',
      text: '2人とも接続画面に戻り、部屋は削除されます。この操作は取り消せません。',
      ok: '解散する',
      danger: true,
    });
    if (ok && this.room?.role === 'host') this.room.disband('disband');
  }

  async leave() {
    if (this.room?.role !== 'guest') return;
    const ok = await this.confirm({ title: '部屋から退出しますか？', text: 'ゲスト枠が空き、もう一度参加するには招待URLを開き直す必要があります。', ok: '退出する', danger: true });
    if (ok && this.room?.role === 'guest') this.room.leave();
  }

  async confirmFreeSlot() {
    const ok = await this.confirm({
      title: '新しいゲストを招待しますか？',
      text: '今のゲストの復帰を待つのをやめて枠を空けます。今のゲストは同じ部屋に戻れなくなります。',
      ok: '枠を空ける',
      danger: true,
    });
    if (ok && this.room?.role === 'host') this.room.freeGuestSlot();
  }

  showInvite() {
    const url = this.room?.inviteUrl;
    if (!url) return;
    this.router.dialog('🔗 招待URL', h('div', null,
      h('div.invite-row', null,
        h('input.invite-input', { value: url, readonly: true, onfocus: (e) => e.target.select() }),
        h('button.btn.btn-secondary', { onclick: () => this.copyText(url) }, '📋 コピー')),
      h('p.small.muted', null, 'ゲスト枠が空いているときだけ、新しい人が参加できます。')));
  }

  toggleMute() {
    sound.setMuted(!sound.muted);
    this.render();
  }

  toggleMusic() {
    this.music.setMuted(!this.music.muted);
    this.render();
  }

  confirm(opts) {
    return this.router.confirm(opts);
  }

  async copyText(text) {
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      // クリップボード API が使えない環境向けの代替
      const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } });
      ta.value = text;
      document.body.append(ta);
      ta.select();
      try {
        ok = document.execCommand('copy');
      } catch {
        ok = false;
      }
      ta.remove();
    }
    this.router.toast(ok ? 'コピーしました！' : 'コピーできませんでした。URLを選択して手動でコピーしてください。');
  }
}

const app = new App(document.getElementById('app'));
app.boot();
// 動作確認用の読み取り専用フック（招待キーや再参加トークンは含めない）
window.__wanwan = {
  get screen() {
    return app.router.currentKey;
  },
  get role() {
    return app.room?.role || null;
  },
  get match() {
    return app.room?.state?.match || null;
  },
  /** 現在のゲーム状態（シリアライズ可能なスナップショット）。ゲームがなければ null */
  snapshot() {
    return app.room?.gm?.game ? app.room.gm.getSnapshot?.() ?? null : null;
  },
};
// 自動テスト用のフック。VITE_TEST_HOOKS=1 でビルドしたときだけ有効（通常のビルドには含まれない）
if (import.meta.env.VITE_TEST_HOOKS === '1') {
  window.__wanwan.test = { room: () => app.room, game: () => app.room?.gm?.game || null };
}
