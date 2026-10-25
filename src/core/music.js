// BGM: Web Audio API で鳴らす小さなシーケンサー（音声ファイル不要・オリジナル曲）。
// 16分音符単位のパターンを少し先まで予約して鳴らす（setInterval のゆらぎに強い）。
// 効果音とは別にオン/オフでき、設定は localStorage に保存する。

const MUTE_KEY = 'wanwan.bgmMuted';
const LOOKAHEAD = 0.15; // 何秒先まで予約するか
const _ = null;

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

// コード進行（ルート音, 種類）とメロディ（8分音符・MIDI ノート）
const TRACKS = {
  menu: {
    bpm: 108,
    volume: 0.5,
    chords: [[53, 'M'], [50, 'm'], [46, 'M'], [48, 'M']], // F Dm B♭ C
    melody: [
      72, _, 77, _, 76, 77, 79, _,
      77, _, 74, _, 72, 74, 77, _,
      74, _, 70, _, 74, 77, 82, _,
      79, 77, 76, _, 72, _, _, _,
    ],
    lead: 'triangle',
    drums: 'soft',
  },
  race: {
    bpm: 150,
    volume: 0.5,
    chords: [[48, 'M'], [43, 'M'], [45, 'm'], [41, 'M'], [48, 'M'], [43, 'M'], [41, 'M'], [43, 'M']], // C G Am F C G F G
    melody: [
      76, 79, 84, 79, 81, 79, 76, 74,
      74, 79, 83, 79, 86, 83, 79, _,
      84, 83, 81, 76, 81, 83, 84, 88,
      77, 81, 84, 81, 79, 76, 74, _,
      76, 79, 84, 79, 81, 79, 76, 79,
      83, 81, 79, 74, 79, 83, 86, _,
      84, 81, 77, 81, 84, 86, 88, 86,
      84, 83, 81, 79, 77, 76, 74, _,
    ],
    lead: 'square',
    drums: 'drive',
  },
};

class Music {
  constructor(sound) {
    this.sound = sound;
    this.track = null;
    this.wanted = null;
    this.tempoScale = 1;
    this.dim = false;
    this.step = 0;
    this.nextTime = 0;
    this.gain = null;
    this._timer = null;
    try {
      this.muted = localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      this.muted = false;
    }
    document.addEventListener('visibilitychange', () => {
      // 裏のタブではタイマーが間引かれて音がずれるので止める
      if (document.visibilityState === 'hidden') this._stopTimer();
      else if (this.wanted) this.play(this.wanted, true);
    });
    // 最初のクリック/キー入力で AudioContext が使えるようになったら鳴らし始める
    const unlock = () => this.wanted && this.play(this.wanted, true);
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });
  }

  setMuted(m) {
    this.muted = m;
    try {
      localStorage.setItem(MUTE_KEY, m ? '1' : '0');
    } catch {
      /* noop */
    }
    if (m) this._stopTimer(true);
    else if (this.wanted) this.play(this.wanted, true);
  }

  /** 曲を切り替える（同じ曲なら何もしない） */
  play(name, force = false) {
    this.wanted = name;
    if (!force && this.track === name && this._timer) return;
    if (name !== this.track) this.tempoScale = 1;
    if (this.muted || !TRACKS[name] || document.visibilityState === 'hidden') return;
    const ctx = this.sound._ensure?.();
    if (!ctx || ctx.state !== 'running') return;
    try {
      this._stopTimer(true);
      this.track = name;
      this.gain = ctx.createGain();
      this.gain.gain.value = 0;
      this.gain.gain.setTargetAtTime(this._vol(), ctx.currentTime, 0.3);
      this.gain.connect(ctx.destination);
      this.step = 0;
      this.nextTime = ctx.currentTime + 0.1;
      this._timer = setInterval(() => this._schedule(), 25);
    } catch {
      /* BGM が鳴らなくてもゲームは続ける */
    }
  }

  stop() {
    this.wanted = null;
    this._stopTimer(true);
  }

  /** 一時停止中などは音量を下げる */
  setDim(on) {
    if (this.dim === on) return;
    this.dim = on;
    const ctx = this.sound.ctx;
    if (this.gain && ctx) this.gain.gain.setTargetAtTime(this._vol(), ctx.currentTime, 0.2);
  }

  setTempoScale(x) {
    this.tempoScale = x;
  }

  _vol() {
    const t = TRACKS[this.track];
    return (t ? t.volume : 0.4) * (this.dim ? 0.35 : 1) * 0.35;
  }

  _stopTimer(fade) {
    clearInterval(this._timer);
    this._timer = null;
    const g = this.gain;
    const ctx = this.sound.ctx;
    this.gain = null;
    if (g && ctx) {
      try {
        if (fade) g.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
        setTimeout(() => g.disconnect(), 600);
      } catch {
        /* noop */
      }
    }
  }

  _schedule() {
    const ctx = this.sound.ctx;
    const t = TRACKS[this.track];
    if (!ctx || !t || !this.gain) return;
    const stepDur = 60 / (t.bpm * this.tempoScale) / 4;
    // 大きく遅れたら追いつかずに今から鳴らし直す
    if (this.nextTime < ctx.currentTime - 0.3) this.nextTime = ctx.currentTime + 0.05;
    while (this.nextTime < ctx.currentTime + LOOKAHEAD) {
      this._playStep(t, this.step, this.nextTime, stepDur);
      this.nextTime += stepDur;
      this.step++;
    }
  }

  _playStep(t, step, time, dur) {
    const bar = Math.floor(step / 16) % t.chords.length;
    const s16 = step % 16;
    const [root, kind] = t.chords[bar];
    const third = kind === 'm' ? 3 : 4;
    // ベース: 8分でオクターブを行き来
    if (s16 % 2 === 0) this._note('triangle', midi(root + (s16 % 4 === 2 ? 12 : 0)), time, dur * 1.8, 0.5);
    // 和音のアルペジオ（16分・小さめ）
    const arp = [0, third, 7, 12][s16 % 4];
    this._note('sine', midi(root + 24 + arp), time, dur * 0.9, 0.12);
    // メロディ（8分）
    if (s16 % 2 === 0) {
      const mi = (Math.floor(step / 2) % t.melody.length);
      const n = t.melody[mi];
      if (n != null) this._note(t.lead, midi(n), time, dur * 1.7, t.lead === 'square' ? 0.16 : 0.32);
    }
    // ドラム
    if (t.drums === 'drive') {
      if (s16 % 4 === 0) this._kick(time, 0.8);
      if (s16 === 4 || s16 === 12) this._snare(time, 0.45);
      if (s16 % 2 === 1) this._hat(time, 0.18);
    } else {
      if (s16 === 0 || s16 === 8) this._kick(time, 0.45);
      if (s16 === 12) this._snare(time, 0.2);
      if (s16 % 4 === 2) this._hat(time, 0.1);
    }
  }

  _note(type, freq, time, dur, vol) {
    const ctx = this.sound.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, time);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(vol, time + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    o.connect(g).connect(this.gain);
    o.start(time);
    o.stop(time + dur + 0.02);
  }

  _kick(time, vol) {
    const ctx = this.sound.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(150, time);
    o.frequency.exponentialRampToValueAtTime(45, time + 0.12);
    g.gain.setValueAtTime(vol, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.16);
    o.connect(g).connect(this.gain);
    o.start(time);
    o.stop(time + 0.18);
  }

  _noise(time, vol, dur, type, freq) {
    const ctx = this.sound.ctx;
    if (!this.sound.noiseBuf) return;
    const src = ctx.createBufferSource();
    src.buffer = this.sound.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    src.connect(f).connect(g).connect(this.gain);
    src.start(time, Math.random() * 0.5);
    src.stop(time + dur + 0.02);
  }

  _snare(time, vol) {
    this._noise(time, vol, 0.14, 'bandpass', 1800);
  }

  _hat(time, vol) {
    this._noise(time, vol, 0.04, 'highpass', 7000);
  }
}

export function createMusic(sound) {
  return new Music(sound);
}
