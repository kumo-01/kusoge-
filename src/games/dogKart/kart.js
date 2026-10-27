// カートのモデルと見た目のアニメーション（犬が運転席に乗る）
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildDog } from './dog.js';
import { KART } from './constants.js';

const shared = {};
function once(key, make) {
  return shared[key] || (shared[key] = make());
}
const toon = (color, extra) => new THREE.MeshToonMaterial({ color, ...extra });

function pawTexture(color) {
  return once(`paw-${color}`, () => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const x = c.getContext('2d');
    x.fillStyle = '#fff8e6';
    x.beginPath();
    x.arc(64, 64, 60, 0, Math.PI * 2);
    x.fill();
    x.fillStyle = color;
    x.beginPath();
    x.ellipse(64, 78, 24, 20, 0, 0, Math.PI * 2);
    x.fill();
    for (const [px, py] of [[34, 50], [52, 34], [76, 34], [94, 50]]) {
      x.beginPath();
      x.ellipse(px, py, 10, 12, 0, 0, Math.PI * 2);
      x.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  });
}

const PALETTE = {
  0: { main: 0xff4d5e, dark: 0xc92a3e, accent: 0xffd23f, css: '#e8384f', flag: 0xffd23f },
  1: { main: 0x3d8bff, dark: 0x1f5fd1, accent: 0x7ff0c8, css: '#2f6fe0', flag: 0xffffff },
  2: { main: 0xff8fd0, dark: 0xd85fa6, accent: 0xffffff, css: '#d85fa6', flag: 0xffffff }, // NPC プードル
  3: { main: 0xffc93c, dark: 0xd99a14, accent: 0x5a3e2b, css: '#b07a00', flag: 0x5a3e2b }, // NPC パグ
  4: { main: 0x22b573, dark: 0x168a55, accent: 0xffd23f, css: '#168a55', flag: 0xffd23f }, // NPC ダックス
  5: { main: 0x8a63ff, dark: 0x6340d6, accent: 0xb8f2ff, css: '#6340d6', flag: 0xffffff }, // NPC ハスキー
};
const DOG_KINDS = ['shiba', 'corgi', 'poodle', 'pug', 'dachs', 'husky'];

/** スピン中の見た目の回転角（状態から決まるのでホストとゲストで同じ） */
export function spinAngleOf(r) {
  return r.spin > 0 ? Math.pow(1 - r.spin / Math.max(0.1, r.spinDur), 0.7) * Math.PI * 4 : 0;
}

export class KartView {
  constructor(index) {
    const pal = PALETTE[index] || PALETTE[0];
    this.group = new THREE.Group();
    this.body = new THREE.Group(); // 傾き・跳ね用
    this.group.add(this.body);
    const main = toon(pal.main);
    const dark = toon(pal.dark);
    const accent = toon(pal.accent);
    const black = once('m-black', () => toon(0x2b2b33));
    const white = once('m-white', () => toon(0xffffff));
    const chrome = once('m-chrome', () => new THREE.MeshStandardMaterial({ color: 0xdddde6, metalness: 0.8, roughness: 0.25 }));
    this._mats = [main, dark, accent];

    const add = (geo, mat, pos, rot, parent = this.body) => {
      const o = new THREE.Mesh(geo, mat);
      o.position.set(...pos);
      if (rot) o.rotation.set(...rot);
      o.castShadow = true;
      parent.add(o);
      return o;
    };

    // 動かない部品は材質ごとに 1 つのメッシュにまとめる（描画の呼び出しを減らす）
    const statics = new Map();
    const tmpM = new THREE.Matrix4();
    const tmpQ = new THREE.Quaternion();
    const tmpE = new THREE.Euler();
    const tmpV = new THREE.Vector3();
    const tmpS = new THREE.Vector3(1, 1, 1);
    const addS = (geo, mat, pos, rot) => {
      const g = geo.index ? geo.toNonIndexed() : geo.clone();
      tmpE.set(...(rot || [0, 0, 0]));
      g.applyMatrix4(tmpM.compose(tmpV.set(...pos), tmpQ.setFromEuler(tmpE), tmpS));
      if (!statics.has(mat)) statics.set(mat, []);
      statics.get(mat).push(g);
    };

    // 車体
    addS(once('g-chassis', () => new RoundedBoxGeometry(1.9, 0.55, 2.9, 3, 0.22)), main, [0, 0.55, 0]);
    addS(once('g-nose', () => new RoundedBoxGeometry(1.5, 0.42, 0.9, 3, 0.18)), main, [0, 0.5, 1.55]);
    addS(once('g-bumper', () => new RoundedBoxGeometry(1.7, 0.28, 0.32, 2, 0.12)), black, [0, 0.36, 2.0]);
    addS(once('g-stripe', () => new THREE.BoxGeometry(0.4, 0.05, 2.6)), accent, [0, 0.84, 0.05]);
    addS(once('g-sidepod', () => new RoundedBoxGeometry(0.35, 0.4, 1.8, 2, 0.14)), dark, [-1.02, 0.5, -0.1]);
    addS(once('g-sidepod', () => null), dark, [1.02, 0.5, -0.1]);
    // ボンネットの肉球エンブレム
    const emblem = new THREE.Mesh(once('g-emblem', () => new THREE.CircleGeometry(0.32, 24)), new THREE.MeshBasicMaterial({ map: pawTexture(pal.css), transparent: true }));
    emblem.rotation.x = -Math.PI / 2 + 0.25;
    emblem.position.set(0, 0.73, 1.55);
    this.body.add(emblem);
    this._mats.push(emblem.material);
    // シート
    addS(once('g-seat', () => new RoundedBoxGeometry(1.1, 0.9, 0.3, 2, 0.12)), dark, [0, 1.1, -0.95], [-0.15, 0, 0]);
    addS(once('g-cushion', () => new RoundedBoxGeometry(1.0, 0.2, 0.9, 2, 0.08)), dark, [0, 0.86, -0.45]);
    // スポイラー
    addS(once('g-post', () => new THREE.CylinderGeometry(0.05, 0.05, 0.5, 6)), black, [-0.55, 1.0, -1.35]);
    addS(once('g-post', () => null), black, [0.55, 1.0, -1.35]);
    addS(once('g-wing', () => new RoundedBoxGeometry(1.9, 0.1, 0.5, 2, 0.04)), accent, [0, 1.26, -1.4]);
    // マフラー
    for (const sx of [-0.45, 0.45]) addS(once('g-pipe', () => new THREE.CylinderGeometry(0.11, 0.13, 0.5, 10)), chrome, [sx, 0.55, -1.6], [Math.PI / 2, 0, 0]);
    // ライト
    for (const sx of [-0.5, 0.5]) addS(once('g-light', () => new THREE.SphereGeometry(0.14, 10, 8)), once('m-light', () => new THREE.MeshBasicMaterial({ color: 0xfff6b0 })), [sx, 0.6, 1.98]);
    // ハンドル
    addS(once('g-column', () => new THREE.CylinderGeometry(0.05, 0.05, 0.6, 6)), black, [0, 0.95, 0.55], [0.9, 0, 0]);
    this.wheel = add(once('g-steer', () => new THREE.TorusGeometry(0.3, 0.06, 8, 18)), black, [0, 1.08, 0.33], [-0.65, 0, 0]);
    add(once('g-hub', () => new THREE.CylinderGeometry(0.08, 0.08, 0.06, 8)), accent, [0, 0, 0], [Math.PI / 2, 0, 0], this.wheel);

    // アンテナ（先端がぶらぶら揺れる）
    this.antenna = new THREE.Group();
    this.antenna.position.set(0.7, 1.0, -1.1);
    this.body.add(this.antenna);
    add(once('g-ant', () => new THREE.CylinderGeometry(0.025, 0.025, 1.3, 5)), black, [0, 0.65, 0], null, this.antenna);
    add(once('g-ball', () => new THREE.SphereGeometry(0.14, 10, 8)), accent, [0, 1.35, 0], null, this.antenna);
    this._ant = { x: 0, z: 0, vx: 0, vz: 0 };

    // タイヤ
    this.wheels = [];
    this.frontPivots = [];
    const tireGeo = once('g-tire', () => new THREE.CylinderGeometry(0.46, 0.46, 0.42, 16));
    const capGeo = once('g-cap', () => new THREE.CylinderGeometry(0.22, 0.22, 0.44, 12));
    for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
      const pivot = new THREE.Group();
      pivot.position.set(sx * 1.02, 0.46, sz * 1.02);
      this.group.add(pivot);
      const spin = new THREE.Group();
      pivot.add(spin);
      const tire = add(tireGeo, black, [0, 0, 0], [0, 0, Math.PI / 2], spin);
      add(capGeo, white, [0, 0, 0], [0, 0, Math.PI / 2], spin);
      add(once('g-spoke', () => new THREE.BoxGeometry(0.46, 0.08, 0.5)), accent, [0, 0, 0], null, spin);
      tire.receiveShadow = false;
      this.wheels.push(spin);
      if (sz > 0) this.frontPivots.push(pivot);
    }

    this._geos = [];
    for (const [mat, list] of statics) {
      const merged = mergeGeometries(list);
      for (const g of list) g.dispose();
      this._geos.push(merged);
      const m = new THREE.Mesh(merged, mat);
      m.castShadow = true;
      this.body.add(m);
    }

    // ブーストの炎
    this.flames = [];
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xffa31a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xfff2a8, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
    this._mats.push(flameMat, coreMat);
    for (const sx of [-0.45, 0.45]) {
      const f = new THREE.Group();
      f.position.set(sx, 0.55, -1.9);
      const outer = new THREE.Mesh(once('g-flame', () => new THREE.ConeGeometry(0.22, 1.2, 10).rotateX(-Math.PI / 2).translate(0, 0, -0.5)), flameMat);
      const core = new THREE.Mesh(once('g-flame2', () => new THREE.ConeGeometry(0.11, 0.7, 8).rotateX(-Math.PI / 2).translate(0, 0, -0.3)), coreMat);
      f.add(outer, core);
      f.visible = false;
      this.body.add(f);
      this.flames.push(f);
    }

    // 無敵中（復帰・スピン後）の点滅用に見た目をまとめて扱う
    // 犬
    this.dog = buildDog(DOG_KINDS[index] || 'shiba');
    this.dog.group.position.set(0, 0.62, -0.45);
    this.dog.group.scale.setScalar(0.92);
    this.body.add(this.dog.group);

    // ガード中の泡
    this.shield = new THREE.Mesh(
      once('g-shield', () => new THREE.SphereGeometry(2.3, 16, 12)),
      once('m-shield', () => new THREE.MeshBasicMaterial({ color: 0x7fd0ff, transparent: true, opacity: 0.32, depthWrite: false })),
    );
    this.shield.position.y = 1.3;
    this.shield.visible = false;
    this.group.add(this.shield);

    // 足元の丸い影
    const blob = new THREE.Mesh(
      once('g-blob', () => new THREE.CircleGeometry(1.9, 24)),
      once('m-blob', () => new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false })),
    );
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.03;
    blob.scale.set(0.75, 1.1, 1);
    this.blob = blob;
    // 目を回したときに頭の上を回る星
    this.dizzy = new THREE.Group();
    this.dizzy.position.set(0, 2.9, -0.35);
    const starGeo = once('g-dizzy', () => {
      const sh = new THREE.Shape();
      for (let i = 0; i < 10; i++) {
        const rr = i % 2 === 0 ? 0.28 : 0.12;
        const a = (i / 10) * Math.PI * 2;
        if (i === 0) sh.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
        else sh.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      return new THREE.ShapeGeometry(sh);
    });
    const starMat = once('m-dizzy', () => new THREE.MeshBasicMaterial({ color: 0xffd23f, side: THREE.DoubleSide }));
    for (let i = 0; i < 4; i++) {
      const st = new THREE.Mesh(starGeo, starMat);
      const a = (i / 4) * Math.PI * 2;
      st.position.set(Math.cos(a) * 0.8, 0, Math.sin(a) * 0.8);
      this.dizzy.add(st);
    }
    this.dizzy.visible = false;
    this.body.add(this.dizzy);
    // 豪雨でずぶぬれのときは頭の上に小さな雨雲
    this.cloud = new THREE.Group();
    this.cloud.position.set(0, 4.2, -0.3);
    const cloudMat = once('m-raincloud', () => toon(0x6b7189));
    for (const [cx, cy, cr] of [[0, 0, 0.75], [-0.7, -0.1, 0.55], [0.7, -0.1, 0.55], [0.3, 0.3, 0.5]]) {
      add(once('g-cloudpuff', () => new THREE.IcosahedronGeometry(1, 1)), cloudMat, [cx, cy, 0], null, this.cloud).scale.setScalar(cr);
    }
    const dropMat = once('m-drop', () => new THREE.MeshBasicMaterial({ color: 0x8ec5ff }));
    this.drops = [];
    for (let i = 0; i < 5; i++) {
      const d = add(once('g-drop', () => new THREE.CylinderGeometry(0.04, 0.04, 0.5, 4)), dropMat, [(i - 2) * 0.35, -0.8, (i % 2) * 0.3 - 0.15], null, this.cloud);
      d.castShadow = false;
      this.drops.push(d);
    }
    this.cloud.visible = false;
    this.group.add(this.cloud);
    this.firstPerson = false;
    this.own = false; // 自分の車か
    this._t = 0;
  }

  /** 一人称視点のときは自分の犬を隠す（カメラが頭の中に入らないように） */
  setFirstPerson(on) {
    if (this.firstPerson === on) return;
    this.firstPerson = on;
    this.dog.group.visible = !on;
    this.antenna.visible = !on;
  }

  /** 状態から見た目を更新する。r は描画用に補間された車の状態 */
  update(r, dt, mood) {
    this._t += dt;
    const t = this._t;
    const spinAngle = spinAngleOf(r);
    this.group.position.set(r.x, r.y, r.z);
    this.group.rotation.y = r.h + spinAngle;
    this.blob.position.set(r.x, 0.03, r.z);
    this.blob.rotation.z = -(r.h + spinAngle);
    const sh = Math.max(0.3, 1 - r.y * 0.15);
    this.blob.scale.set(0.75 * sh, 1.1 * sh, 1);

    const spRatio = Math.min(1.5, Math.abs(r.sp) / KART.MAX_SPEED);
    // 走行中の小刻みな揺れ＋衝突時の大きな揺れ
    const rumble = Math.sin(t * 38) * 0.015 * spRatio + (r.grass ? Math.sin(t * 55) * 0.03 * spRatio : 0);
    const bump = r.bump > 0 ? Math.sin(t * 45) * r.bump * 0.25 : 0;
    this.body.position.y = rumble + Math.abs(bump) * 0.4;
    // 曲がると外側へ傾く・加速で沈む（後ろが下がる）
    this.body.rotation.z = -r.st * spRatio * 0.14 + bump;
    this.body.rotation.x = -r.th * 0.05 * (r.th > 0 ? 1 - spRatio * 0.6 : 1) + (r.boost > 0 ? -0.06 : 0) + bump * 0.5;
    // 着地のつぶれ
    const squash = r.vy < -2 && r.y < 0.4 ? 0.9 : 1;
    this.body.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));

    for (const w of this.wheels) w.rotation.x += (r.sp * dt) / 0.46;
    for (const p of this.frontPivots) p.rotation.y = r.st * 0.45;
    this.wheel.rotation.z = -r.st * 1.2;

    // アンテナのばね
    const a = this._ant;
    const ax = -r.st * spRatio * 3 + (r.bump > 0 ? Math.sin(t * 30) * 6 : 0);
    const az = -r.th * 2 - (r.boost > 0 ? 3 : 0);
    a.vx += (ax - a.x * 60) * dt - a.vx * 4 * dt;
    a.vz += (az - a.z * 60) * dt - a.vz * 4 * dt;
    a.x += a.vx * dt;
    a.z += a.vz * dt;
    this.antenna.rotation.z = Math.max(-0.8, Math.min(0.8, a.x));
    this.antenna.rotation.x = Math.max(-0.8, Math.min(0.8, a.z));

    const boosting = r.boost > 0;
    for (const f of this.flames) {
      f.visible = boosting;
      if (boosting) f.scale.set(1, 1, 0.8 + Math.random() * 0.6);
    }
    // 無敵中は点滅
    this.group.visible = !(r.inv > 0 && r.spin <= 0 && Math.floor(t * 12) % 2 === 0);

    // スピン中は頭の上で星がくるくる
    this.dizzy.visible = !this.firstPerson && r.spin > 0;
    if (this.dizzy.visible) {
      this.dizzy.rotation.y = t * 6;
      for (const st of this.dizzy.children) st.rotation.y = -this.dizzy.rotation.y;
    }
    // 自分の車の雨雲は前が見えなくなるので出さない（HUD の「ずぶぬれ」表示で知らせる）
    this.cloud.visible = !this.own && r.wet > 0;
    if (this.cloud.visible) {
      this.cloud.rotation.y = -(r.h + spinAngle) + Math.sin(t * 1.5) * 0.2; // ワールドに対してほぼ向きを固定
      this.drops.forEach((d, i) => (d.position.y = -0.6 - ((t * 3 + i * 0.37) % 1) * 2.2));
    }
    // ガード（残りわずかになったら点滅）
    this.shield.visible = r.gd > 0 && (r.gd > 3 || Math.floor(t * 8) % 2 === 0);
    if (this.shield.visible) this.shield.scale.setScalar(1 + Math.sin(t * 4) * 0.04);
    this.dog.animate({ dt, speed: r.sp, steer: r.st, spin: r.spin, boost: boosting ? 1 : 0, bump: r.bump, mood });
  }

  dispose() {
    for (const m of this._mats) m.dispose();
    for (const g of this._geos) g.dispose();
  }
}
