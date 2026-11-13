// 3D の見た目（会場・犬・輪ゴム・アイテムの箱・煙・ガム・手に持った鉄砲）。計算には関わらない
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { buildDog } from '../dogKart/dog.js';
import { device } from '../../core/device.js';
import { ROOM } from './arena.js';
import { ITEM, ITEMS, PLAYER, HAIRBALL, BOSS, WEAPON } from './constants.js';
import { mat as stdMat, kindMat, weaponRack, realisticDog } from './look.js';

/** 輪ゴムの色（種類ごと） */
export const BAND_COLORS = { 0: 0xf4a261, [ITEM.THICK]: 0xe63946, [ITEM.TRIPLE]: 0x2a9d8f, [ITEM.BOUNCE]: 0x3a86ff, [ITEM.HOMING]: 0x9b5de5 };

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
const DOG_SCALE = 0.75; // 犬の見た目の大きさ（当たり判定の高さ PLAYER.HEIGHT = 1.25 に合わせる）

// 材質: 光の当たり方が自然なもの（look.js）。名前は前のまま
const toon = (c, o = {}) => stdMat(c, o);

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
    scene.add(new THREE.HemisphereLight(0xdcecff, 0x8d7b5e, 1.15));
    scene.add(new THREE.AmbientLight(0xffffff, 0.12));
    const sun = new THREE.DirectionalLight(0xfff0d6, 2.7);
    sun.position.set(-34, 46, -26);
    sun.castShadow = true;
    const sr = Math.max(ROOM.W, ROOM.D) / 2 + 8; // 影を描く範囲（会場全体）
    Object.assign(sun.shadow.camera, { left: -sr, right: sr, top: sr, bottom: -sr, near: 1, far: 140 });
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
  }

  // ---- 会場 ----
  setArena(arena) {
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
    const G = new THREE.Group();
    this.arenaGroup = G;
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
    for (const b of arena.draw || arena.boxes) G.add(this._furniture(b)); // 見た目は元の箱（当たり判定は形に合わせた箱の組）
    for (const d of arena.decor || []) {
      const o = this._decor(d);
      if (o) G.add(o);
    }
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
    for (const g of [...this.itemBoxes, ...this.treats]) g.traverse((o) => (o.matrixAutoUpdate = true));
    this.renderer.shadowMap.needsUpdate = true;
    this.movMeshes = null; // 押せるものは新しい会場で作り直す
    // 前の会場の煙・ガム・輪ゴムは消す
    for (const id of [...this.smokes.keys()]) this.removeSmoke(id);
    for (const id of [...this.gums.keys()]) this.removeGum(id);
  }

  /** 屋外: 空・地面（柵の外まで続く）・まわりの柵・遠くの丘と雲 */
  _buildOutdoor(G, arena) {
    const W = ROOM.W;
    const D = ROOM.D;
    this.scene.background = new THREE.Color(arena.sky);
    this.scene.fog = new THREE.Fog(arena.sky, 90, 200);
    const tex = floorTexture(arena.ground, arena.floor);
    tex.repeat.set((W + 120) / 4, (D + 120) / 4);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(W + 120, D + 120), toon(0xffffff, { map: tex }));
    ground.rotation.x = -Math.PI / 2;
    ground.userData.noCast = true;
    G.add(ground);
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
      const dog = buildDog(kind);
      dog.group.scale.setScalar(DOG_SCALE);
      realisticDog(dog.group);
      // 持っている武器（輪ゴム鉄砲・スナイパー・ライフル。相手からも見える）
      const gun = weaponRack();
      gun.position.set(0.06, 0.62, 0.42);
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
      root.add(body, ring, blob, gum, star);
      if (this.dynShadow) body.traverse((o) => o.isMesh && (o.castShadow = true));
      this.scene.add(root);
      return { kind, root, body, dog, gun, ring, blob, gum, star, flag, t: i };
    });
  }

  /** 犬 i の足もとの輪と、背中の旗（あれば）の色を変える（チームがあとで決まったとき） */
  setDogColor(i, hex) {
    const d = this.dogs[i];
    if (!d) return;
    d.ring.material.color.setHex(hex);
    d.flag?.userData.cloth.material.color.setHex(hex);
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
      d.body.position.y = v.moving && !v.dead ? Math.abs(Math.sin(d.t * 12)) * 0.08 : 0;
      d.body.position.x = v.stun ? Math.sin(d.t * 50) * 0.05 : 0;
      d.gun.visible = !v.dead;
      d.gun.userData.set(v.weapon ?? WEAPON.NORMAL);
      d.ring.visible = !v.dead;
      d.blob.visible = !this.dynShadow; // 影が動くときは、丸い影はいらない
      if (d.flag) waveFlag(d.flag, d.t, v.moving ? 1 : 0.4);
      d.gum.visible = !!v.stuck;
      // 無敵の間は点滅（無敵スターは点滅しないで金色に光る）
      d.star.visible = !!v.star && !v.dead;
      if (d.star.visible) {
        d.star.material.opacity = 0.25 + Math.abs(Math.sin(d.t * 6)) * 0.25;
        d.star.scale.setScalar(v.crouch ? 0.75 : 1);
      }
      d.body.visible = !(v.inv && !v.star && Math.floor(d.t * 10) % 2 === 0);
      d.dog.animate({ dt, speed: v.moving ? 14 : 0, steer: 0, spin: v.stun ? 1 : 0, boost: 0, bump: v.stun ? 0.4 : 0, mood: v.dead ? -1 : 0 });
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
      this.scene.add(m, hair, bomb);
      m.userData.hair = hair;
      m.userData.bomb = bomb;
      this.bands.push(m);
    }
    this.bands.forEach((m, k) => {
      const b = list[k];
      const hair = m.userData.hair;
      const bomb = m.userData.bomb;
      const isHair = !!b && b.kind === HAIRBALL;
      const isBomb = !!b && b.w === WEAPON.BOMB;
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
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(this._fxGeo ||= new THREE.IcosahedronGeometry(1, 0), new THREE.MeshBasicMaterial({ color, transparent: true }));
      m.scale.setScalar(size * (0.6 + Math.random() * 0.8));
      m.position.set(x, y, z);
      const a = Math.random() * Math.PI * 2;
      const u = Math.random() * 2 - 1;
      const s = speed * (0.4 + Math.random() * 0.6);
      m.userData = { vx: Math.cos(a) * Math.sqrt(1 - u * u) * s, vy: Math.abs(u) * s + 1, vz: Math.sin(a) * Math.sqrt(1 - u * u) * s, life: 0.5 + Math.random() * 0.3, age: 0 };
      this.scene.add(m);
      this.fxList.push(m);
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
