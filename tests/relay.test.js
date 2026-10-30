// 中継（Cloudflare Worker）用のクライアント RelayPeer の単体テスト。
// 中継サーバーの代わりに、同じメッセージ形式を話す小さな偽物（Hub）を使う。本物の Worker は wrangler dev で別に確認する
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { RelayPeer, isRelayRoom, RELAY_ROOM_PREFIX, relayBase, _setRelayBaseForTest } from '../src/core/relay.js';

_setRelayBaseForTest('https://relay.test');

class Hub {
  constructor() {
    this.host = null;
    this.guests = new Map();
    this.n = 0;
  }
}
const hub = new Hub();

class FakeWS {
  constructor(url) {
    this.url = new URL(url);
    this.readyState = 0;
    this.bufferedAmount = 0;
    this.role = this.url.searchParams.get('role');
    setTimeout(() => this._open(), 0);
  }
  _open() {
    this.readyState = 1;
    if (this.role === 'host') {
      if (hub.host) return this._reject(4403);
      hub.host = this;
      this._recv('!ok');
    } else {
      if (!hub.host) {
        this._recv('!no');
        return this._reject(4404);
      }
      this.id = `g${++hub.n}`;
      hub.guests.set(this.id, this);
      hub.host._recv(`!c${this.id}:${this.url.searchParams.get('meta') || ''}`);
      this._recv('!ok');
    }
  }
  _recv(data) {
    queueMicrotask(() => this.onmessage?.({ data }));
  }
  _reject(code) {
    this.readyState = 3;
    queueMicrotask(() => this.onclose?.({ code }));
  }
  send(data) {
    assert.equal(this.readyState, 1);
    if (this.role === 'host') {
      if (data.startsWith('!x')) return hub.guests.get(data.slice(2))?.close();
      const i = data.indexOf(':');
      hub.guests.get(data.slice(0, i))?._recv(data.slice(i + 1));
    } else {
      hub.host?._recv(`${this.id}:${data}`);
    }
  }
  close(code = 1000) {
    if (this.readyState === 3) return;
    this.readyState = 3;
    if (this.role === 'host') {
      hub.host = null;
      for (const g of hub.guests.values()) g.close(4001);
      hub.guests.clear();
    } else {
      hub.guests.delete(this.id);
      hub.host?._recv(`!x${this.id}`);
    }
    queueMicrotask(() => this.onclose?.({ code }));
  }
}
globalThis.WebSocket = FakeWS;

test('relayBase: https は wss に、不正な値や未設定は null', () => {
  _setRelayBaseForTest('https://kusoge.example.workers.dev/');
  assert.equal(relayBase(), 'wss://kusoge.example.workers.dev');
  _setRelayBaseForTest('http://127.0.0.1:8787');
  assert.equal(relayBase(), 'ws://127.0.0.1:8787');
  for (const bad of ['', 'ftp://x.example', 'not a url', undefined]) {
    _setRelayBaseForTest(bad ?? null);
    assert.equal(relayBase(), null);
  }
  _setRelayBaseForTest('https://relay.test');
});

const tick = () => new Promise((r) => setTimeout(r, 5));

test('部屋 ID の頭で中継の部屋かどうか分かる', () => {
  assert.equal(isRelayRoom(`${RELAY_ROOM_PREFIX}abc123`), true);
  assert.equal(isRelayRoom('wwk-abc123'), false);
  assert.equal(isRelayRoom(null), false);
});

test('ホストが部屋を開き、ゲストが 2 本の接続（通常・高速）でつながり、メッセージがそのまま届く', async () => {
  const host = new RelayPeer('wwr-room0001', { hostSecret: 'sec' });
  const hostConns = [];
  host.on('connection', (c) => hostConns.push(c));
  await new Promise((res) => host.on('open', res));
  assert.equal(host.open, true);

  const guest = new RelayPeer();
  await new Promise((res) => (guest.open ? res() : guest.on('open', res)));
  const got = [];
  const conn = guest.connect('wwr-room0001', { serialization: 'raw' });
  conn.on('data', (d) => got.push(['main', d]));
  await new Promise((res) => conn.on('open', res));
  const fast = guest.connect('wwr-room0001', { metadata: { fast: 'abc' } });
  fast.on('data', (d) => got.push(['fast', d]));
  await new Promise((res) => fast.on('open', res));
  await tick();

  assert.equal(hostConns.length, 2);
  assert.deepEqual(hostConns[1].metadata, { fast: 'abc' }, 'metadata reaches the host');
  const received = [];
  hostConns[0].on('data', (d) => received.push(['main', d]));
  hostConns[1].on('data', (d) => received.push(['fast', d]));
  assert.equal(hostConns[0].open, true);

  conn.send('{"type":"ping","t":1}');
  fast.send('{"type":"player_input"}');
  hostConns[0].send('{"type":"pong","t":1}');
  hostConns[1].send('{"type":"game_snapshot"}');
  await tick();
  assert.deepEqual(received, [['main', '{"type":"ping","t":1}'], ['fast', '{"type":"player_input"}']]);
  assert.deepEqual(got, [['main', '{"type":"pong","t":1}'], ['fast', '{"type":"game_snapshot"}']]);

  // ゲストが閉じるとホスト側の接続も閉じる。ホストが閉じるとゲスト側も閉じる
  let hostSawClose = false;
  hostConns[0].on('close', () => (hostSawClose = true));
  conn.close();
  await tick();
  assert.equal(hostSawClose, true);
  let guestSawClose = false;
  fast.on('close', () => (guestSawClose = true));
  hostConns[1].close();
  await tick();
  assert.equal(guestSawClose, true);

  guest.destroy();
  host.destroy();
  await tick();
});

test('ホストがいない部屋にゲストがつなぐと peer-unavailable のエラーになる', async () => {
  const guest = new RelayPeer();
  await new Promise((res) => (guest.open ? res() : guest.on('open', res)));
  const errs = [];
  guest.on('error', (e) => errs.push(e.type));
  const conn = guest.connect('wwr-nobody01', {});
  let closed = false;
  conn.on('close', () => (closed = true));
  await tick();
  await tick();
  assert.deepEqual(errs, ['peer-unavailable']);
  assert.equal(closed, true);
  assert.throws(() => conn.send('x'));
  guest.destroy();
});

test('同じ部屋 ID が使用中なら unavailable-id、ホストの回線が切れたら disconnected になり reconnect で戻る', async () => {
  const a = new RelayPeer('wwr-room0002', { hostSecret: 's' });
  await new Promise((res) => a.on('open', res));
  const b = new RelayPeer('wwr-room0002', { hostSecret: 's' });
  const err = await new Promise((res) => b.on('error', res));
  assert.equal(err.type, 'unavailable-id');
  b.destroy();

  // 回線が切れた
  const events = [];
  a.on('disconnected', () => events.push('disconnected'));
  a._ws.close(1006);
  await tick();
  assert.deepEqual(events, ['disconnected']);
  assert.equal(a.disconnected, true);
  assert.equal(a.open, false);
  a.reconnect();
  await new Promise((res) => a.on('open', res));
  assert.equal(a.open, true);
  assert.equal(a.disconnected, false);
  a.destroy();
});
