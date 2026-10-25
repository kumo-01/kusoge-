// ポップな演出（星・土煙・キラキラ・紙吹雪・擬音の文字）。メッシュは使い回す。
import * as THREE from 'three';

function starShape() {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 1 : 0.45;
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  }
  s.closePath();
  return s;
}

const TEXT_COLORS = {
  'ドカーン!': '#ff4d5e',
  'ゴツン!': '#ff8a3d',
  'キャイン!': '#3d8bff',
  'ツルッ!': '#f5c400',
  'ブーン!': '#ff8a3d',
  'ワン!': '#ff6fae',
  'ゲット!': '#22b573',
  'ガード!': '#8a63ff',
  'ボヨン!': '#22b573',
  'ゴール!!': '#ff4d5e',
  'LAP 2': '#3d8bff',
  'FINAL LAP!': '#ff4d5e',
};

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.active = [];
    this.pools = new Map();
    this.textures = new Map();
    this.geos = {
      star: new THREE.ShapeGeometry(starShape()),
      puff: new THREE.SphereGeometry(1, 8, 6),
      spark: new THREE.BoxGeometry(1, 1, 1),
      confetti: new THREE.PlaneGeometry(1, 0.6),
      ring: new THREE.RingGeometry(0.7, 1, 24),
    };
    this.baseMats = {
      star: new THREE.MeshBasicMaterial({ color: 0xffd23f, side: THREE.DoubleSide, transparent: true }),
      puff: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false }),
      spark: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true }),
      confetti: new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true }),
      ring: new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, depthWrite: false }),
    };
  }

  _get(type) {
    const pool = this.pools.get(type);
    if (pool && pool.length) {
      const o = pool.pop();
      o.visible = true;
      return o;
    }
    let o;
    if (type === 'text') {
      o = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false }));
      o.renderOrder = 10;
    } else {
      o = new THREE.Mesh(this.geos[type], this.baseMats[type].clone());
    }
    this.scene.add(o);
    return o;
  }

  _release(p) {
    p.obj.visible = false;
    if (!this.pools.has(p.type)) this.pools.set(p.type, []);
    this.pools.get(p.type).push(p.obj);
  }

  _spawn(type, x, y, z, o) {
    if (this.active.length > 400) return null; // 安全のための上限
    const obj = this._get(type);
    obj.position.set(x, y, z);
    if (o.color != null && obj.material.color) obj.material.color.set(o.color);
    obj.material.opacity = 1;
    obj.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    const p = {
      type,
      obj,
      life: o.life,
      max: o.life,
      vx: o.vx || 0,
      vy: o.vy || 0,
      vz: o.vz || 0,
      g: o.g ?? 0,
      s0: o.s0 ?? 1,
      s1: o.s1 ?? o.s0 ?? 1,
      spin: o.spin ?? 0,
      face: !!o.face,
      drag: o.drag ?? 0,
      alpha: o.alpha ?? 1,
    };
    obj.scale.setScalar(p.s0);
    this.active.push(p);
    return p;
  }

  /** 衝突の星 */
  stars(x, y, z, n = 8, power = 1) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
      const sp = (5 + Math.random() * 5) * power;
      this._spawn('star', x, y, z, { life: 0.8 + Math.random() * 0.3, vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, vy: 6 + Math.random() * 5 * power, g: 18, s0: 0.5 * power, s1: 0.1, spin: 10, face: true, color: [0xffd23f, 0xffffff, 0xff8a3d][i % 3] });
    }
  }

  /** 土煙・煙 */
  puff(x, y, z, { color = 0xffffff, size = 0.6, n = 1, spread = 0.5, up = 1.5, life = 0.6, alpha = 0.75 } = {}) {
    for (let i = 0; i < n; i++) {
      this._spawn('puff', x + (Math.random() - 0.5) * spread, y, z + (Math.random() - 0.5) * spread, { life: life * (0.8 + Math.random() * 0.5), vy: up * (0.5 + Math.random()), vx: (Math.random() - 0.5), vz: (Math.random() - 0.5), s0: size * 0.5, s1: size * 1.6, color, drag: 2, alpha });
    }
  }

  /** キラキラ（アイテム取得など） */
  sparkle(x, y, z, n = 14, colors = [0xff4d5e, 0xffd23f, 0x3d8bff, 0x22b573, 0xff6fae]) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 3 + Math.random() * 6;
      this._spawn('spark', x, y, z, { life: 0.6 + Math.random() * 0.4, vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, vy: 3 + Math.random() * 6, g: 12, s0: 0.3, s1: 0.05, spin: 8, color: colors[i % colors.length] });
    }
  }

  /** 火花（壁こすり・ドリフト・ブースト） */
  sparks(x, y, z, n = 6, color = 0xffb347, power = 1) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (2 + Math.random() * 5) * power;
      this._spawn('spark', x, y, z, { life: 0.25 + Math.random() * 0.2, vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, vy: 2 + Math.random() * 4 * power, g: 20, s0: 0.18, s1: 0.04, spin: 12, color });
    }
  }

  /** 衝撃波の輪 */
  ring(x, y, z, color = 0xffffff, size = 4) {
    const p = this._spawn('ring', x, y, z, { life: 0.4, s0: 0.5, s1: size, color });
    if (p) p.obj.rotation.set(-Math.PI / 2, 0, 0);
  }

  /** 紙吹雪 */
  confetti(x, y, z, n = 60) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() * 7;
      this._spawn('confetti', x, y, z, { life: 2 + Math.random() * 1.5, vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, vy: 8 + Math.random() * 10, g: 9, s0: 0.5, s1: 0.4, spin: 6, drag: 1.2, color: [0xff4d5e, 0xffd23f, 0x3d8bff, 0x22b573, 0xff6fae, 0xffffff][i % 6] });
    }
  }

  _textTexture(word) {
    if (this.textures.has(word)) return this.textures.get(word);
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 192;
    const x = c.getContext('2d');
    x.font = '900 104px "M PLUS Rounded 1c", "Hiragino Maru Gothic ProN", "Arial Rounded MT Bold", sans-serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.lineJoin = 'round';
    x.lineWidth = 22;
    x.strokeStyle = '#ffffff';
    x.strokeText(word, 256, 100);
    x.fillStyle = TEXT_COLORS[word] || '#ff4d5e';
    x.fillText(word, 256, 100);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.textures.set(word, tex);
    return tex;
  }

  /** 擬音の文字（ドカーン! など） */
  text(word, x, y, z, size = 4) {
    const p = this._spawn('text', x, y, z, { life: 1.0, vy: 2.5, s0: size * 0.6, s1: size });
    if (!p) return;
    p.obj.material.map = this._textTexture(word);
    p.obj.material.needsUpdate = true;
    p.obj.rotation.set(0, 0, 0);
    p.text = true;
    p.size = size;
  }

  update(dt, camera) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.active.splice(i, 1);
        this._release(p);
        continue;
      }
      const o = p.obj;
      const k = 1 - p.life / p.max;
      if (p.drag) {
        const d = Math.exp(-p.drag * dt);
        p.vx *= d;
        p.vz *= d;
        if (p.type !== 'confetti') p.vy *= d;
      }
      p.vy -= p.g * dt;
      o.position.x += p.vx * dt;
      o.position.y += p.vy * dt;
      o.position.z += p.vz * dt;
      if (o.position.y < 0.05 && p.type !== 'text') {
        o.position.y = 0.05;
        p.vy = Math.abs(p.vy) * 0.3;
      }
      if (p.text) {
        // ポンッと出て少し縮む
        const s = k < 0.15 ? p.size * (0.4 + k * 6) : p.size * (1.3 - k * 0.3);
        o.scale.set(s, s * 0.375, 1);
        o.material.opacity = k > 0.7 ? (1 - k) / 0.3 : 1;
      } else {
        const s = p.s0 + (p.s1 - p.s0) * k;
        o.scale.setScalar(Math.max(0.001, s));
        o.material.opacity = p.alpha * (k > 0.6 ? (1 - k) / 0.4 : 1);
        if (p.spin) {
          o.rotation.x += p.spin * dt;
          o.rotation.y += p.spin * 0.7 * dt;
        }
        if (p.face && camera) o.quaternion.copy(camera.quaternion);
      }
    }
  }

  clear() {
    for (const p of this.active) this._release(p);
    this.active = [];
  }

  dispose() {
    this.clear();
    for (const pool of this.pools.values()) {
      for (const o of pool) {
        o.material.dispose();
        this.scene.remove(o);
      }
    }
    this.pools.clear();
    for (const g of Object.values(this.geos)) g.dispose();
    for (const m of Object.values(this.baseMats)) m.dispose();
    for (const t of this.textures.values()) t.dispose();
  }
}
