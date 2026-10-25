// Web Audio API で合成する簡単な効果音（音声ファイル不要）。
// AudioContext が使えない環境では何もしない（アプリは止まらない）。

const MUTE_KEY = 'wanwan.muted';

class Sound {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuf = null;
    this.engine = null;
    try {
      this.muted = localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      this.muted = false;
    }
    const unlock = () => this._ensure();
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });
  }

  _ensure() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.5;
        this.master.connect(this.ctx.destination);
        const len = this.ctx.sampleRate;
        this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return this.ctx;
    } catch {
      return null;
    }
  }

  setMuted(m) {
    this.muted = m;
    try {
      localStorage.setItem(MUTE_KEY, m ? '1' : '0');
    } catch {
      /* noop */
    }
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  }

  // ---- 合成の部品 ----
  _tone({ type = 'sine', from, to = from, dur = 0.15, vol = 0.3, delay = 0, attack = 0.005 }) {
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t0);
    if (to !== from) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
    return osc;
  }

  _noise({ dur = 0.2, vol = 0.3, filter = 'bandpass', from = 2000, to = from, q = 1, delay = 0 }) {
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.Q.value = q;
    f.frequency.setValueAtTime(from, t0);
    if (to !== from) f.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + dur + 0.05);
  }

  _bark(delay = 0, pitch = 1) {
    // 「ワン」っぽい音: ノコギリ波を帯域通過フィルタで鼻にかかった声に
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(420 * pitch, t0);
    osc.frequency.linearRampToValueAtTime(620 * pitch, t0 + 0.04);
    osc.frequency.exponentialRampToValueAtTime(300 * pitch, t0 + 0.16);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(1100, t0);
    f.frequency.linearRampToValueAtTime(700, t0 + 0.16);
    f.Q.value = 3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.5, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
    osc.connect(f).connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + 0.2);
  }

  /** 効果音を鳴らす。失敗しても例外は外に出さない */
  play(name) {
    if (this.muted) return;
    const ctx = this._ensure();
    if (!ctx || ctx.state !== 'running') return;
    try {
      switch (name) {
        case 'click':
          this._tone({ from: 600, to: 900, dur: 0.07, vol: 0.15 });
          break;
        case 'join':
          this._tone({ type: 'triangle', from: 660, dur: 0.12, vol: 0.25 });
          this._tone({ type: 'triangle', from: 990, dur: 0.2, vol: 0.25, delay: 0.1 });
          this._bark(0.25, 1.1);
          break;
        case 'leave':
          this._tone({ type: 'triangle', from: 660, to: 330, dur: 0.35, vol: 0.2 });
          break;
        case 'ready':
          this._tone({ type: 'square', from: 880, dur: 0.08, vol: 0.12 });
          this._tone({ type: 'square', from: 1320, dur: 0.12, vol: 0.12, delay: 0.08 });
          break;
        case 'beep':
          this._tone({ type: 'square', from: 520, dur: 0.16, vol: 0.18 });
          break;
        case 'go':
          this._tone({ type: 'square', from: 1040, dur: 0.45, vol: 0.2 });
          this._tone({ type: 'square', from: 1560, dur: 0.45, vol: 0.08 });
          break;
        case 'pickup':
          [784, 988, 1175, 1568].forEach((f, i) => this._tone({ type: 'triangle', from: f, dur: 0.1, vol: 0.2, delay: i * 0.05 }));
          break;
        case 'tick':
          this._tone({ type: 'square', from: 1400, dur: 0.03, vol: 0.06 });
          break;
        case 'itemReady':
          this._tone({ type: 'triangle', from: 1046, dur: 0.1, vol: 0.22 });
          this._tone({ type: 'triangle', from: 1568, dur: 0.18, vol: 0.22, delay: 0.08 });
          break;
        case 'throw':
          this._noise({ dur: 0.28, vol: 0.35, from: 3000, to: 600, q: 2 });
          this._bark(0, 1.2);
          break;
        case 'drop':
          this._tone({ from: 300, to: 120, dur: 0.15, vol: 0.3 });
          break;
        case 'boost':
          this._tone({ type: 'sawtooth', from: 180, to: 900, dur: 0.55, vol: 0.18 });
          this._noise({ dur: 0.6, vol: 0.25, filter: 'highpass', from: 800, to: 3000 });
          break;
        case 'hit':
          this._tone({ from: 220, to: 60, dur: 0.25, vol: 0.45 });
          this._tone({ type: 'triangle', from: 1300, to: 600, dur: 0.3, vol: 0.2, delay: 0.05 }); // キャイン
          this._tone({ type: 'sine', from: 300, to: 700, dur: 0.4, vol: 0.15, delay: 0.1 }); // ボヨン
          break;
        case 'slip':
          this._tone({ type: 'sine', from: 1500, to: 280, dur: 0.7, vol: 0.25 }); // スライドホイッスル
          break;
        case 'bump':
          this._noise({ dur: 0.18, vol: 0.5, filter: 'lowpass', from: 900, q: 0.7 });
          this._tone({ from: 160, to: 50, dur: 0.22, vol: 0.45 });
          break;
        case 'bigBump':
          this._noise({ dur: 0.35, vol: 0.6, filter: 'lowpass', from: 1500, to: 200, q: 0.7 });
          this._tone({ from: 140, to: 40, dur: 0.4, vol: 0.5 });
          this._tone({ type: 'sine', from: 400, to: 1200, dur: 0.5, vol: 0.18, delay: 0.1 });
          this._bark(0.15, 1.3);
          break;
        case 'wall':
          this._tone({ from: 120, to: 60, dur: 0.15, vol: 0.3 });
          break;
        case 'bark':
          this._bark(0);
          break;
        case 'respawn':
          this._tone({ type: 'triangle', from: 400, to: 1200, dur: 0.3, vol: 0.2 });
          break;
        case 'lap':
          this._tone({ type: 'triangle', from: 880, dur: 0.12, vol: 0.25 });
          this._tone({ type: 'triangle', from: 1320, dur: 0.25, vol: 0.25, delay: 0.12 });
          break;
        case 'finalLap':
          [880, 1108, 1320, 1760].forEach((f, i) => this._tone({ type: 'square', from: f, dur: 0.12, vol: 0.12, delay: i * 0.1 }));
          break;
        case 'finish':
          [523, 659, 784, 1046].forEach((f, i) => this._tone({ type: 'square', from: f, dur: 0.18, vol: 0.14, delay: i * 0.12 }));
          this._tone({ type: 'square', from: 1046, dur: 0.6, vol: 0.14, delay: 0.5 });
          this._tone({ type: 'triangle', from: 1318, dur: 0.6, vol: 0.12, delay: 0.5 });
          this._bark(0.9);
          this._bark(1.1);
          break;
        case 'lose':
          [523, 494, 466, 440].forEach((f, i) => this._tone({ type: 'triangle', from: f, dur: 0.25, vol: 0.18, delay: i * 0.22 }));
          break;
        default:
          break;
      }
    } catch {
      /* 音の失敗は無視 */
    }
  }

  /** エンジン音（自分の車だけ）。ratio: 0..1.5 */
  setEngine(on, ratio = 0, boosting = false) {
    if (!on || this.muted) {
      this._stopEngine();
      return;
    }
    const ctx = this._ensure();
    if (!ctx || ctx.state !== 'running') return;
    try {
      if (!this.engine) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        const osc2 = ctx.createOscillator();
        osc2.type = 'square';
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 500;
        const g = ctx.createGain();
        g.gain.value = 0;
        osc.connect(f);
        osc2.connect(f);
        f.connect(g).connect(this.master);
        osc.start();
        osc2.start();
        this.engine = { osc, osc2, f, g };
      }
      const e = this.engine;
      const t = ctx.currentTime;
      const base = 55 + ratio * 110 + (boosting ? 40 : 0);
      e.osc.frequency.setTargetAtTime(base, t, 0.05);
      e.osc2.frequency.setTargetAtTime(base * 0.5 + 3, t, 0.05);
      e.f.frequency.setTargetAtTime(350 + ratio * 900 + (boosting ? 600 : 0), t, 0.05);
      e.g.gain.setTargetAtTime(0.035 + ratio * 0.035, t, 0.08);
    } catch {
      /* noop */
    }
  }

  _stopEngine() {
    if (!this.engine) return;
    const e = this.engine;
    this.engine = null;
    try {
      e.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
      e.osc.stop(this.ctx.currentTime + 0.3);
      e.osc2.stop(this.ctx.currentTime + 0.3);
    } catch {
      /* noop */
    }
  }
}

export const sound = new Sound();
