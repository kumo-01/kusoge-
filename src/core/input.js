// キーボード入力の管理。
// - 入力欄・ボタン操作中のキーはゲームに渡さない
// - 無効化中（一時停止・ゲーム外）は入力を受け付けない
// - フォーカスが外れたらすべてのキーを離した扱いにする

const GAME_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyR',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space',
]);

function isEditable(target) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

export class InputManager {
  constructor() {
    this.held = new Set();
    this.pressed = new Set();
    this.enabled = false;
    this._onDown = (e) => this._down(e);
    this._onUp = (e) => this.held.delete(e.code);
    this._onBlur = () => this.clear();
    this._onVis = () => {
      if (document.visibilityState === 'hidden') this.clear();
    };
    window.addEventListener('keydown', this._onDown);
    window.addEventListener('keyup', this._onUp);
    window.addEventListener('blur', this._onBlur);
    document.addEventListener('visibilitychange', this._onVis);
  }

  _down(e) {
    if (isEditable(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (!this.enabled || !GAME_KEYS.has(e.code)) return;
    e.preventDefault(); // 矢印キーやスペースでページがスクロールしないように
    // ボタンにフォーカスが残っているとスペースで押されてしまうので外す
    if (document.activeElement instanceof HTMLButtonElement) document.activeElement.blur();
    if (!e.repeat) this.pressed.add(e.code);
    this.held.add(e.code);
  }

  setEnabled(on) {
    this.enabled = on;
    if (!on) this.clear();
  }

  clear() {
    this.held.clear();
    this.pressed.clear();
  }

  isDown(...codes) {
    if (!this.enabled) return false;
    return codes.some((c) => this.held.has(c));
  }

  /** 押された瞬間を 1 回だけ取り出す */
  consume(...codes) {
    if (!this.enabled) return false;
    let hit = false;
    for (const c of codes) if (this.pressed.delete(c)) hit = true;
    return hit;
  }

  destroy() {
    window.removeEventListener('keydown', this._onDown);
    window.removeEventListener('keyup', this._onUp);
    window.removeEventListener('blur', this._onBlur);
    document.removeEventListener('visibilitychange', this._onVis);
  }
}
