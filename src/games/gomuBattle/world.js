// 3D の見た目（会場・犬・輪ゴム・アイテムの箱・煙・ガム・手に持った鉄砲）。計算には関わらない
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildRealDog } from './dog3d.js';
import { Particles, Decals, markTex, pawTex } from './fx.js';
import { device } from '../../core/device.js';
import { ROOM, groundY } from './arena.js';
import { ITEM, ITEMS, PLAYER, HAIRBALL, BOSS, WEAPON, GIMMICK, geyserLevel } from './constants.js';
import { mat as stdMat, kindMat as kindMat0, weaponRack } from './look.js';

/** 輪ゴムの色（種類ごと） */
export const BAND_COLORS = { 0: 0xf4a261, [ITEM.THICK]: 0xe63946, [ITEM.TRIPLE]: 0x2a9d8f, [ITEM.BOUNCE]: 0x3a86ff, [ITEM.HOMING]: 0x9b5de5, [ITEM.GOLD]: 0xffc300 };

/**
 * 背中の旗（見た目だけ）: 細い棒と、はためく布。犬の後ろ（-z）の上に立てる。color: 布の色
 */
function makeFlag(color) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.0, 6), toon(0xf1faee));
  pole.position.y = 0.5;
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), toon(0xffd23f));
  tip.position.y = 1.02;
  // 布: 横 0.46・縦 0.3 を細かく分けて、頂点を波のように動かす
  const geo = new THREE.PlaneGeometry(0.46, 0.3, 8, 2);
  geo.translate(0.23, 0, 0); // 棒の側をはしにする
  const cloth = new THREE.Mesh(geo, toon(color, { side: THREE.DoubleSide }));
  cloth.position.y = 0.84;
  cloth.rotation.y = Math.PI / 2; // 後ろへなびく
  // 白い丸（目印）
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.06, 14), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
  dot.position.set(0.2, 0, 0.003);
  cloth.add(dot);
  g.add(pole, tip, cloth);
  g.position.set(0, 0.56, -0.4);
  g.userData = { cloth, base: Float32Array.from(geo.attributes.position.array) };
  return g;
}

/** 旗の布をはためかせる（t: 時間、k: 強さ） */
function waveFlag(flag, t, k) {
  const { cloth, base } = flag.userData;
  const pos = cloth.geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = base[i * 3];
    pos.setZ(i, Math.sin(x * 14 - t * 9) * 0.05 * k * (x / 0.46));
  }
  pos.needsUpdate = true;
  cloth.userData.dot ||= cloth.children[0];
  cloth.userData.dot.position.z = Math.sin(0.2 * 14 - t * 9) * 0.05 * k * (0.2 / 0.46) + 0.003;
}

/** 金の王冠（1 位の犬の頭の上） */
function makeCrown() {
  const g = new THREE.Group();
  const goldM = new THREE.MeshStandardMaterial({ color: 0xffc300, roughness: 0.25, metalness: 0.85, emissive: 0x664400, emissiveIntensity: 0.4 });
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.12, 20, 1, true), goldM);
  band.material.side = THREE.DoubleSide;
  g.add(band);
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.14, 6), goldM);
    spike.position.set(Math.cos(a) * 0.2, 0.12, Math.sin(a) * 0.2);
    const gem = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), new THREE.MeshStandardMaterial({ color: k % 2 ? 0xe63946 : 0x3a86ff, roughness: 0.1 }));
    gem.position.set(Math.cos(a) * 0.215, 0, Math.sin(a) * 0.215);
    g.add(spike, gem);
  }
  return g;
}

/** 吹き出し「ワン！」の絵（使い回す） */
let _barkTex = null;
function barkTexture() {
  if (_barkTex) return _barkTex;
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 128;
  const x = cv.getContext('2d');
  x.fillStyle = '#ffffff';
  x.strokeStyle = '#2b2d42';
  x.lineWidth = 8;
  x.beginPath();
  x.roundRect(10, 10, 236, 88, 40);
  x.moveTo(110, 96);
  x.lineTo(128, 122);
  x.lineTo(146, 96);
  x.fill();
  x.stroke();
  x.fillStyle = '#ffffff';
  x.fillRect(112, 88, 32, 10);
  x.fillStyle = '#2b2d42';
  x.font = "60px 'Yusei Magic', 'Kiwi Maru', sans-serif";
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText('ワン！', 128, 56);
  _barkTex = new THREE.CanvasTexture(cv);
  _barkTex.colorSpace = THREE.SRGBColorSpace;
  return _barkTex;
}

/** 爆弾の見た目（半径 0.2 の黒い玉・導火線・火花）。spark は点滅させる */
function makeBomb() {
  const g = new THREE.Group();
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10), toon(0x2b2d42, { roughness: 0.5 }));
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.07, 10), toon(0x6c757d, { roughness: 0.4, metalness: 0.6 }));
  cap.position.y = 0.2;
  const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.12, 6), toon(0xc9a27e));
  fuse.position.set(0.03, 0.27, 0);
  fuse.rotation.z = -0.4;
  const spark = new THREE.Mesh(new THREE.IcosahedronGeometry(0.04, 0), new THREE.MeshBasicMaterial({ color: 0xffd23f }));
  spark.position.set(0.06, 0.33, 0);
  g.add(ball, cap, fuse, spark);
  g.userData.spark = spark;
  return g;
}

// 材質: 光の当たり方が自然なもの（look.js）。名前は前のまま
// 会場を作っている間は、同じ色・同じ設定の材質を使い回す（あとで材質ごとに 1 つにまとめて、描画の回数を減らすため）
let matCache = null;
const toon = (c, o = {}) => {
  if (!matCache || o.map) return stdMat(c, o);
  const k = `t${c}|${JSON.stringify(o)}`;
  if (!matCache.has(k)) matCache.set(k, stdMat(c, o));
  return matCache.get(k);
};
const kindMat = (kind, c, w = 1, h = 1) => {
  if (!matCache) return kindMat0(kind, c, w, h);
  const k = `k${kind}|${c}|${Math.round(w * 2)}|${Math.round(h * 2)}`;
  if (!matCache.has(k)) matCache.set(k, kindMat0(kind, c, w, h));
  return matCache.get(k);
};

/**
 * 動かない部品（家具・障害物）を、材質ごとに 1 つの形にまとめる（数百の描画を数十に）。
 * keep: まとめないもの（光る電球・回るうずなど、あとで変えるもの）
 */
function mergeStaticByMaterial(root, isKeep) {
  root.updateMatrixWorld(true);
  const by = new Map();
  const keepList = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    if (isKeep(o)) {
      keepList.push(o);
      return;
    }
    const k = o.material.uuid;
    if (!by.has(k)) by.set(k, { mat: o.material, list: [] });
    by.get(k).list.push(o);
  });
  const out = new THREE.Group();
  for (const { mat, list } of by.values()) {
    const geos = list.map((o) => {
      const g0 = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      for (const name of Object.keys(g0.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g0.deleteAttribute(name);
      if (!g0.attributes.uv) g0.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g0.attributes.position.count * 2), 2));
      if (!g0.attributes.normal) g0.computeVertexNormals();
      g0.morphAttributes = {};
      return g0.applyMatrix4(o.matrixWorld);
    });
    const merged = mergeGeometries(geos);
    for (const g0 of geos) g0.dispose();
    if (!merged) {
      for (const o of list) keepList.push(o);
      continue;
    }
    const m = new THREE.Mesh(merged, mat);
    if (list.some((o) => o.userData.noCast)) m.userData.noCast = list.every((o) => o.userData.noCast);
    out.add(m);
  }
  // まとめないものは、元の位置のまま付け替える
  for (const o of keepList) {
    o.updateMatrixWorld(true);
    const w = o.matrixWorld.clone();
    o.parent?.remove(o);
    w.decompose(o.position, o.quaternion, o.scale);
    out.add(o);
  }
  return out;
}

/** 床の模様（キャンバスで描く） */
function floorTexture(kind, color) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const x = cv.getContext('2d');
  const c = new THREE.Color(color);
  const css = (k) => `#${c.clone().multiplyScalar(k).getHexString()}`;
  x.fillStyle = css(1);
  x.fillRect(0, 0, 256, 256);
  if (kind === 'wood') {
    for (let i = 0; i < 8; i++) {
      x.fillStyle = css(0.9 + ((i * 37) % 10) / 60);
      x.fillRect(0, i * 32, 256, 31);
      x.fillStyle = css(0.75);
      x.fillRect(((i * 97) % 200) + 20, i * 32, 2, 32);
    }
  } else if (kind === 'tile') {
    x.fillStyle = css(0.82);
    for (let i = 0; i <= 4; i++) {
      x.fillRect(i * 64 - 1, 0, 3, 256);
      x.fillRect(0, i * 64 - 1, 256, 3);
    }
  } else if (kind === 'grass') {
    // 芝生: 短い草の線
    for (let i = 0; i < 1800; i++) {
      x.fillStyle = css(0.82 + Math.random() * 0.3);
      x.fillRect(Math.random() * 256, Math.random() * 256, 2, 4 + Math.random() * 4);
    }
  } else if (kind === 'sand' || kind === 'dirt') {
    for (let i = 0; i < 3000; i++) {
      x.fillStyle = css(0.86 + Math.random() * 0.22);
      x.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
    }
    if (kind === 'dirt') {
      for (let i = 0; i < 40; i++) {
        x.fillStyle = css(0.7);
        x.beginPath();
        x.arc(Math.random() * 256, Math.random() * 256, 2 + Math.random() * 3, 0, Math.PI * 2);
        x.fill();
      }
    }
  } else {
    // カーペット: 細かいざらざら
    for (let i = 0; i < 2400; i++) {
      x.fillStyle = css(0.88 + Math.random() * 0.2);
      x.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
    }
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(ROOM.W / 4, ROOM.D / 4);
  return t;
}

/** 自分の武器の見せ方（大きさ s と位置）。長いライフル・スナイパーは小さく、前に出す */
const VM_FIT = {
  [WEAPON.NORMAL]: { s: 0.4, x: 0, y: 0, z: 0 },
  [WEAPON.SNIPER]: { s: 0.3, x: 0.01, y: 0.01, z: -0.05 },
  [WEAPON.RIFLE]: { s: 0.26, x: 0.01, y: 0.01, z: -0.07 },
};

export class GomuWorld {
  constructor(container) {
    this.container = container;
    const r = new THREE.WebGLRenderer({ antialias: !device.low, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, device.maxPixelRatio));
    r.outputColorSpace = THREE.SRGBColorSpace;
    // 写真のような明るさの出し方と、ふちのやわらかい影
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    // パソコン: 犬や押せるものの影も動かす（2 フレームに 1 回描き直す）。スマホ・タブレット: 会場を作ったときに 1 回だけ描く（軽く）
    this.dynShadow = !device.low;
    r.shadowMap.autoUpdate = false;
    r.domElement.className = 'game-canvas gomu-canvas';
    container.append(r.domElement);
    this.renderer = r;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf6efe2);
    this.scene = scene;
    this.camera = new THREE.PerspectiveCamera(72, 1, 0.05, 220);
    this.camera.rotation.order = 'YXZ';
    scene.add(this.camera);
    // 空の光（上は青白く、下は地面の照り返し）と、少し傾いた太陽（影が長めに出る）
    this.hemi = new THREE.HemisphereLight(0xdcecff, 0x8d7b5e, 1.15);
    scene.add(this.hemi);
    scene.add(new THREE.AmbientLight(0xffffff, 0.12));
    const sun = new THREE.DirectionalLight(0xfff0d6, 2.7);
    sun.position.set(-34, 46, -26);
    sun.castShadow = true;
    const sr = Math.max(ROOM.W, ROOM.D) / 2 + 8; // 影を描く範囲（会場全体）
    Object.assign(sun.shadow.camera, { left: -sr, right: sr, top: sr, bottom: -sr, near: 1, far: 190 });
    const ms = device.low ? 2048 : 4096;
    sun.shadow.mapSize.set(ms, ms);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    sun.shadow.radius = 3;
    scene.add(sun, sun.target);
    this.sun = sun;
    this.arenaGroup = null;
    this.dogs = [];
    this.bands = [];
    this.fxList = [];
    this.smokes = new Map();
    this.gums = new Map();
    // エフェクト（まとめて描く粒・貼る跡）
    this.pfx = new Particles(scene, device.low ? 400 : 800, false); // 土ぼこり・紙吹雪・白い息
    this.gfx = new Particles(scene, device.low ? 300 : 600, true); // 火花・きらめき・ホタル（光る）
    this.marks = new Decals(scene, 48, markTex(), 0.5); // 輪ゴムの当たった跡
    this.paws = new Decals(scene, device.low ? 80 : 160, pawTex(), 0.55); // 雪の足あと
    this._rings = [];
    this._bounceSeen = new WeakMap();
    this._buildViewModel();
    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(container);
    this.resize();
    this.t = 0;
  }

  resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // 粒の大きさ（1 m の粒が、1 m 先で何ピクセルか）
    const px = (h * this.renderer.getPixelRatio()) / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
    this.pfx?.setScale(px);
    this.gfx?.setScale(px);
  }

  // ---- 会場 ----
  setArena(arena, tod = 1) {
    if (this.arenaGroup) {
      this.scene.remove(this.arenaGroup);
      this.arenaGroup.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          o.material.map?.dispose();
          o.material.dispose();
        }
      });
    }
    this._setNight(false); // 前の会場の夜の光を片づける
    const G = new THREE.Group();
    this.arenaGroup = G;
    this.arena = arena;
    this._lamps = [];
    this._swirls = [];
    const W = ROOM.W;
    const D = ROOM.D;
    const H = ROOM.WALL;
    if (arena.outdoor) this._buildOutdoor(G, arena);
    else {
      // 床・壁・天井
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), toon(0xffffff, { map: floorTexture(arena.floorK, arena.floor) }));
      floor.userData.noCast = true;
      floor.rotation.x = -Math.PI / 2;
      floor.receiveShadow = true;
      G.add(floor);
      const wallMat = toon(arena.wall);
      const base = toon(0xffffff);
      const walls = [
        [0, -D / 2, 0, W],
        [0, D / 2, Math.PI, W],
        [-W / 2, 0, Math.PI / 2, D],
        [W / 2, 0, -Math.PI / 2, D],
      ];
      for (const [x, z, ry, len] of walls) {
        const w = new THREE.Mesh(new THREE.PlaneGeometry(len, H), wallMat);
        w.position.set(x, H / 2, z);
        w.rotation.y = ry;
        w.receiveShadow = true;
        G.add(w);
        const b = new THREE.Mesh(new THREE.BoxGeometry(len, 0.35, 0.08), base);
        b.position.set(x, 0.17, z);
        b.rotation.y = ry;
        b.translateZ(0.04);
        G.add(b);
      }
      const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D), toon(0xfffdf8));
      ceil.rotation.x = Math.PI / 2;
      ceil.position.y = H;
      G.add(ceil);
      // 天井の照明（丸い光）
      const lampMat = new THREE.MeshBasicMaterial({ color: 0xfffbe6 });
      for (const [lx, lz] of [[-W / 4, -D / 5], [W / 4, -D / 5], [-W / 4, D / 5], [W / 4, D / 5]]) {
        const l = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 0.2, 24), lampMat);
        l.position.set(lx, H - 0.1, lz);
        G.add(l);
      }
    }
    // 家具
    // 見た目は元の箱（当たり判定は形に合わせた箱の組）。動かない部品は材質ごとにまとめる
    matCache = new Map();
    const F = new THREE.Group();
    try {
      for (const b of arena.draw || arena.boxes) F.add(this._furniture(b));
    } finally {
      matCache = null;
    }
    G.add(F); // まとめるのは最後に、ほかの動かないものと一緒に
    for (const d of arena.decor || []) {
      const o = this._decor(d);
      if (o) G.add(o);
    }
    // 加速パネル（矢印が流れる）・間欠泉
    this._buildGimmicks(G, arena);
    // アイテムの箱
    this.itemBoxes = arena.items.map(([x, z, y]) => {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new RoundedBoxGeometry(0.55, 0.55, 0.55, 2, 0.06), toon(0xffd166));
      const rib1 = new THREE.Mesh(new THREE.BoxGeometry(0.57, 0.57, 0.12), toon(0xe63946));
      const rib2 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.57, 0.57), toon(0xe63946));
      const q = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.04, 6, 12, Math.PI * 1.3), toon(0xffffff));
      q.position.y = 0.42;
      g.add(body, rib1, rib2, q);
      g.position.set(x, y + 0.5, z);
      g.userData.y = y + 0.5;
      G.add(g);
      return g;
    });
    // 風船の的（ひもつき。色はいろいろ）
    const BCOL = [0xff4d6d, 0xffbe0b, 0x3a86ff, 0x8338ec, 0x06d6a0, 0xfb5607];
    this.balloons = (arena.balloons || []).map(([x, z, y], k) => {
      const g = new THREE.Group();
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.42, 18, 14), toon(BCOL[k % BCOL.length], { roughness: 0.25 }));
      ball.scale.y = 1.18;
      const knot = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.1, 8), toon(BCOL[k % BCOL.length]));
      knot.position.y = -0.52;
      const str = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 1.4, 4), toon(0xeeeeee));
      str.position.y = -1.25;
      g.add(ball, knot, str);
      g.position.set(x, y, z);
      g.userData = { y, ph: k * 1.7 };
      G.add(g);
      return g;
    });
    // 回復のおやつ（骨の形のクッキー。足もとに緑の輪）
    this.treats = (arena.heals || []).map(([x, z, y]) => {
      const g = new THREE.Group();
      const cookie = toon(0xf2d3a0);
      const bone = new THREE.Group();
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.5, 10), cookie);
      bar.rotation.z = Math.PI / 2;
      bone.add(bar);
      for (const sx of [-0.25, 0.25]) for (const sz of [-0.07, 0.07]) {
        const knob = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), cookie);
        knob.position.set(sx, sz, 0);
        bone.add(knob);
      }
      bone.rotation.x = -0.4;
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.55, 28), new THREE.MeshBasicMaterial({ color: 0x5bd16a, transparent: true, opacity: 0.75, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = -0.38;
      ring.userData.noCast = true;
      g.add(bone, ring);
      g.position.set(x, y + 0.4, z);
      g.userData = { y: y + 0.4, bone };
      G.add(g);
      return g;
    });
    // 動かないもの（地面・柵・遠くの丘・雲・家具・パネルなど）は材質ごとにまとめる（描画の回数を減らす）
    const dyn = new Set([...this.itemBoxes, ...this.treats, ...this.balloons, ...(this.geyserFx || []).map((x) => x.g), this._snowCover?.mesh].filter(Boolean));
    const stat = new THREE.Group();
    for (const c of [...G.children]) if (!dyn.has(c)) stat.add(c);
    const keepSet = new Set([...this._swirls, ...this._lamps.map((L) => L.bulb)]);
    G.add(mergeStaticByMaterial(stat, (o) => keepSet.has(o)));
    this.scene.add(G);
    G.traverse((o) => {
      if (o.isMesh && !o.userData.noCast) o.castShadow = true;
      if (o.isMesh) o.receiveShadow = true;
    });
    // 動かないものの行列は 1 回だけ
    G.updateMatrixWorld(true);
    G.traverse((o) => {
      if (!this.itemBoxes.includes(o)) o.matrixAutoUpdate = false;
    });
    for (const g of [...this.itemBoxes, ...this.treats, ...this.balloons, ...this._swirls, ...(this.geyserFx || []).map((x) => x.g)]) g.traverse((o) => (o.matrixAutoUpdate = true));
    this.renderer.shadowMap.needsUpdate = true;
    this.movMeshes = null; // 押せるものは新しい会場で作り直す
    if (arena.outdoor) this.setTimeOfDay(tod, arena.sky); // 時間帯（ラウンドごとに 朝・昼・夕方）
    // 前の会場の煙・ガム・輪ゴムは消す
    for (const id of [...this.smokes.keys()]) this.removeSmoke(id);
    for (const id of [...this.gums.keys()]) this.removeGum(id);
  }

  /** 屋外: 空・地面（柵の外まで続く）・まわりの柵・遠くの丘と雲 */
  _buildOutdoor(G, arena) {
    const W = ROOM.W;
    const D = ROOM.D;
    this.scene.background = new THREE.Color(arena.sky);
    this._fogBase = [Math.max(W, D) * 0.95, Math.max(W, D) * 2.1];
    this.scene.fog = new THREE.Fog(arena.sky, ...this._fogBase);
    const tex = floorTexture(arena.ground, arena.floor);
    tex.repeat.set(1, 1); // くり返しは地面の UV（4 m で 1 枚）で決める
    const gmat = toon(0xffffff, { map: tex, vertexColors: true });
    // 会場の中は 1 m ごとの網目で、丘・くぼみの形に。色も少し変える（丘の上は明るく、くぼみの底は暗く湿った色）
    const inner = this._groundMesh(arena, -W / 2, W / 2, -D / 2, D / 2, Math.ceil(W), Math.ceil(D), gmat);
    G.add(inner);
    // 積もる雪（同じ形の白い面を重ねて、だんだん濃くする）
    const snowM = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
    const snowMesh = new THREE.Mesh(inner.geometry, snowM);
    snowMesh.userData.noCast = true;
    snowMesh.userData.shared = true;
    snowMesh.visible = false;
    G.add(snowMesh);
    this._snowCover = { mat: snowM, mesh: snowMesh, v: 0 };
    // 柵の外（平ら。4 枚）
    const E = 60;
    for (const [x0, x1, z0, z1] of [
      [-W / 2 - E, W / 2 + E, -D / 2 - E, -D / 2],
      [-W / 2 - E, W / 2 + E, D / 2, D / 2 + E],
      [-W / 2 - E, -W / 2, -D / 2, D / 2],
      [W / 2, W / 2 + E, -D / 2, D / 2],
    ])
      G.add(this._groundMesh(null, x0, x1, z0, z1, 1, 1, gmat));
    // 柵（ここから外へは出られない）。木の柵か、ロープと杭
    const wood = toon(arena.fence === 'rope' ? 0xa47148 : 0xc8a165);
    const rope = toon(0xf1faee);
    const sides = [
      [0, -D / 2, W, 0],
      [0, D / 2, W, 0],
      [-W / 2, 0, D, Math.PI / 2],
      [W / 2, 0, D, Math.PI / 2],
    ];
    for (const [x, z, len, ry] of sides) {
      const n = Math.ceil(len / 2.4);
      for (let k = 0; k <= n; k++) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2, 0.3), wood);
        const a = -len / 2 + (k * len) / n;
        post.position.set(x + (ry ? 0 : a), 1, z + (ry ? a : 0));
        G.add(post);
      }
      for (const y of arena.fence === 'rope' ? [1.2, 1.8] : [0.7, 1.5]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(len, arena.fence === 'rope' ? 0.08 : 0.22, arena.fence === 'rope' ? 0.08 : 0.12), arena.fence === 'rope' ? rope : wood);
        rail.position.set(x, y, z);
        rail.rotation.y = ry;
        G.add(rail);
      }
    }
    // 遠くの丘・木（柵の外。当たりはない）
    const hillMat = toon(arena.ground === 'sand' ? 0x7cc6e8 : 0x76b852);
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2 + 0.3;
      const R = 14 + (k % 4) * 4;
      // 柵から丘のふちまで 12 以上あける（角の近くで丘が会場にかぶさって、中に隠れられないように）
      const outside = (r) => Math.hypot(Math.max(0, Math.abs(Math.cos(a) * r) - W / 2), Math.max(0, Math.abs(Math.sin(a) * r * 0.85) - D / 2)) - R;
      let r = 62 + (k % 3) * 8;
      while (outside(r) < 12) r += 1;
      const hill = new THREE.Mesh(new THREE.SphereGeometry(R, 16, 10), hillMat);
      hill.scale.y = arena.ground === 'sand' && Math.sin(a) < 0 ? 0.04 : 0.45; // 砂浜の北は海（平ら）
      hill.position.set(Math.cos(a) * r, -2, Math.sin(a) * r * 0.85);
      hill.userData.noCast = true;
      G.add(hill);
    }
    if (arena.ground === 'sand') {
      const sea = new THREE.Mesh(new THREE.PlaneGeometry(W + 120, 60), toon(0x48cae4));
      sea.rotation.x = -Math.PI / 2;
      sea.position.set(0, 0.02, -D / 2 - 30);
      sea.userData.noCast = true;
      G.add(sea);
    }
    const cloudMat = toon(0xffffff);
    for (let k = 0; k < 7; k++) {
      const c = new THREE.Group();
      for (let j = 0; j < 4; j++) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(2.2 + (j % 2), 12, 8), cloudMat);
        m.position.set(j * 2.4 - 3.6, (j % 2) * 0.8, 0);
        m.userData.noCast = true;
        c.add(m);
      }
      c.position.set(-50 + k * 17, 24 + (k % 3) * 4, -40 + ((k * 23) % 80));
      G.add(c);
    }
  }

  /** ギミックの見た目: 加速パネル（光る矢印）と間欠泉（石の輪・ぬれた地面・水の柱） */
  _buildGimmicks(G, arena) {
    if (!this._padTex) {
      const cv = document.createElement('canvas');
      cv.width = 64;
      cv.height = 128;
      const x = cv.getContext('2d');
      x.fillStyle = '#1f6fb2';
      x.fillRect(0, 0, 64, 128);
      x.strokeStyle = '#7ff7ff';
      x.lineWidth = 10;
      x.lineCap = 'round';
      for (const y of [30, 94]) {
        x.beginPath();
        x.moveTo(12, y + 14);
        x.lineTo(32, y - 10);
        x.lineTo(52, y + 14);
        x.stroke();
      }
      const t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(1, 1.5);
      this._padTex = t;
    }
    const padM = new THREE.MeshBasicMaterial({ map: this._padTex, transparent: true, opacity: 0.92 });
    for (const p of arena.pads || []) {
      const g = new THREE.Group();
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 2.5), padM);
      plate.rotation.x = -Math.PI / 2;
      plate.position.y = 0.03;
      const frame = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.04, 2.7), toon(0x2b2d42, { roughness: 0.5, metalness: 0.5 }));
      frame.position.y = 0.01;
      g.add(frame, plate);
      g.position.set(p.x, groundY(arena, p.x, p.z), p.z);
      g.rotation.y = p.yaw;
      plate.userData.noCast = frame.userData.noCast = true;
      G.add(g);
    }
    this.geyserFx = (arena.geysers || []).map((gz) => {
      const g = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.28, 8, 18), kindMat('rock', 0x8d8a85, 2, 1));
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.08;
      const wet = new THREE.Mesh(new THREE.CircleGeometry(1.15, 24), toon(0x3e5c6b, { roughness: 0.15, metalness: 0.1 }));
      wet.rotation.x = -Math.PI / 2;
      wet.position.y = 0.03;
      wet.userData.noCast = true;
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.85, 1, 16, 1, true), new THREE.MeshStandardMaterial({ color: 0xbfe9ff, transparent: true, opacity: 0.5, roughness: 0.05, metalness: 0.1, side: THREE.DoubleSide, depthWrite: false }));
      col.userData.noCast = true;
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 8), new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, roughness: 0.2, depthWrite: false }));
      cap.userData.noCast = true;
      g.add(ring, wet, col, cap);
      g.position.set(gz.x, groundY(arena, gz.x, gz.z), gz.z);
      G.add(g);
      return { g, col, cap };
    });
  }

  /** ギミックを動かす: ワープ土管のうず・加速パネルの矢印・間欠泉の水の柱（clock: ラウンドの時刻） */
  updateGimmicks(clock, dt) {
    for (const s of this._swirls || []) s.rotation.z += dt * 3;
    if (this._padTex) this._padTex.offset.y = (this._padTex.offset.y - dt * 1.6) % 1;
    (this.geyserFx || []).forEach((G, k) => {
      const lv = geyserLevel(k, clock);
      const on = lv >= 1;
      const hgt = on ? 7 + Math.sin(this.t * 22 + k) * 0.5 : lv * 0.8;
      G.col.visible = hgt > 0.05;
      G.col.scale.set(1, Math.max(0.01, hgt), 1);
      G.col.position.y = hgt / 2;
      G.cap.visible = on;
      G.cap.position.y = hgt;
      G.cap.scale.setScalar(on ? 1 + Math.sin(this.t * 15 + k) * 0.15 : 0.5);
      if (on && Math.random() < dt * 30) this.burst(G.g.position.x + (Math.random() - 0.5), G.g.position.y + hgt * Math.random(), G.g.position.z + (Math.random() - 0.5), 0xe0f7ff, 2, 3, 0.08);
    });
  }

  /** ワープしたときの光（その場に緑の輪が広がる） */
  warpFx(x, y, z) {
    this.burst(x, y + 0.6, z, 0x7dffa0, 24, 4, 0.08);
  }

  /** 地面の網目（x0〜x1・z0〜z1 を nx × nz に分ける）。arena があれば丘・くぼみの高さに */
  _groundMesh(arena, x0, x1, z0, z1, nx, nz, material) {
    const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0, nx, nz);
    g.rotateX(-Math.PI / 2);
    g.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
    const pos = g.attributes.position;
    const uv = g.attributes.uv;
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const y = arena ? groundY(arena, x, z) : 0;
      pos.setY(i, y);
      uv.setXY(i, x / 4, -z / 4);
      // 高い所は少し明るく、低い所は少し暗く
      const k = y >= 0 ? 1 + Math.min(0.12, y * 0.05) : 1 + Math.max(-0.22, y * 0.16);
      col[i * 3] = k;
      col[i * 3 + 1] = k;
      col[i * 3 + 2] = y < 0 ? k * 0.96 : k;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, material);
    m.userData.noCast = true;
    return m;
  }

  _furniture(b) {
    const w = b.x1 - b.x0;
    const d = b.z1 - b.z0;
    const h = b.y1 - b.y0;
    const cx = (b.x0 + b.x1) / 2;
    const cz = (b.z0 + b.z1) / 2;
    const cy = (b.y0 + b.y1) / 2;
    const mat = kindMat(b.k, b.c, Math.max(w, d), h); // 木目・木の皮・岩・布などの模様と質感
    let o;
    if (b.k === 'ball') {
      o = new THREE.Mesh(new THREE.SphereGeometry(Math.min(w, d, h) / 2, 24, 16), mat);
      const stripe = new THREE.Mesh(new THREE.TorusGeometry(Math.min(w, d, h) / 2, 0.08, 6, 32), toon(0xffffff));
      stripe.rotation.y = Math.PI / 2;
      o.add(stripe);
    } else if (b.k === 'pot' || b.k === 'bowl' || b.k === 'metal') {
      const r = Math.min(w, d) / 2;
      o = new THREE.Mesh(new THREE.CylinderGeometry(r, b.k === 'pot' ? r * 0.75 : r * 0.9, h, 20), mat);
      if (b.k === 'bowl') {
        const food = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.8, r * 0.8, 0.05, 16), toon(0x9c6644));
        food.position.y = h / 2 - 0.04;
        o.add(food);
      }
    } else if (b.k === 'trunk' || b.k === 'stump') {
      const r = Math.min(w, d) / 2;
      o = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.85, r, h, 12), mat);
      if (b.k === 'stump') {
        const top = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.8, r * 0.8, 0.04, 12), toon(0xe9c46a));
        top.position.y = h / 2;
        o.add(top);
      }
    } else if (b.k === 'rock') {
      o = new THREE.Mesh(new THREE.DodecahedronGeometry(0.5, 0), mat);
      o.scale.set(w, h * 1.1, d);
    } else if (b.k === 'lamp') {
      // 街灯: 柱・腕・かさ・電球（夜は光る。光は setNight で近いものに置く）
      o = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.14, h, 10), mat);
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.0, 8), mat);
      arm.rotation.z = Math.PI / 2;
      arm.position.set(0.45, h / 2 - 0.12, 0);
      const shade = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.3, 14, 1, true), toon(0x30343a, { side: THREE.DoubleSide, roughness: 0.4, metalness: 0.6 }));
      shade.position.set(0.9, h / 2 - 0.2, 0);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 8), new THREE.MeshStandardMaterial({ color: 0xfff3c4, emissive: 0xffd27a, emissiveIntensity: 0.15, roughness: 0.3 }));
      bulb.position.set(0.9, h / 2 - 0.33, 0);
      bulb.userData.noCast = true;
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.4, 10), mat);
      base.position.y = -h / 2 + 0.2;
      o.add(pole, arm, shade, bulb, base);
      o.userData.lamp = { bulb, x: cx + 0.9, y: b.y1 - 0.4, z: cz };
      (this._lamps ||= []).push(o.userData.lamp);
    } else if (b.k === 'drum') {
      // ドラム缶: 円柱と、ふくらんだ輪 2 本・ふた
      const r = Math.min(w, d) / 2;
      o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 20), mat);
      for (const y of [-h * 0.18, h * 0.18]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(r + 0.005, 0.025, 6, 24), mat);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = y;
        o.add(ring);
      }
      const lid = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.96, r * 0.96, 0.02, 20), toon(0x1d4e6b, { roughness: 0.4, metalness: 0.6 }));
      lid.position.y = h / 2;
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.04, 8), toon(0xbbbbbb, { metalness: 0.8, roughness: 0.3 }));
      cap.position.set(r * 0.5, h / 2 + 0.02, 0);
      o.add(lid, cap);
    } else if (b.k === 'container') {
      // コンテナ: 波板の箱（縦のすじ）と、端の扉・取っ手
      o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      const along = w >= d;
      const len = along ? w : d;
      const n = Math.floor(len / 0.35);
      const rib = toon(new THREE.Color(b.c).multiplyScalar(0.82).getHex(), { roughness: 0.5, metalness: 0.5 });
      for (let i = 1; i < n; i++) {
        const t = -len / 2 + (i * len) / n;
        for (const sg of [-1, 1]) {
          const r = new THREE.Mesh(new THREE.BoxGeometry(along ? 0.06 : 0.05, h * 0.92, along ? 0.05 : 0.06), rib);
          r.position.set(along ? t : (sg * w) / 2, 0, along ? (sg * d) / 2 : t);
          o.add(r);
        }
      }
      for (const k of [-0.25, 0.25]) {
        const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, h * 0.9, 6), toon(0x777777, { metalness: 0.8, roughness: 0.3 }));
        bar.position.set(along ? w / 2 + 0.04 : k * w, 0, along ? k * d : d / 2 + 0.04);
        o.add(bar);
      }
    } else if (b.k === 'pipe') {
      // 土管: 寝かせた太い筒（中を通れる）
      const along = w >= d;
      const R = (along ? d : w) / 2;
      const len = along ? w : d;
      const tube = new THREE.CylinderGeometry(R, R, len, 24, 1, true);
      o = new THREE.Group();
      const outer = new THREE.Mesh(tube, mat);
      const inner = new THREE.Mesh(new THREE.CylinderGeometry(R - 0.22, R - 0.22, len, 24, 1, true), toon(0x6e6e6e, { side: THREE.BackSide, roughness: 1 }));
      const rimG = new THREE.RingGeometry(R - 0.22, R, 24);
      for (const sg of [-1, 1]) {
        const rim = new THREE.Mesh(rimG, mat);
        rim.position.y = (sg * len) / 2;
        rim.rotation.x = (sg * Math.PI) / 2;
        outer.add(rim);
      }
      outer.add(inner);
      outer.rotation[along ? 'z' : 'x'] = Math.PI / 2;
      outer.position.y = R - h / 2;
      o.add(outer);
    } else if (b.k === 'tires') {
      // タイヤの山: 黒い輪を 3 段
      o = new THREE.Group();
      const r = Math.min(w, d) / 2;
      const n = 3;
      for (let i = 0; i < n; i++) {
        const t = new THREE.Mesh(new THREE.TorusGeometry(r * 0.72, r * 0.26, 10, 22), mat);
        t.rotation.x = Math.PI / 2;
        t.position.set(((i % 2) - 0.5) * 0.06, -h / 2 + (h / n) * (i + 0.5), 0);
        t.scale.z = (h / n / (r * 0.52)) * 0.95;
        o.add(t);
      }
    } else if (b.k === 'hay') {
      // 干し草ロール: 寝かせた太い円柱（端はうず巻きの色）
      const along = w >= d;
      const r = Math.min(along ? d : w, h) / 2;
      o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, along ? w : d, 22), mat);
      o.rotation[along ? 'z' : 'x'] = Math.PI / 2;
      const endM = toon(0xd4a73c, { roughness: 1 });
      for (const sg of [-1, 1]) {
        const e = new THREE.Mesh(new THREE.CircleGeometry(r * 0.98, 22), endM);
        e.position.y = (sg * (along ? w : d)) / 2 + sg * 0.005;
        e.rotation.x = sg * -Math.PI / 2;
        o.add(e);
        const sw = new THREE.Mesh(new THREE.RingGeometry(r * 0.3, r * 0.36, 22), toon(0xb8862b));
        sw.position.copy(e.position);
        sw.position.y += sg * 0.003;
        sw.rotation.copy(e.rotation);
        o.add(sw);
      }
    } else if (b.k === 'vending') {
      // 自動販売機: 白い箱・光る見本の窓・取り出し口
      o = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, 0.05), mat);
      const front = w >= d ? (cz > 0 ? -1 : 1) : 0;
      const side = w < d ? (cx > 0 ? -1 : 1) : 0;
      const face = (gw, gh, y, m, out = 0.01) => {
        const f = new THREE.Mesh(new THREE.PlaneGeometry(gw, gh), m);
        if (front) {
          f.position.set(0, y, front * (d / 2 + out));
          if (front < 0) f.rotation.y = Math.PI;
        } else {
          f.position.set(side * (w / 2 + out), y, 0);
          f.rotation.y = (side * Math.PI) / 2;
        }
        return f;
      };
      const span = front ? w : d;
      const win = face(span * 0.82, h * 0.42, h * 0.16, new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xbfe6ff, emissiveIntensity: 0.55, roughness: 0.15 }));
      win.userData.noCast = true;
      o.add(win);
      const cols = [0xe63946, 0x2a9d8f, 0xffb703, 0x3a86ff];
      for (let r = 0; r < 2; r++) for (let k = 0; k < 4; k++) {
        const can = face(span * 0.12, h * 0.12, h * 0.26 - r * h * 0.19, toon(cols[(k + r) % 4]), 0.02);
        if (front) can.position.x = (k - 1.5) * span * 0.19;
        else can.position.z = (k - 1.5) * span * 0.19 * (side > 0 ? -1 : 1);
        o.add(can);
      }
      o.add(face(span * 0.6, h * 0.1, -h * 0.34, toon(0x222222)));
    } else if (b.k === 'wall') {
      // 石垣: ごつごつした石を積んだ低い壁
      o = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, 0.12), mat);
      const along = w >= d;
      const len = along ? w : d;
      const capM = toon(0x7d756b, { roughness: 0.95 });
      const cap = new THREE.Mesh(new RoundedBoxGeometry(along ? len + 0.1 : Math.min(w, d) + 0.12, 0.16, along ? Math.min(w, d) + 0.12 : len + 0.1, 2, 0.05), capM);
      cap.position.y = h / 2;
      o.add(cap);
    } else if (b.k === 'shed') {
      // 物置小屋: 板の壁・屋根・扉
      o = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(w, h * 0.8, d), mat);
      body.position.y = -h * 0.1;
      const roofM = toon(0x5c3d2e, { roughness: 0.8 });
      // 切妻屋根: 棟は長い方の向き。2 枚の板を外へ下がるように傾ける
      const along = w >= d;
      const span = along ? d : w;
      const len = (along ? w : d) + 0.4;
      for (const sg of [-1, 1]) {
        const half = new THREE.Mesh(new THREE.BoxGeometry(along ? len : span * 0.58, 0.12, along ? span * 0.58 : len), roofM);
        if (along) {
          half.position.set(0, h * 0.36, sg * span * 0.24);
          half.rotation.x = sg * 0.38;
        } else {
          half.position.set(sg * span * 0.24, h * 0.36, 0);
          half.rotation.z = -sg * 0.38;
        }
        o.add(half);
      }
      const door = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(w, d) * 0.4, h * 0.6), toon(0x4e342e));
      if (w >= d) door.position.set(0, -h * 0.2, d / 2 + 0.01);
      else {
        door.position.set(w / 2 + 0.01, -h * 0.2, 0);
        door.rotation.y = Math.PI / 2;
      }
      o.add(body, door);
    } else if (b.k === 'crates') {
      // 木箱の山: 下に 2 つ、上に 1 つ
      o = new THREE.Group();
      const along = w >= d;
      const unitW = along ? w / 2 : w;
      const unitD = along ? d : d / 2;
      const bh = h / 2;
      const mk = (x, y, z) => {
        const c = new THREE.Mesh(new RoundedBoxGeometry(unitW * 0.98, bh * 0.98, unitD * 0.98, 2, 0.04), mat);
        c.position.set(x, y, z);
        const slat = new THREE.Mesh(new THREE.BoxGeometry(unitW * 1.0, 0.08, unitD * 1.0), toon(0x8a6142));
        slat.position.y = 0;
        c.add(slat);
        o.add(c);
      };
      if (along) {
        mk(-w / 4, -h / 4, 0);
        mk(w / 4, -h / 4, 0);
        mk(-w / 4, h / 4, 0);
      } else {
        mk(0, -h / 4, -d / 4);
        mk(0, -h / 4, d / 4);
        mk(0, h / 4, -d / 4);
      }
    } else if (b.k === 'warp') {
      // ワープ土管: 緑の太い筒（上に乗るとワープ）。ふちと、中の暗い穴
      const r = Math.min(w, d) / 2;
      o = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.88, r * 0.88, h, 24), toon(0x2fbf4a, { roughness: 0.3 }));
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.16, 24), toon(0x39d353, { roughness: 0.3 }));
      rim.position.y = h / 2 - 0.08;
      const hole = new THREE.Mesh(new THREE.CircleGeometry(r * 0.72, 24), new THREE.MeshBasicMaterial({ color: 0x0b2410 }));
      hole.rotation.x = -Math.PI / 2;
      hole.position.y = h / 2 + 0.005;
      const swirl = new THREE.Mesh(new THREE.RingGeometry(r * 0.3, r * 0.55, 24, 1, 0, Math.PI * 1.4), new THREE.MeshBasicMaterial({ color: 0x7dffa0, transparent: true, opacity: 0.6, depthWrite: false }));
      swirl.rotation.x = -Math.PI / 2;
      swirl.position.y = h / 2 + 0.01;
      swirl.userData.noCast = true;
      o.add(rim, hole, swirl);
      (this._swirls ||= []).push(swirl);
    } else if (b.k === 'tramp') {
      // トランポリン: 黒い枠・青い布・脚
      o = new THREE.Group();
      const R = Math.min(w, d) / 2;
      const frame = new THREE.Mesh(new THREE.TorusGeometry(R - 0.08, 0.08, 8, 32), toon(0x222831, { roughness: 0.5, metalness: 0.4 }));
      frame.rotation.x = Math.PI / 2;
      frame.position.y = h / 2 - 0.06;
      const pad = new THREE.Mesh(new THREE.CircleGeometry(R - 0.14, 32), toon(b.c, { roughness: 0.6 }));
      pad.rotation.x = -Math.PI / 2;
      pad.position.y = h / 2 - 0.04;
      const ring = new THREE.Mesh(new THREE.RingGeometry(R * 0.35, R * 0.45, 32), toon(0xffd166));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = h / 2 - 0.035;
      o.add(frame, pad, ring);
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, h, 6), toon(0x222831, { roughness: 0.5, metalness: 0.4 }));
        leg.position.set(Math.cos(a) * (R - 0.1), 0, Math.sin(a) * (R - 0.1));
        o.add(leg);
      }
    } else if (b.k === 'hill') {
      // 高台の段（草のかたまり。ふちを少し丸く）
      o = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, Math.min(0.18, h * 0.3)), mat);
    } else if (b.k === 'sandbag') {
      // 土のう: 小さな袋を積んだ形
      o = new THREE.Group();
      const along = w >= d;
      const len = along ? w : d;
      const n = Math.max(2, Math.round(len / 0.7));
      for (let row = 0; row < 2; row++) {
        for (let i = 0; i < n - row; i++) {
          const bagM = new THREE.Mesh(new RoundedBoxGeometry(along ? len / n : Math.min(w, d), h / 2, along ? Math.min(w, d) : len / n, 2, 0.08), mat);
          const t = -len / 2 + (i + 0.5 + row * 0.5) * (len / n);
          bagM.position.set(along ? t : 0, -h / 4 + (row * h) / 2, along ? 0 : t);
          o.add(bagM);
        }
      }
    } else if (b.k === 'hedge' || b.k === 'sand') {
      o = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, Math.min(0.4, Math.min(w, d, h) * 0.3)), mat);
    } else if (b.k === 'log') {
      const along = w >= d;
      const r = Math.min(along ? d : w, h) / 2;
      o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, along ? w : d, 12), mat);
      o.rotation[along ? 'z' : 'x'] = Math.PI / 2;
      o.scale.y = 1;
      const end = toon(0xe9c46a);
      for (const sgn of [-1, 1]) {
        const e = new THREE.Mesh(new THREE.CircleGeometry(r * 0.9, 12), end);
        e.position.y = (sgn * (along ? w : d)) / 2 + sgn * 0.005;
        e.rotation.x = sgn * -Math.PI / 2;
        o.add(e);
      }
      // 寝かせた円柱は、上下を (h) の中心に
    } else if (b.k === 'umbrella') {
      o = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) / 2 + 0.3, 1.1, 16, 1, true), toon(b.c, { side: THREE.DoubleSide }));
      o.position.y = 0.3;
    } else if (b.k === 'tent') {
      // 三角の屋根（横から見て三角）
      const shape = new THREE.Shape([new THREE.Vector2(-w / 2, -h / 2), new THREE.Vector2(w / 2, -h / 2), new THREE.Vector2(0, h / 2)]);
      const geo = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false });
      geo.translate(0, 0, -d / 2);
      o = new THREE.Mesh(geo, mat);
      const door = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.3, h * 0.6), toon(0x3d2b1f));
      door.position.set(0, -h * 0.2, d / 2 + 0.01);
      o.add(door);
    } else if (b.k === 'car') {
      o = new THREE.Mesh(new RoundedBoxGeometry(w, h * 0.55, d, 2, 0.2), mat);
      o.position.y = 0;
      const cab = new THREE.Mesh(new RoundedBoxGeometry(w * 0.55, h * 0.45, d * 0.92, 2, 0.15), mat);
      cab.position.set(-w * 0.05, h * 0.5, 0);
      const glass = toon(0xbfe6ff);
      const win = new THREE.Mesh(new THREE.BoxGeometry(w * 0.5, h * 0.3, d * 0.94), glass);
      win.position.set(-w * 0.05, h * 0.52, 0);
      o.add(cab, win);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.3, 14), toon(0x222222));
        wh.rotation.x = Math.PI / 2;
        wh.position.set(sx * w * 0.32, -h * 0.28, sz * (d / 2));
        o.add(wh);
      }
      o.position.set(cx, h * 0.3, cz);
      return o;
    } else if (b.k === 'fire') {
      o = new THREE.Group();
      for (let k = 0; k < 3; k++) {
        const lg = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, w, 8), toon(0x6d4c41));
        lg.rotation.z = Math.PI / 2;
        lg.rotation.y = (k * Math.PI) / 3;
        lg.position.y = -h / 2 + 0.12;
        o.add(lg);
      }
    } else if (b.k === 'boat') {
      o = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, 0.4), mat);
      const inner = new THREE.Mesh(new THREE.BoxGeometry(w * 0.8, 0.05, d * 0.85), toon(0x118ab2));
      inner.position.y = h / 2 + 0.01;
      o.add(inner);
    } else if (b.k === 'pond') {
      o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      const water = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.5, d - 0.5), toon(0x48cae4));
      water.rotation.x = -Math.PI / 2;
      water.position.y = h / 2 + 0.01;
      o.add(water);
    } else if (['fabric', 'cushion', 'bed', 'toy', 'play', 'step'].includes(b.k)) {
      const rad = Math.min(0.18, Math.min(w, d, h) * 0.25);
      o = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, rad), mat);
    } else {
      o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      if (b.k === 'tv') {
        // 画面（部屋の中心の向き）
        const scr = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.92, h * 0.85), new THREE.MeshBasicMaterial({ color: 0x5ec8e5 }));
        scr.position.z = -d / 2 - 0.01;
        scr.rotation.y = Math.PI;
        o.add(scr);
      } else if (b.k === 'fridge') {
        const hd = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.6, 0.12), toon(0x868e96));
        hd.position.set(w / 2 - 0.4, 0.4, d / 2 + 0.06);
        o.add(hd);
        const line = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, 0.02), toon(0xadb5bd));
        line.position.set(0, 1, d / 2 + 0.01);
        o.add(line);
      } else if (b.k === 'counter') {
        const top = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, 0.18, d + 0.1), toon(0x6c757d));
        top.position.y = h / 2;
        o.add(top);
        for (let i = -3; i <= 3; i++) {
          const dr = new THREE.Mesh(new THREE.BoxGeometry(w / 8, h * 0.7, 0.02), toon(0xe9ecef));
          dr.position.set((i * w) / 7.5, -0.2, d / 2 + 0.01);
          o.add(dr);
        }
      } else if (b.k === 'cardboard') {
        const tape = new THREE.Mesh(new THREE.BoxGeometry(w + 0.01, 0.02, 0.3), toon(0xe9d8a6));
        tape.position.y = h / 2;
        o.add(tape);
      }
    }
    o.position.set(cx, cy, cz);
    return o;
  }

  _decor(d) {
    const W = ROOM.W;
    const D = ROOM.D;
    const onWall = (o, wall, along, y) => {
      if (wall === 'n') o.position.set(along, y, -D / 2 + 0.03);
      else if (wall === 's') {
        o.position.set(along, y, D / 2 - 0.03);
        o.rotation.y = Math.PI;
      } else if (wall === 'w') {
        o.position.set(-W / 2 + 0.03, y, along);
        o.rotation.y = Math.PI / 2;
      } else {
        o.position.set(W / 2 - 0.03, y, along);
        o.rotation.y = -Math.PI / 2;
      }
      return o;
    };
    if (d.type === 'rug') {
      const geo = d.round ? new THREE.CircleGeometry(Math.min(d.w, d.d) / 2, 40) : new THREE.PlaneGeometry(d.w, d.d);
      const o = new THREE.Mesh(geo, toon(d.c));
      o.rotation.x = -Math.PI / 2;
      o.position.set(d.x, 0.012, d.z);
      return o;
    }
    if (d.type === 'window') {
      const g = new THREE.Group();
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(d.w, d.h), new THREE.MeshBasicMaterial({ color: 0xbfe6ff }));
      const fr = toon(0xffffff);
      const bars = [
        [d.w + 0.2, 0.15, 0, d.h / 2],
        [d.w + 0.2, 0.15, 0, -d.h / 2],
        [0.15, d.h, -d.w / 2, 0],
        [0.15, d.h, d.w / 2, 0],
        [0.1, d.h, 0, 0],
      ];
      g.add(glass);
      for (const [bw, bh, bx, by] of bars) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.06), fr);
        m.position.set(bx, by, 0.03);
        g.add(m);
      }
      return onWall(g, d.wall, d.x ?? d.z, d.y);
    }
    if (d.type === 'frame') {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.PlaneGeometry(d.w + 0.25, d.h + 0.25), toon(0x7a5230)));
      const pic = new THREE.Mesh(new THREE.PlaneGeometry(d.w, d.h), toon(d.c));
      pic.position.z = 0.01;
      g.add(pic);
      // 絵の中の骨
      const bone = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, d.w * 0.4, 4, 8), toon(0xffffff));
      bone.rotation.z = Math.PI / 2;
      bone.position.z = 0.03;
      g.add(bone);
      return onWall(g, d.wall, d.x ?? d.z, d.y);
    }
    if (d.type === 'clock') {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.CircleGeometry(d.r, 32), toon(0xffffff)));
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.06, d.r * 0.8, 0.02), toon(0x222222));
      hand.position.set(0, d.r * 0.35, 0.02);
      g.add(hand);
      return onWall(g, d.wall, d.x ?? d.z, d.y);
    }
    if (d.type === 'water') {
      const o = new THREE.Mesh(new THREE.PlaneGeometry(d.w, d.d), toon(d.c, { transparent: true, opacity: 0.85 }));
      o.rotation.x = -Math.PI / 2;
      o.position.set(d.x, 0.03, d.z);
      return o;
    }
    if (d.type === 'fire') {
      // たき火の炎（光る三角。当たりはない）
      const g = new THREE.Group();
      const m1 = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.1, 8), new THREE.MeshBasicMaterial({ color: 0xff9f1c }));
      const m2 = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.7, 8), new THREE.MeshBasicMaterial({ color: 0xffe066 }));
      m1.position.y = 0.55;
      m2.position.y = 0.4;
      m1.userData.noCast = m2.userData.noCast = true;
      g.add(m1, m2);
      g.position.set(d.x, d.y, d.z);
      return g;
    }
    if (d.type === 'leaves') {
      const g = new THREE.Group();
      const mat = toon(0x52b788);
      for (let i = 0; i < 6; i++) {
        const m = new THREE.Mesh(new THREE.IcosahedronGeometry(d.r * (0.45 + (i % 3) * 0.12), 0), mat);
        m.position.set(Math.cos(i * 1.1) * d.r * 0.4, d.r * (0.4 + (i % 2) * 0.5), Math.sin(i * 1.1) * d.r * 0.4);
        g.add(m);
      }
      g.position.set(d.x, d.y, d.z);
      return g;
    }
    return null;
  }

  /** 押せるもの（段ボール・洗濯かご・おもちゃ箱）。list: 箱（位置は毎フレーム合わせる） */
  updateMovables(list) {
    if (this._movSrc !== list.length || !this.movMeshes) {
      for (const m of this.movMeshes || []) this.arenaGroup?.remove(m);
      this._movSrc = list.length;
      this.movMeshes = list.map((b) => {
        const w = b.x1 - b.x0;
        const d = b.z1 - b.z0;
        const h = b.y1 - b.y0;
        const g = new THREE.Group();
        const body = new THREE.Mesh(b.k === 'basket' ? new THREE.CylinderGeometry(Math.min(w, d) / 2, Math.min(w, d) / 2.3, h, 16, 1, true) : new RoundedBoxGeometry(w, h, d, 2, 0.05), toon(b.c, { side: THREE.DoubleSide }));
        body.castShadow = true;
        g.add(body);
        if (b.k === 'cardboard') {
          const tape = new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, 0.03, 0.35), toon(0xe9d8a6));
          tape.position.y = h / 2;
          const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.4, 3), toon(0x7f5539));
          arrow.rotation.x = Math.PI / 2;
          arrow.position.set(0, 0.1, d / 2 + 0.02);
          g.add(tape, arrow);
        } else if (b.k === 'basket') {
          const bottom = new THREE.Mesh(new THREE.CircleGeometry(Math.min(w, d) / 2.3, 16), toon(b.c));
          bottom.rotation.x = -Math.PI / 2;
          bottom.position.y = -h / 2 + 0.02;
          const cloth = new THREE.Mesh(new THREE.SphereGeometry(Math.min(w, d) / 2.6, 10, 6), toon(0xffffff));
          cloth.scale.y = 0.4;
          cloth.position.y = h / 2 - 0.1;
          g.add(bottom, cloth);
        } else {
          const lid = new THREE.Mesh(new THREE.BoxGeometry(w + 0.08, 0.12, d + 0.08), toon(0xff006e));
          lid.position.y = h / 2;
          g.add(lid);
        }
        g.userData.h = h;
        (this.arenaGroup || this.scene).add(g);
        return g;
      });
    }
    list.forEach((b, k) => {
      const g = this.movMeshes[k];
      if (!g) return;
      g.position.set((b.x0 + b.x1) / 2, g.userData.h / 2, (b.z0 + b.z1) / 2);
    });
  }

  /** アイテムの箱（出ているか）。くるくる回す */
  updateItemBoxes(on, dt) {
    this.t += dt;
    (this.itemBoxes || []).forEach((g, k) => {
      g.visible = !!on[k];
      if (!g.visible) return;
      g.rotation.y += dt * 1.5;
      g.position.y = g.userData.y + Math.sin(this.t * 3 + k) * 0.08;
    });
  }

  /** 風船の的: 浮かんでいるものだけ見せて、ふわふわ揺らす */
  updateBalloons(on, dt) {
    void dt;
    (this.balloons || []).forEach((g, k) => {
      g.visible = !!on[k];
      if (!g.visible) return;
      g.position.y = g.userData.y + Math.sin(this.t * 1.4 + g.userData.ph) * 0.12;
      g.rotation.z = Math.sin(this.t * 0.9 + g.userData.ph) * 0.08;
    });
  }

  /**
   * おとり人形（持ち主そっくりの犬）。list = [{ id, o, x, y, z, yaw }]、kindOf(o) = 持ち主の犬の種類、colorOf(o) = 足もとの輪の色
   */
  updateDecoys(list, kindOf, colorOf) {
    this.decoys ||= new Map();
    const ids = new Set(list.map((d) => d.id));
    for (const [id, m] of this.decoys) {
      if (ids.has(id)) continue;
      this.scene.remove(m);
      this.decoys.delete(id);
    }
    for (const d of list) {
      let m = this.decoys.get(d.id);
      if (!m) {
        m = new THREE.Group();
        const dog = buildRealDog(kindOf(d.o));
        dog.animate({ dt: 0, moving: false, pitch: 0 });
        const gun = weaponRack();
        gun.position.set(0, dog.handY, 0.4);
        gun.scale.setScalar(0.9);
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.36, 0.48, 24), new THREE.MeshBasicMaterial({ color: colorOf(d.o), transparent: true, opacity: 0.85 }));
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.02;
        m.add(dog.group, gun, ring);
        if (this.dynShadow) m.traverse((o) => o.isMesh && (o.castShadow = true));
        this.scene.add(m);
        this.decoys.set(d.id, m);
      }
      m.position.set(d.x, d.y, d.z);
      m.rotation.y = d.yaw;
    }
  }

  /** 時間帯（0 = 朝・1 = 昼・2 = 夕方）: 空・太陽の色と高さ・明るさ */
  /**
   * 時間帯: 0 朝・1 昼・2 夜（ラウンドごと）。夜は月の光と、街灯（電球が光り、足もとが明るい）。
   * 本当の光（PointLight）は数が多いと重いので、カメラに近い街灯にだけ置く（NIGHT_LIGHTS 個）。ほかの街灯は光の輪で明るく見せる
   */
  setTimeOfDay(k, baseSky) {
    const TOD = [
      { sun: 0xffe2c0, si: 2.3, pos: [-46, 30, -10], hs: 0xd8e8ff, hg: 0x8d7b5e, hi: 1.05, sky: 0xffd9b0, mix: 0.3, exp: 1.0 },
      { sun: 0xfff0d6, si: 2.7, pos: [-34, 46, -26], hs: 0xdcecff, hg: 0x8d7b5e, hi: 1.15, sky: null, mix: 0, exp: 1.05 },
      { sun: 0xa9bcff, si: 0.55, pos: [30, 50, -24], hs: 0x3a4d80, hg: 0x1c1a16, hi: 0.42, sky: 0x0b1530, mix: 0.94, exp: 1.15 },
    ];
    this.tod = k % 3;
    const T = TOD[this.tod];
    this.sun.color.setHex(T.sun);
    this.sun.intensity = T.si;
    this.sun.position.set(...T.pos);
    this.hemi.color.setHex(T.hs);
    this.hemi.groundColor.setHex(T.hg);
    this.hemi.intensity = T.hi;
    this._exp = T.exp;
    this.renderer.toneMappingExposure = T.exp * (this.nv ? 2.6 : 1);
    const sky = new THREE.Color(baseSky);
    if (T.sky != null) sky.lerp(new THREE.Color(T.sky), T.mix);
    this._sky = sky;
    this._sunBase = T.si;
    this.scene.background = sky.clone();
    if (this.scene.fog) this.scene.fog.color.copy(sky);
    this._setNight(this.tod === 2);
    this.renderer.shadowMap.needsUpdate = true;
    this.setWeather(this._wx || 0, 0, true);
  }

  /** 夜: 街灯をつける・星・ホタル */
  _setNight(on) {
    this.night = on;
    const lamps = this._lamps || [];
    for (const L of lamps) L.bulb.material.emissiveIntensity = on ? 4 : 0.15;
    // 光の輪（足もと）と、電球のまわりのぼんやりした光
    if (!this._glowTex) {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 64;
      const x = cv.getContext('2d');
      const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g;
      x.fillRect(0, 0, 64, 64);
      this._glowTex = new THREE.CanvasTexture(cv);
    }
    if (on && this.arenaGroup && !this._nightFx) {
      const grp = new THREE.Group();
      const poolM = new THREE.MeshBasicMaterial({ map: this._glowTex, color: 0xffc977, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
      const haloM = new THREE.SpriteMaterial({ map: this._glowTex, color: 0xffe2a8, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
      const poolG = new THREE.PlaneGeometry(13, 13);
      for (const L of lamps) {
        const pool = new THREE.Mesh(poolG, poolM);
        pool.rotation.x = -Math.PI / 2;
        pool.position.set(L.x, (this.arena ? groundY(this.arena, L.x, L.z) : 0) + 0.04, L.z);
        const halo = new THREE.Sprite(haloM);
        halo.scale.set(2.2, 2.2, 1);
        halo.position.set(L.x, L.y - 0.05, L.z);
        grp.add(pool, halo);
      }
      // 星
      const N = 600;
      const pos = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) {
        const a = Math.random() * Math.PI * 2;
        const e = 0.12 + Math.random() * 1.3;
        const R = 190;
        pos.set([Math.cos(a) * Math.cos(e) * R, Math.sin(e) * R, Math.sin(a) * Math.cos(e) * R], i * 3);
      }
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.3, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85 }));
      grp.add(stars);
      // 月
      const moon = new THREE.Mesh(new THREE.SphereGeometry(6, 20, 14), new THREE.MeshBasicMaterial({ color: 0xf4f1de, fog: false }));
      moon.position.set(60, 95, -120);
      grp.add(moon);
      this.scene.add(grp);
      this._nightFx = grp;
      // 本当の光（近い街灯にだけ）
      const n = device.low ? 4 : 8;
      this._lampLights = Array.from({ length: n }, () => {
        const l = new THREE.PointLight(0xffd29a, 38, 20, 1.8);
        this.scene.add(l);
        return l;
      });
      this._lampT = 0;
    }
    if (!on && this._nightFx) {
      this.scene.remove(this._nightFx);
      this._nightFx.traverse((o) => o.geometry?.dispose?.());
      this._nightFx = null;
      for (const l of this._lampLights || []) this.scene.remove(l);
      this._lampLights = null;
    }
  }

  /** 夜: カメラに近い街灯に光を置き直す（ときどき） */
  _stepLamps(dt) {
    if (!this._lampLights || !this._lamps?.length) return;
    this._lampT -= dt;
    if (this._lampT > 0) return;
    this._lampT = 0.25;
    const c = this.camera.position;
    const near = [...this._lamps].sort((a, b) => (a.x - c.x) ** 2 + (a.z - c.z) ** 2 - ((b.x - c.x) ** 2 + (b.z - c.z) ** 2));
    this._lampLights.forEach((l, i) => {
      const L = near[i];
      l.visible = !!L;
      if (L) l.position.set(L.x, L.y - 0.2, L.z);
    });
  }

  /** 暗視ゴーグル（夜に明るく緑に見える）。画面の模様は hud が出す */
  setNightVision(on) {
    this.nv = !!on;
    this.renderer.toneMappingExposure = (this._exp ?? 1.05) * (this.nv ? 2.6 : 1);
    this.renderer.domElement.classList.toggle('nv', this.nv);
  }

  /** 天気: 0 なし・1 雨・2 雪。雪は地面がだんだん白くなる（やむと、ゆっくりとける） */
  setWeather(wx, dt = 0, force = false) {
    const changed = force || this._wx !== wx;
    this._wx = wx;
    const rain = wx === 1;
    const snow = wx === 2;
    if (changed) {
      if (!this._rain) {
        const N = 900;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 6), 3));
        const lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xc8d6e5, transparent: true, opacity: 0.55, depthWrite: false }));
        lines.frustumCulled = false;
        this.scene.add(lines);
        this._rain = { lines, N, seeded: false };
      }
      if (!this._snow) {
        const N = device.low ? 900 : 1600;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
        const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, map: this._flakeTex(), size: 0.15, transparent: true, depthWrite: false, opacity: 0.95 }));
        pts.frustumCulled = false;
        this.scene.add(pts);
        this._snow = { pts, N, seeded: false, ph: new Float32Array(N).map(() => Math.random() * 10) };
      }
      this._rain.lines.visible = rain;
      this._snow.pts.visible = snow;
      const sky = (this._sky || new THREE.Color(0xbfe3ff)).clone();
      if (rain) sky.lerp(new THREE.Color(this.night ? 0x10141c : 0x7d8794), 0.6);
      if (snow) sky.lerp(new THREE.Color(this.night ? 0x1c2433 : 0xdfe6ee), 0.65);
      this.scene.background = sky;
      if (this.scene.fog) {
        this.scene.fog.color.copy(sky);
        this.scene.fog.near = rain ? 25 : snow ? 30 : this._fogBase?.[0] ?? 90;
        this.scene.fog.far = rain ? 85 : snow ? 95 : this._fogBase?.[1] ?? 200;
      }
      this.sun.intensity = (this._sunBase ?? 2.7) * (rain ? 0.45 : snow ? 0.6 : 1);
    }
    // 積もった雪（地面を白く）
    if (this._snowCover) {
      const k = this._snowCover;
      k.v = Math.max(0, Math.min(0.78, k.v + (snow ? dt / 25 : -dt / 60)));
      k.mat.opacity = k.v;
      k.mesh.visible = k.v > 0.01;
    }
  }

  /** 雪のひとひらの絵（丸くぼかしたもの） */
  _flakeTex() {
    if (this._flake) return this._flake;
    const cv = document.createElement('canvas');
    cv.width = cv.height = 32;
    const x = cv.getContext('2d');
    const g = x.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.8)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 32, 32);
    this._flake = new THREE.CanvasTexture(cv);
    return this._flake;
  }

  /** 雨つぶ・雪を動かす（カメラのまわりだけ） */
  _stepWeather(dt) {
    const c = this.camera.position;
    const R = this._rain;
    if (R?.lines.visible) {
      const pos = R.lines.geometry.attributes.position;
      const S = 18;
      for (let i = 0; i < R.N; i++) {
        let x = pos.getX(i * 2);
        let y = pos.getY(i * 2);
        let z = pos.getZ(i * 2);
        if (!R.seeded || y < c.y - 6 || Math.abs(x - c.x) > S || Math.abs(z - c.z) > S) {
          x = c.x + (Math.random() - 0.5) * 2 * S;
          z = c.z + (Math.random() - 0.5) * 2 * S;
          y = R.seeded ? c.y + 10 + Math.random() * 4 : c.y + Math.random() * 14;
        }
        y -= 22 * dt;
        pos.setXYZ(i * 2, x, y, z);
        pos.setXYZ(i * 2 + 1, x + 0.02, y + 0.45, z);
      }
      R.seeded = true;
      pos.needsUpdate = true;
    }
    const W = this._snow;
    if (W?.pts.visible) {
      const pos = W.pts.geometry.attributes.position;
      const S = 16;
      for (let i = 0; i < W.N; i++) {
        let x = pos.getX(i);
        let y = pos.getY(i);
        let z = pos.getZ(i);
        if (!W.seeded || y < c.y - 5 || Math.abs(x - c.x) > S || Math.abs(z - c.z) > S) {
          x = c.x + (Math.random() - 0.5) * 2 * S;
          z = c.z + (Math.random() - 0.5) * 2 * S;
          y = W.seeded ? c.y + 8 + Math.random() * 3 : c.y - 4 + Math.random() * 14;
        }
        const ph = W.ph[i] + this.t;
        // ふわふわ横に揺れながら、ゆっくり落ちる
        x += Math.sin(ph * 1.3) * 0.6 * dt;
        z += Math.cos(ph * 0.9) * 0.6 * dt;
        y -= (1.1 + (i % 5) * 0.12) * dt;
        pos.setXYZ(i, x, y, z);
      }
      W.seeded = true;
      pos.needsUpdate = true;
    }
  }

  /** 回復のおやつ: 出ているものだけ見せて、ゆっくり回す */
  updateTreats(on, dt) {
    (this.treats || []).forEach((g, k) => {
      g.visible = !!on[k];
      if (!g.visible) return;
      g.userData.bone.rotation.y += dt * 2;
      g.position.y = g.userData.y + Math.sin(this.t * 2.6 + k) * 0.06;
    });
  }

  // ---- 犬 ----
  /** kinds: 番号ごとの犬の種類、colors: 番号ごとの足もとの輪の色 */
  /** kinds: 犬の種類、colors: 足もとの輪の色、flags: 背中の旗の色（null なら旗なし。見た目だけ） */
  ensureDogs(kinds, colors, flags = []) {
    if (this.dogs.length === kinds.length && this.dogs.every((d, i) => d.kind === kinds[i])) return;
    for (const d of this.dogs) this.scene.remove(d.root);
    this.dogs = kinds.map((kind, i) => {
      const root = new THREE.Group();
      const dog = buildRealDog(kind);
      // 持っている武器（輪ゴム鉄砲・スナイパー・ライフル。相手からも見える）。前足で構える
      const gun = weaponRack();
      gun.position.set(0, dog.handY, 0.4);
      gun.scale.setScalar(0.9);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.36, 0.48, 24), new THREE.MeshBasicMaterial({ color: colors[i] ?? 0xffffff, transparent: true, opacity: 0.85 }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.02;
      const blob = new THREE.Mesh(new THREE.CircleGeometry(0.42, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false }));
      blob.rotation.x = -Math.PI / 2;
      blob.position.y = 0.015;
      const gum = new THREE.Mesh(new THREE.SphereGeometry(0.4, 12, 8), toon(0xff7eb6));
      gum.scale.set(1.2, 0.18, 1.2);
      gum.visible = false;
      // 無敵スターの光（金色の玉）
      const star = new THREE.Mesh(new THREE.SphereGeometry(0.72, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
      star.position.y = 0.5;
      star.visible = false;
      const body = new THREE.Group();
      body.add(dog.group, gun);
      const flag = flags[i] != null ? makeFlag(flags[i]) : null;
      if (flag) body.add(flag);
      // 1 位の王冠・リベンジの印（自分を倒した相手）・遠吠えの吹き出し
      const crown = makeCrown();
      crown.position.y = PLAYER.HEIGHT + 0.22;
      crown.visible = false;
      const mark = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.34, 4), new THREE.MeshBasicMaterial({ color: 0xff3b30 }));
      mark.rotation.x = Math.PI; // 下向き
      mark.position.y = PLAYER.HEIGHT + 0.85;
      mark.visible = false;
      const bubble = new THREE.Sprite(new THREE.SpriteMaterial({ map: barkTexture(), transparent: true, depthWrite: false }));
      bubble.scale.set(1.1, 0.55, 1);
      bubble.position.set(0, PLAYER.HEIGHT + 0.6, 0);
      bubble.visible = false;
      root.add(body, ring, blob, gum, star, crown, mark, bubble);
      if (this.dynShadow) body.traverse((o) => o.isMesh && (o.castShadow = true));
      this.scene.add(root);
      return { kind, root, body, dog, gun, ring, blob, gum, star, flag, crown, mark, bubble, barkT: 0, t: i };
    });
  }

  /** 犬 i の足もとの輪と、背中の旗（あれば）の色を変える（チームがあとで決まったとき） */
  setDogColor(i, hex) {
    const d = this.dogs[i];
    if (!d) return;
    d.ring.material.color.setHex(hex);
    d.flag?.userData.cloth.material.color.setHex(hex);
  }

  /** いま 1 位の犬に王冠（-1 ならだれにも） */
  setCrown(leader) {
    this.dogs.forEach((d, i) => (d.crown.visible = i === leader));
  }

  /** リベンジの印（自分を倒した相手。-1 なら出さない） */
  setMark(i) {
    this.dogs.forEach((d, k) => (d.mark.visible = k === i));
  }

  /** 犬 i が遠吠え（吹き出し「ワン！」） */
  bark(i) {
    const d = this.dogs[i];
    if (d) d.barkT = 1.6;
  }

  /** 空からの補給箱（なければ null）。落ちている間はパラシュート。遠くから見える光の柱 */
  updateDrop(dp, dt) {
    if (!this._drop) {
      const g = new THREE.Group();
      const crate = new THREE.Mesh(new RoundedBoxGeometry(1, 1, 1, 2, 0.06), kindMat('wood', 0xc49a6c, 1, 1));
      crate.position.y = 0.5;
      const bandM = toon(0x2f80ed, { roughness: 0.5 });
      crate.add(new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.14, 1.02), bandM));
      const gold = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.05, 8, 20), toon(0xffc300, { roughness: 0.3, metalness: 0.7 }));
      gold.position.set(0, 0, 0.52);
      crate.add(gold);
      const chute = new THREE.Group();
      for (let k = 0; k < 8; k++) {
        const seg = new THREE.Mesh(new THREE.SphereGeometry(2.2, 6, 6, (k / 8) * Math.PI * 2, Math.PI / 4, 0, Math.PI / 2), toon(k % 2 ? 0xffffff : 0xe63946, { side: THREE.DoubleSide, roughness: 0.9 }));
        chute.add(seg);
      }
      chute.position.y = 4.2;
      chute.scale.y = 0.6;
      const strings = new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints([-1, 1].flatMap((sx) => [-1, 1].flatMap((sz) => [new THREE.Vector3(sx * 0.45, 1, sz * 0.45), new THREE.Vector3(sx * 1.6, 4.2, sz * 1.6)]))),
        new THREE.LineBasicMaterial({ color: 0x444444 }),
      );
      chute.userData.strings = strings;
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 60, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
      beam.position.y = 30;
      g.add(crate, chute, strings);
      this.scene.add(g, beam);
      crate.castShadow = true;
      this._drop = { g, chute, strings, beam, t: 0 };
    }
    const D = this._drop;
    D.g.visible = D.beam.visible = !!dp;
    if (!dp) return;
    D.t += dt;
    D.g.position.set(dp.x, dp.y, dp.z);
    const gy = this.arena ? groundY(this.arena, dp.x, dp.z) : 0;
    D.g.rotation.z = dp.y > gy + 0.2 ? Math.sin(D.t * 1.3) * 0.08 : 0; // ゆらゆら
    D.chute.visible = D.strings.visible = dp.y > gy + 0.2;
    D.beam.position.set(dp.x, 30, dp.z);
    D.beam.material.opacity = 0.16 + Math.sin(D.t * 4) * 0.06;
  }

  /** 突風: 風に流される葉っぱ（カメラのまわり）。wind = { x, z, t }（t が 0 なら止む） */
  setWind(wind, dt) {
    const on = !!wind && wind.t > 0;
    if (!this._leaves) {
      const N = 140;
      const pos = new Float32Array(N * 3);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      // 葉っぱの形の小さな絵（丸い点。四角く見えないように）
      const cv = document.createElement('canvas');
      cv.width = cv.height = 32;
      const cx = cv.getContext('2d');
      cx.fillStyle = '#ffffff';
      cx.beginPath();
      cx.ellipse(16, 16, 13, 7, 0.6, 0, Math.PI * 2);
      cx.fill();
      const tex = new THREE.CanvasTexture(cv);
      const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: 0x7cb342, size: 0.09, map: tex, transparent: true, alphaTest: 0.4, depthWrite: false }));
      pts.frustumCulled = false;
      this.scene.add(pts);
      this._leaves = { pts, N, init: false };
    }
    const L = this._leaves;
    L.pts.visible = on;
    if (!on) {
      L.init = false;
      return;
    }
    const c = this.camera.position;
    const pos = L.pts.geometry.attributes.position;
    const R = 14;
    for (let i = 0; i < L.N; i++) {
      let x = pos.getX(i);
      let y = pos.getY(i);
      let z = pos.getZ(i);
      if (!L.init || Math.abs(x - c.x) > R || Math.abs(z - c.z) > R) {
        // カメラのまわりの風上から出てくる
        x = c.x + (Math.random() - 0.5) * 2 * R;
        z = c.z + (Math.random() - 0.5) * 2 * R;
        y = 0.3 + Math.random() * 4;
      }
      x += wind.x * 1.6 * dt;
      z += wind.z * 1.6 * dt;
      y += Math.sin((x + z) * 0.7 + this.t * 4) * 0.4 * dt;
      pos.setXYZ(i, x, y, z);
    }
    L.init = true;
    pos.needsUpdate = true;
  }

  /** views: 番号ごとの { x, y, z, yaw, crouch, moving, dead, inv, stuck, stun, hide } */
  updateDogs(views, dt) {
    views.forEach((v, i) => {
      const d = this.dogs[i];
      if (!d) return;
      d.root.visible = !!v && !v.hide;
      if (!d.root.visible) return;
      d.t += dt;
      d.root.position.set(v.x, v.y, v.z);
      d.root.rotation.y = v.yaw;
      const deadK = v.dead ? 1 : 0;
      // 伏せ: 低くつぶれる。倒れた: 横に倒れる
      const sy = v.crouch ? 0.62 : 1;
      d.body.scale.y += (sy - d.body.scale.y) * Math.min(1, dt * 14);
      d.body.rotation.z += (deadK * Math.PI * 0.5 - d.body.rotation.z) * Math.min(1, dt * 8);
      d.body.position.y = 0; // 歩くときの揺れは犬の形（dog3d.js）が動かす
      d.body.position.x = v.stun ? Math.sin(d.t * 50) * 0.05 : 0;
      d.gun.visible = !v.dead;
      d.gun.userData.set(v.weapon ?? WEAPON.NORMAL);
      d.ring.visible = !v.dead;
      d.blob.visible = !this.dynShadow; // 影が動くときは、丸い影はいらない
      if (d.flag) waveFlag(d.flag, d.t, v.moving ? 1 : 0.4);
      // 王冠はゆっくり回る。リベンジの印は上下に揺れる。吹き出しは少しの間だけ
      if (d.crown.visible) d.crown.rotation.y += dt * 1.5;
      if (d.mark.visible) d.mark.position.y = PLAYER.HEIGHT + 0.85 + Math.sin(d.t * 5) * 0.08;
      d.barkT = Math.max(0, d.barkT - dt);
      d.bubble.visible = d.barkT > 0 && !v.dead;
      if (d.bubble.visible) d.bubble.material.opacity = Math.min(1, d.barkT * 3);
      d.gum.visible = !!v.stuck;
      // 無敵の間は点滅（無敵スターは点滅しないで金色に光る）
      d.star.visible = !!v.star && !v.dead;
      if (d.star.visible) {
        d.star.material.opacity = 0.25 + Math.abs(Math.sin(d.t * 6)) * 0.25;
        d.star.scale.setScalar(v.crouch ? 0.75 : 1);
      }
      d.body.visible = !(v.inv && !v.star && Math.floor(d.t * 10) % 2 === 0);
      d.dog.animate({ dt, moving: !!v.moving, crouch: !!v.crouch, pitch: v.pitch || 0, dead: !!v.dead, stun: !!v.stun });
      d.gun.rotation.x = -Math.max(-0.6, Math.min(0.6, v.pitch || 0)) * 0.8; // 鉄砲もねらう向きへ
    });
  }

  // ---- ボス戦の猫 ----
  _buildCat() {
    const root = new THREE.Group();
    const body = new THREE.Group(); // しゃがむ・倒れる・ゆれるのはここ
    const fur = toon(0xf4a259);
    const dark = toon(0xc9762f);
    const white = toon(0xfff7ec);
    const pink = toon(0xff8fab);
    const mats = [fur, dark, white];
    const add = (geo, mat, x, y, z, sx = 1, sy = 1, sz = 1, parent = body) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.scale.set(sx, sy, sz);
      m.castShadow = true;
      parent.add(m);
      return m;
    };
    const sph = new THREE.SphereGeometry(1, 20, 14);
    add(sph, fur, 0, 1.75, 0, 1.45, 1.2, 2.1);
    add(sph, white, 0, 1.45, 0.9, 1.05, 0.9, 1.1);
    for (const z of [-1, -0.3, 0.4]) add(new THREE.BoxGeometry(2.2, 0.18, 0.35), dark, 0, 2.75, z, 1, 1, 1).rotation.x = 0.1;
    const head = new THREE.Group();
    head.position.set(0, 2.95, 1.85);
    body.add(head);
    add(sph, fur, 0, 0, 0, 1.08, 0.98, 1, head);
    add(sph, white, 0, -0.3, 0.75, 0.55, 0.42, 0.4, head);
    for (const sx of [-1, 1]) {
      const ear = add(new THREE.ConeGeometry(0.42, 0.85, 4), fur, sx * 0.55, 0.95, -0.05, 1, 1, 0.6, head);
      ear.rotation.z = -sx * 0.25;
      const inner = add(new THREE.ConeGeometry(0.24, 0.5, 4), pink, sx * 0.55, 0.9, 0.08, 1, 1, 0.4, head);
      inner.rotation.z = -sx * 0.25;
      add(sph, toon(0x7bd88f), sx * 0.38, 0.12, 0.82, 0.2, 0.24, 0.1, head);
      add(new THREE.BoxGeometry(0.06, 0.32, 0.05), toon(0x111111), sx * 0.38, 0.12, 0.92, 1, 1, 1, head);
      for (const k of [-1, 0, 1]) {
        const wk = add(new THREE.BoxGeometry(0.9, 0.025, 0.025), white, sx * 0.75, -0.3 + k * 0.1, 0.8, 1, 1, 1, head);
        wk.rotation.z = sx * k * 0.12;
      }
    }
    add(sph, pink, 0, -0.12, 1.0, 0.12, 0.09, 0.08, head);
    // 足（前足は振り上げる）
    const legGeo = new THREE.CylinderGeometry(0.34, 0.3, 1.5, 10);
    const legs = [];
    for (const [x, z] of [[-0.8, 1.15], [0.8, 1.15], [-0.85, -1.2], [0.85, -1.2]]) {
      const pivot = new THREE.Group();
      pivot.position.set(x, 1.45, z);
      body.add(pivot);
      add(legGeo, fur, 0, -0.72, 0, 1, 1, 1, pivot);
      add(sph, white, 0, -1.45, 0.08, 0.38, 0.22, 0.45, pivot);
      legs.push(pivot);
    }
    // しっぽ（ゆらゆら）
    const tail = new THREE.Group();
    tail.position.set(0, 2.1, -2);
    body.add(tail);
    for (let k = 0; k < 5; k++) add(sph, k % 2 ? dark : fur, 0, k * 0.42, -k * 0.18, 0.28, 0.32, 0.28, tail);
    const blob = new THREE.Mesh(new THREE.CircleGeometry(2.4, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false }));
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.03;
    root.add(body, blob);
    root.visible = false;
    this.scene.add(root);
    this.cat = { root, body, head, legs, tail, blob, mats, t: 0, flash: 0, lx: 0, lz: 0 };
  }

  /** 猫に当たったとき、一瞬白く光る */
  bossFlash() {
    if (this.cat) this.cat.flash = 0.12;
  }

  /** v: { x, y, z, yaw, hp, st, t, fx }（いなければ null） */
  updateBoss(v, dt) {
    if (!v) {
      if (this.cat) this.cat.root.visible = false;
      return;
    }
    if (!this.cat) this._buildCat();
    const c = this.cat;
    c.root.visible = true;
    c.t += dt;
    const sp = Math.hypot(v.x - c.lx, v.z - c.lz) / Math.max(dt, 1e-3);
    c.lx = v.x;
    c.lz = v.z;
    c.root.position.set(v.x, v.y, v.z);
    c.root.rotation.y = v.yaw;
    c.blob.position.y = -v.y + 0.03;
    const st = v.st;
    const walk = st === 'walk' && sp > 0.4 ? Math.sin(c.t * 9) * 0.45 : 0;
    c.legs[0].rotation.x = walk;
    c.legs[3].rotation.x = walk;
    c.legs[1].rotation.x = -walk;
    c.legs[2].rotation.x = -walk;
    // ひっかき: 前ぶりで右の前足を上げ、振り下ろす
    if (st === 'wind') c.legs[1].rotation.x = -Math.min(1, v.t / BOSS.SWIPE_WIND) * 1.9;
    else if (st === 'rest') c.legs[1].rotation.x = 0.5;
    // とびかかり: しゃがんでから、足をのばして飛ぶ
    const crouch = st === 'crouch' ? Math.min(1, v.t / BOSS.POUNCE_WIND) : 0;
    c.body.scale.y = 1 - crouch * 0.18;
    if (st === 'pounce') for (const [k, l] of c.legs.entries()) l.rotation.x = k < 2 ? -0.9 : 0.9;
    // 倒れた: 横に倒れる
    const down = st === 'down' ? Math.min(1, v.t * 2) : 0;
    c.body.rotation.z = down * (Math.PI / 2);
    c.body.position.y = -down * 0.6;
    // ふらふら・しっぽ
    c.head.rotation.z = v.fx > 0 && st !== 'down' ? Math.sin(c.t * 10) * 0.25 : 0;
    c.tail.rotation.x = Math.sin(c.t * 2.2) * 0.3 - 0.2;
    c.tail.rotation.z = Math.sin(c.t * 1.7) * 0.4;
    c.flash = Math.max(0, c.flash - dt);
    const e = c.flash > 0 ? 0.55 : 0;
    for (const m of c.mats) m.emissive?.setScalar(e);
  }

  // ---- 輪ゴム ----
  /** list: { x, y, z, vx, vy, vz, kind, spin } */
  updateBands(list, dt) {
    while (this.bands.length < list.length) {
      const m = new THREE.Mesh(new THREE.TorusGeometry(1, 0.22, 6, 16), toon(BAND_COLORS[0]));
      // 猫の毛玉（ふわふわの玉）
      const hair = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), toon(0xc9a27e));
      hair.visible = false;
      // 爆弾（黒い玉と導火線）
      const bomb = makeBomb();
      bomb.visible = false;
      // 輪ゴムの軌跡（うしろに短い線）
      const tg = new THREE.BufferGeometry();
      tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const trail = new THREE.Line(tg, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false }));
      trail.frustumCulled = false;
      this.scene.add(m, hair, bomb, trail);
      m.userData.hair = hair;
      m.userData.bomb = bomb;
      m.userData.trail = trail;
      this.bands.push(m);
    }
    this.bands.forEach((m, k) => {
      const b = list[k];
      const hair = m.userData.hair;
      const bomb = m.userData.bomb;
      const isHair = !!b && b.kind === HAIRBALL;
      const isBomb = !!b && b.w === WEAPON.BOMB;
      const trail = m.userData.trail;
      // 跳ねたら火花（跳ねた回数が増えたとき）
      if (b && !isHair) {
        const nb = b.bounced || 0;
        if (nb > (this._bounceSeen.get(b) ?? nb)) this.sparks(b.x, b.y, b.z, 7);
        this._bounceSeen.set(b, nb);
      }
      trail.visible = !!b && !isHair && !isBomb;
      if (trail.visible) {
        const tp = trail.geometry.attributes.position;
        const k2 = 0.05; // 0.05 秒ぶん後ろまで
        tp.setXYZ(0, b.x, b.y, b.z);
        tp.setXYZ(1, b.x - b.vx * k2, b.y - b.vy * k2, b.z - b.vz * k2);
        tp.needsUpdate = true;
        trail.material.color.setHex(BAND_COLORS[b.kind] ?? BAND_COLORS[0]);
      }
      hair.visible = isHair;
      bomb.visible = isBomb;
      m.visible = !!b && !isHair && !isBomb;
      if (isBomb) {
        bomb.position.set(b.x, b.y, b.z);
        bomb.scale.setScalar(b.kind === ITEM.THICK ? 1.3 : 1);
        bomb.rotation.set(b.age * 7, b.age * 3, 0);
        bomb.userData.spark.material.color.setHex((b.age * 12) % 2 < 1 ? 0xffd23f : 0xff6b35);
        return;
      }
      if (isHair) {
        hair.position.set(b.x, b.y, b.z);
        hair.scale.setScalar(BOSS.SPIT_RADIUS * 1.2);
        hair.rotation.set(b.age * 6, b.age * 4, 0);
        return;
      }
      if (!b) return;
      const big = b.kind === ITEM.THICK;
      const r = big ? ITEMS.THICK_RADIUS : 0.13;
      m.scale.set(r, r, r * (big ? 1.4 : 1));
      m.material.color.setHex(BAND_COLORS[b.kind] ?? BAND_COLORS[0]);
      m.position.set(b.x, b.y, b.z);
      m.lookAt(b.x + b.vx, b.y + b.vy, b.z + b.vz);
      m.rotateX(Math.PI / 2);
      m.rotateY((b.age || 0) * 18);
    });
    void dt;
  }

  // ---- 煙・ガム ----
  addSmoke(id, x, y, z) {
    if (this.smokes.has(id)) return;
    const g = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color: 0xf1f1f1, transparent: true, opacity: 0.92, depthWrite: false });
    for (let i = 0; i < 9; i++) {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), mat);
      const a = i * 2.4;
      m.position.set(Math.cos(a) * 1.2, (i % 3) * 0.6 - 0.4, Math.sin(a) * 1.2);
      m.scale.setScalar(1.3 + (i % 4) * 0.25);
      g.add(m);
    }
    g.position.set(x, y, z);
    g.scale.setScalar(0.1);
    g.userData = { age: 0, mat };
    this.scene.add(g);
    this.smokes.set(id, g);
  }

  removeSmoke(id) {
    const g = this.smokes.get(id);
    if (!g) return;
    this.scene.remove(g);
    g.traverse((o) => o.geometry?.dispose());
    g.userData.mat.dispose();
    this.smokes.delete(id);
  }

  /** 点 (x, y, z) が煙の中か（中にいると、画面が白くなる） */
  inSmoke(x, y, z) {
    for (const g of this.smokes.values()) if (g.position.distanceTo(new THREE.Vector3(x, y, z)) < ITEMS.SMOKE_RADIUS * g.scale.x * 0.9) return true;
    return false;
  }

  addGum(id, x, y, z) {
    if (this.gums.has(id)) return;
    const g = new THREE.Mesh(new THREE.SphereGeometry(ITEMS.GUM_RADIUS, 16, 8), toon(0xff7eb6));
    g.scale.y = 0.12;
    g.position.set(x, y + 0.03, z);
    this.scene.add(g);
    this.gums.set(id, g);
  }

  removeGum(id) {
    const g = this.gums.get(id);
    if (!g) return;
    this.scene.remove(g);
    g.geometry.dispose();
    g.material.dispose();
    this.gums.delete(id);
  }

  _stepSmokes(dt) {
    for (const [id, g] of this.smokes) {
      const u = g.userData;
      u.age += dt;
      const grow = Math.min(1, u.age / 0.5);
      g.scale.setScalar(Math.max(0.1, grow * (ITEMS.SMOKE_RADIUS / 2.4)));
      const left = ITEMS.SMOKE_TIME - u.age;
      u.mat.opacity = 0.92 * Math.max(0, Math.min(1, left / 1));
      g.rotation.y += dt * 0.3;
      if (left <= 0) this.removeSmoke(id);
    }
  }

  // ---- ちょっとした演出（粒） ----
  burst(x, y, z, color, n = 10, speed = 3, size = 0.06) {
    // まとめて描く粒で（1 つずつ Mesh を作らない）
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const u = Math.random() * 2 - 1;
      const sp = speed * (0.4 + Math.random() * 0.6);
      this.pfx.spawn({ x, y, z, vx: Math.cos(a) * Math.sqrt(1 - u * u) * sp, vy: Math.abs(u) * sp + 1, vz: Math.sin(a) * Math.sqrt(1 - u * u) * sp, g: 9, life: 0.5 + Math.random() * 0.3, size: size * 2.6 * (0.6 + Math.random() * 0.8), color });
    }
  }

  // ---- エフェクト 15 種（2026-11-13） ----
  /** 1. 走ったときの土ぼこり */
  dust(x, y, z, n = 2) {
    const c = this.arena?.ground === 'sand' ? 0xe9d6a8 : this.arena?.ground === 'dirt' ? 0xb59a74 : 0xb8a888;
    for (let i = 0; i < n; i++) this.pfx.spawn({ x: x + (Math.random() - 0.5) * 0.4, y: y + 0.08, z: z + (Math.random() - 0.5) * 0.4, vx: (Math.random() - 0.5) * 0.6, vy: 0.35 + Math.random() * 0.3, vz: (Math.random() - 0.5) * 0.6, drag: 2.5, life: 0.7, size: 0.32, grow: 2.2, color: c, a0: this._snowCover?.v > 0.3 ? 0.3 : 0.55 });
  }

  /** 2. 着地したときの土煙の輪 */
  landRing(x, y, z) {
    const c = this._snowCover?.v > 0.3 ? 0xffffff : 0xc8b898;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      this.pfx.spawn({ x, y: y + 0.06, z, vx: Math.cos(a) * 2.6, vy: 0.25, vz: Math.sin(a) * 2.6, drag: 4, life: 0.55, size: 0.28, grow: 1.6, color: c, a0: 0.6 });
    }
  }

  /** 3. 輪ゴムが跳ねたときの火花 */
  sparks(x, y, z, n = 8) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const u = Math.random() * 2 - 1;
      const sp = 2.5 + Math.random() * 3;
      this.gfx.spawn({ x, y, z, vx: Math.cos(a) * Math.sqrt(1 - u * u) * sp, vy: u * sp + 1.5, vz: Math.sin(a) * Math.sqrt(1 - u * u) * sp, g: 14, life: 0.25 + Math.random() * 0.15, size: 0.07, color: i % 2 ? 0xffe9a8 : 0xffffff });
    }
  }

  /** 4. 輪ゴムの当たった跡（壁・地面に黒い輪。しばらくして消える） */
  impactMark(x, y, z, nx, ny, nz) {
    this.marks.add(x, y, z, nx, ny, nz, 0.26, 9, 0x222222);
  }

  /** 5. 倒したときの紙吹雪 */
  confetti(x, y, z) {
    const cols = [0xff4d6d, 0xffd23f, 0x3a86ff, 0x06d6a0, 0x8338ec, 0xfb5607];
    for (let i = 0; i < 46; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1.5 + Math.random() * 3;
      this.pfx.spawn({ x, y: y + 1, z, vx: Math.cos(a) * sp, vy: 3 + Math.random() * 3, vz: Math.sin(a) * sp, g: 6, drag: 1.4, life: 1.4 + Math.random() * 0.6, size: 0.09, color: cols[i % cols.length] });
    }
  }

  /** 6. 撃ったときの光（銃口のフラッシュ） */
  muzzle(x, y, z) {
    this.gfx.spawn({ x, y, z, life: 0.08, size: 0.6, color: 0xfff1b0, grow: 0.5 });
    for (let i = 0; i < 3; i++) this.gfx.spawn({ x, y, z, vx: (Math.random() - 0.5) * 3, vy: Math.random() * 2, vz: (Math.random() - 0.5) * 3, life: 0.15, size: 0.06, color: 0xffd27a });
  }

  /** 7. 回復したときの緑のきらめき（下から上へ） */
  healFx(x, y, z) {
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.3 + Math.random() * 0.25;
      this.gfx.spawn({ x: x + Math.cos(a) * r, y: y + Math.random() * 0.6, z: z + Math.sin(a) * r, vy: 1 + Math.random() * 0.8, life: 0.9 + Math.random() * 0.4, size: 0.1, color: i % 3 ? 0x7dff9a : 0xe8ffe8 });
    }
  }

  /** 9. 爆発の衝撃波（地面を広がる輪） */
  shockwave(x, y, z, r) {
    this._ring(x, y + 0.08, z, 0xffb35c, r * 1.6, 0.5, 0.75);
  }

  /** 10. 復活したときの光の柱 */
  beam(x, y, z, color = 0xfff3c4) {
    let b = this._beams?.find((q) => !q.m.visible);
    if (!b) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.7, 7, 16, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
      this.scene.add(m);
      b = { m };
      (this._beams ||= []).push(b);
    }
    b.m.visible = true;
    b.m.material.color.setHex(color);
    b.m.position.set(x, y + 3.5, z);
    b.age = 0;
    for (let i = 0; i < 10; i++) this.gfx.spawn({ x: x + (Math.random() - 0.5) * 0.8, y: y + Math.random() * 0.5, z: z + (Math.random() - 0.5) * 0.8, vy: 2 + Math.random() * 2, life: 0.8, size: 0.09, color });
  }

  /** 11. アイテムを拾ったときの金色のきらめき */
  pickupFx(x, y, z) {
    for (let i = 0; i < 20; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1.5 + Math.random() * 2;
      this.gfx.spawn({ x, y: y + 0.6, z, vx: Math.cos(a) * sp, vy: 1.5 + Math.random() * 2.5, vz: Math.sin(a) * sp, g: 4, drag: 1, life: 0.7 + Math.random() * 0.3, size: 0.1, color: i % 2 ? 0xffd23f : 0xffffff });
    }
    this._ring(x, y + 0.05, z, 0xffd23f, 2.2, 0.4, 0.6);
  }

  /** 12. 雪の上の足あと（積もっているときだけ） */
  footprint(x, z, yaw, side) {
    if (!(this._snowCover?.v > 0.25) || !this.arena) return;
    const ox = Math.cos(yaw) * 0.12 * side;
    const oz = -Math.sin(yaw) * 0.12 * side;
    const px = x + ox;
    const pz = z + oz;
    this.paws.add(px, groundY(this.arena, px, pz) + 0.02, pz, 0, 1, 0, 0.2, 14, 0xffffff, yaw + Math.PI);
  }

  /** 13. 寒いときの白い息 */
  breath(x, y, z, yaw) {
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    for (let i = 0; i < 3; i++) this.pfx.spawn({ x: x + fx * 0.35, y, z: z + fz * 0.35, vx: fx * 0.6 + (Math.random() - 0.5) * 0.2, vy: 0.15, vz: fz * 0.6 + (Math.random() - 0.5) * 0.2, drag: 1.5, life: 0.9, size: 0.1, grow: 2.5, color: 0xffffff, a0: 0.45 });
  }

  /** 広がって消える輪（衝撃波・拾ったとき） */
  _ring(x, y, z, color, R, life, op) {
    let q = this._rings.find((r) => !r.m.visible);
    if (!q) {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
      m.rotation.x = -Math.PI / 2;
      this.scene.add(m);
      q = { m };
      this._rings.push(q);
    }
    q.m.visible = true;
    q.m.material.color.setHex(color);
    q.m.position.set(x, y, z);
    Object.assign(q, { age: 0, life, R, op });
  }

  /** 14. 夜のホタル（カメラのまわりに、ゆっくり光る点）と、輪・光の柱を動かす */
  _stepAmbient(dt) {
    this.pfx.step(dt, this.t);
    this.gfx.step(dt, this.t);
    this.marks.step(dt);
    this.paws.step(dt);
    for (const q of this._rings) {
      if (!q.m.visible) continue;
      q.age += dt;
      const k = Math.min(1, q.age / q.life);
      q.m.scale.setScalar(0.2 + q.R * (1 - (1 - k) ** 2));
      q.m.material.opacity = q.op * (1 - k);
      if (k >= 1) q.m.visible = false;
    }
    for (const b of this._beams || []) {
      if (!b.m.visible) continue;
      b.age += dt;
      b.m.material.opacity = 0.45 * Math.max(0, 1 - b.age / 0.9);
      b.m.scale.set(1 - b.age * 0.4, 1, 1 - b.age * 0.4);
      if (b.age > 0.9) b.m.visible = false;
    }
    if (this.night && !(this._wx > 0)) {
      this._ffT = (this._ffT || 0) - dt;
      if (this._ffT <= 0) {
        this._ffT = 0.12;
        const c = this.camera.position;
        const a = Math.random() * Math.PI * 2;
        const r = 3 + Math.random() * 14;
        const x = c.x + Math.cos(a) * r;
        const z = c.z + Math.sin(a) * r;
        const gy = this.arena ? groundY(this.arena, x, z) : 0;
        this.gfx.spawn({ x, y: gy + 0.4 + Math.random() * 1.6, z, vx: (Math.random() - 0.5) * 0.5, vy: (Math.random() - 0.5) * 0.2, vz: (Math.random() - 0.5) * 0.5, life: 4 + Math.random() * 2, size: 0.07, color: 0xd9ff6a, blink: 3 + Math.random() * 3 });
      }
    }
  }

  /** 爆発: ふくらんで消える光の玉と、火の粉・煙 */
  explode(x, y, z, r) {
    const m = new THREE.Mesh(this._flashGeo ||= new THREE.SphereGeometry(1, 20, 14), new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.85, depthWrite: false }));
    m.position.set(x, y, z);
    m.scale.setScalar(0.3);
    m.userData = { flash: true, r, life: 0.42, age: 0 };
    this.scene.add(m);
    this.fxList.push(m);
    this.burst(x, y + 0.2, z, 0xff6b35, 22, 7, 0.14);
    this.burst(x, y + 0.2, z, 0xffd23f, 14, 5, 0.1);
    this.burst(x, y + 0.3, z, 0x8d8d8d, 10, 2.5, 0.22);
    this.shockwave(x, this.arena ? groundY(this.arena, x, z) : 0, z, r);
  }

  /** 爆弾の飛ぶ道（点の列 [[x, y, z], ...]。null で隠す）と、落ちる所の輪 */
  setLobArc(points) {
    if (!this._arc) {
      const N = 64;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
      const line = new THREE.Line(g, new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.35, gapSize: 0.25, transparent: true, opacity: 0.85, depthTest: false }));
      line.renderOrder = 900;
      line.frustumCulled = false;
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.95, 28), new THREE.MeshBasicMaterial({ color: 0xff6b35, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2;
      this.scene.add(line, ring);
      this._arc = { line, ring, N };
    }
    const a = this._arc;
    const on = !!points && points.length > 1;
    a.line.visible = on;
    a.ring.visible = on;
    if (!on) return;
    const pos = a.line.geometry.attributes.position;
    const n = Math.min(points.length, a.N);
    for (let i = 0; i < n; i++) pos.setXYZ(i, points[i][0], points[i][1], points[i][2]);
    pos.needsUpdate = true;
    a.line.geometry.setDrawRange(0, n);
    a.line.computeLineDistances();
    const e = points[n - 1];
    a.ring.position.set(e[0], e[1] + 0.04, e[2]);
    // 目の前の壁に当たるとき（落ちる所がすぐそば）は輪を出さない（画面いっぱいに広がってしまう）
    a.ring.visible = Math.hypot(e[0] - points[0][0], e[2] - points[0][2]) > 2.5;
  }

  _stepFx(dt) {
    for (let i = this.fxList.length - 1; i >= 0; i--) {
      const m = this.fxList[i];
      const u = m.userData;
      u.age += dt;
      if (u.flash) {
        const k = Math.min(1, u.age / u.life);
        m.scale.setScalar(0.3 + (u.r - 0.3) * (1 - (1 - k) ** 3));
        m.material.opacity = 0.85 * (1 - k);
        if (k >= 1) {
          this.scene.remove(m);
          m.material.dispose();
          this.fxList.splice(i, 1);
        }
        continue;
      }
      u.vy -= 9 * dt;
      m.position.x += u.vx * dt;
      m.position.y = Math.max(0.02, m.position.y + u.vy * dt);
      m.position.z += u.vz * dt;
      m.material.opacity = Math.max(0, 1 - u.age / u.life);
      if (u.age >= u.life) {
        this.scene.remove(m);
        m.material.dispose();
        this.fxList.splice(i, 1);
      }
    }
  }

  // ---- 自分の鉄砲（画面の右下） ----
  _buildViewModel() {
    const vm = new THREE.Group();
    // 自分の武器（ほかの犬が持っているのと同じ形）
    const gun = weaponRack();
    gun.scale.setScalar(0.4);
    gun.rotation.y = Math.PI; // カメラの前（-z）を向く
    const paw = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), toon(0xf2a04b));
    paw.position.set(0, -0.05, 0.03);
    // 爆弾を持っているとき（鉄砲の代わり）
    const bm = makeBomb();
    bm.scale.setScalar(0.15);
    bm.position.set(-0.02, 0.0, -0.1);
    bm.visible = false;
    vm.add(gun, paw, bm);
    vm.position.set(0.2, -0.19, -0.36);
    vm.traverse((o) => {
      if (o.material) {
        o.material = o.material.clone();
        o.material.depthTest = false; // 壁に近づいても鉄砲が壁にめりこんで見えないように、いちばん手前に描く
      }
      o.renderOrder = 1000;
    });
    this.camera.add(vm);
    this.vm = { root: vm, gun, paw, bm, recoil: 0, bob: 0 };
  }

  /** 自分の鉄砲の見た目: 撃った反動・補充中は下げる・輪ゴムの色・歩きの揺れ */
  setViewModel({ fired = false, reloading = false, kind = 0, moving = false, visible = true, weapon = WEAPON.NORMAL, bomb = false, furColor = null }, dt) {
    const v = this.vm;
    v.root.visible = visible;
    v.gun.userData.set(weapon);
    v.gun.visible = !bomb;
    // 長い武器は小さめに、少し前へ（画面をふさがないように）
    const fit = VM_FIT[weapon] || VM_FIT[WEAPON.NORMAL];
    v.gun.scale.setScalar(fit.s);
    v.gun.position.set(fit.x, fit.y, fit.z);
    v.bm.visible = bomb; // 爆弾は補充中でもかまえられる
    if (fired) v.recoil = 1;
    v.recoil = Math.max(0, v.recoil - dt * 8);
    v.bob += dt * (moving ? 10 : 2);
    const rl = reloading && !bomb; // 爆弾をかまえている間は下げない
    const down = rl ? 0.12 : 0;
    v.root.position.set(0.2 + Math.sin(v.bob) * (moving ? 0.008 : 0.002), -0.19 - down - Math.abs(Math.cos(v.bob)) * (moving ? 0.01 : 0.003), -0.36 + v.recoil * 0.05);
    v.root.rotation.x = v.recoil * 0.25 + (rl ? -0.5 : 0);
    const band = v.gun.userData.band();
    band.visible = !reloading;
    band.material.color.setHex(BAND_COLORS[kind] ?? BAND_COLORS[0]);
    if (furColor != null) v.paw.material.color.setHex(furColor);
  }

  setCamera(x, y, z, yaw, pitch) {
    this.camera.position.set(x, y, z);
    this.camera.rotation.y = yaw + Math.PI;
    this.camera.rotation.x = pitch;
  }

  /** 3D の点を画面の座標へ（名前の表示用）。後ろなら null */
  project(x, y, z) {
    const v = (this._pv ||= new THREE.Vector3()).set(x, y, z).project(this.camera);
    if (v.z > 1 || v.z < -1) return null;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    return { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h };
  }

  render(dt) {
    this._stepSmokes(dt);
    this._stepFx(dt);
    this._stepWeather(dt);
    this._stepLamps(dt);
    this._stepAmbient(dt);
    // 動く影（パソコン）: 2 フレームに 1 回だけ描き直す
    if (this.dynShadow && (this._sf = ((this._sf || 0) + 1) % 2) === 0) this.renderer.shadowMap.needsUpdate = true;
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this._ro.disconnect();
    this.scene.traverse((o) => {
      o.geometry?.dispose?.();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose?.());
    });
    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
    this.renderer.domElement.remove();
  }
}

export { PLAYER };
