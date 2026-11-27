// 崖の上の一本道と、なっっっがいトラックの 3D 表示（見せるだけ。動きの計算は truck.js）。
// 道は 40 m ずつのかたまりで、先に作って後ろは捨てる。まわりは霧と、遠くの山の影だけ（ほかには何もない）。

import * as THREE from 'three';
import { device } from '../../core/device.js';
import { ROAD } from './road.js';
import { TRUCK, MID } from './truck.js';

const FOG = 0xcfd9e2;
const CHUNK = 40; // 道のかたまりの長さ（点の数）
const AHEAD = 760; // この先まで作っておく（m）
const BEHIND = 160; // これより後ろは捨てる（m）
const DROP = 340; // 崖の深さ（霧で見えなくなる）

/** 2 つの角度のちがい（-π〜π） */
const angDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

/** ざらざらした絵（道・岩）。fn(ctx, w, h) で描く */
function canvasTex(w, h, fn, repeat = true, sc = 2) {
  // 描くのは w × h のつもりで、実際は sc 倍の細かさの絵にする（近くで見てもガビガビにならないように）
  const cv = document.createElement('canvas');
  cv.width = w * sc;
  cv.height = h * sc;
  const x = cv.getContext('2d');
  x.scale(sc, sc);
  fn(x, w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

function speckle(x, w, h, n, colors, size = 2) {
  for (let k = 0; k < n; k++) {
    x.fillStyle = colors[(Math.random() * colors.length) | 0];
    x.globalAlpha = 0.25 + Math.random() * 0.45;
    const s = size * (0.5 + Math.random());
    x.fillRect(Math.random() * w, Math.random() * h, s, s);
  }
  x.globalAlpha = 1;
}

/** 道: アスファルト、両はしの白線、真ん中の破線（12 m で 1 回くり返す） */
function roadTex() {
  return canvasTex(256, 512, (x, w, h) => {
    x.fillStyle = '#5d6166';
    x.fillRect(0, 0, w, h);
    speckle(x, w, h, 30000, ['#4c5055', '#6b6f74', '#55595e', '#74787c'], 1.2);
    // ひび
    x.strokeStyle = 'rgba(40,42,46,0.55)';
    x.lineWidth = 1;
    for (let k = 0; k < 7; k++) {
      x.beginPath();
      let px = Math.random() * w;
      let py = Math.random() * h;
      x.moveTo(px, py);
      for (let j = 0; j < 6; j++) {
        px += (Math.random() - 0.5) * 30;
        py += Math.random() * 26;
        x.lineTo(px, py);
      }
      x.stroke();
    }
    x.fillStyle = '#eef0f0';
    x.fillRect(w * 0.035, 0, w * 0.022, h);
    x.fillRect(w * 0.943, 0, w * 0.022, h);
    x.fillStyle = '#e9ebe9';
    x.fillRect(w * 0.492, 0, w * 0.016, h * 0.35);
  });
}

/** 岩の壁: 灰色にこけの緑、たてのすじ */
function rockTex() {
  return canvasTex(256, 256, (x, w, h) => {
    x.fillStyle = '#a3a299';
    x.fillRect(0, 0, w, h);
    for (let k = 0; k < 160; k++) {
      x.fillStyle = ['#908f86', '#b2b0a5', '#979b8d', '#8a8f81', '#bcb9ab'][(Math.random() * 5) | 0];
      x.globalAlpha = 0.5;
      const cw = 6 + Math.random() * 22;
      x.fillRect(Math.random() * w, Math.random() * h, cw, cw * (1.5 + Math.random() * 3));
    }
    x.globalAlpha = 1;
    for (let k = 0; k < 40; k++) {
      x.fillStyle = Math.random() < 0.5 ? 'rgba(112,142,86,0.45)' : 'rgba(140,160,104,0.35)';
      x.beginPath();
      x.ellipse(Math.random() * w, Math.random() * h, 4 + Math.random() * 14, 3 + Math.random() * 8, 0, 0, Math.PI * 2);
      x.fill();
    }
    speckle(x, w, h, 14000, ['#7b7a70', '#c0beb0', '#8f9a80'], 1.2);
  });
}

/** 道の肩（岩と土） */
function shoulderTex() {
  return canvasTex(64, 256, (x, w, h) => {
    x.fillStyle = '#8f8366';
    x.fillRect(0, 0, w, h);
    speckle(x, w, h, 7000, ['#7a6f55', '#a39674', '#6c7355', '#857b5e'], 2);
  });
}

/** 光がぼんやり広がった丸（ブレーキで地面を照らす） */
function glowTex() {
  const t = canvasTex(
    128,
    128,
    (x, w, h) => {
      const g = x.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g;
      x.fillRect(0, 0, w, h);
    },
    false,
  );
  return t;
}

/** 少しずつ変わるでこぼこ（-1〜1）。同じ場所なら同じ値 */
function bumpy(a, b) {
  return Math.sin(a * 0.31 + b * 1.7) * 0.5 + Math.sin(a * 0.093 + b * 0.53 + 1.3) * 0.35 + Math.sin(a * 0.71 + b * 2.9 + 4.1) * 0.15;
}

export class CliffWorld {
  constructor(container, road) {
    this.container = container;
    this.road = road;
    // 画質: 物が少ないので、スマホ・タブレットでも、ふちのなめらかさ（アンチエイリアス）と画面の細かさ（2 倍まで）を落とさない
    const r = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.domElement.className = 'game-canvas ct-canvas';
    container.append(r.domElement);
    this.renderer = r;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(FOG);
    scene.fog = new THREE.Fog(FOG, 40, 620);
    this.scene = scene;
    this.camera = new THREE.PerspectiveCamera(52, 1, 0.5, 4000);
    scene.add(this.camera);
    // 曇りの空の光と、やわらかい日の光（トラックの影が道に落ちる）
    scene.add(new THREE.HemisphereLight(0xeef3fa, 0x9aa3a8, 1.45));
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.castShadow = true;
    const sr = 26;
    Object.assign(sun.shadow.camera, { left: -sr, right: sr, top: sr, bottom: -sr, near: 1, far: 120 });
    const ms = device.low ? 2048 : 4096;
    sun.shadow.mapSize.set(ms, ms);
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.04;
    scene.add(sun, sun.target);
    this.sun = sun;
    this.aniso = r.capabilities.getMaxAnisotropy?.() || 8; // ななめから見る道・崖の模様をくっきり
    this.mats = {
      road: new THREE.MeshLambertMaterial({ map: roadTex() }),
      rock: new THREE.MeshLambertMaterial({ map: rockTex(), vertexColors: true, side: THREE.DoubleSide }),
      shoulder: new THREE.MeshLambertMaterial({ map: shoulderTex(), side: THREE.DoubleSide }),
    };
    for (const m of Object.values(this.mats)) m.map.anisotropy = this.aniso;
    this.chunks = new Map();
    this._mountains();
    this._truck();
    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(container);
    this.resize();
    this.camPos = null;
    this.camYaw = 0;
  }

  resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // 縦長の画面では、横が見えるように少し広く
    this.camera.fov = w < h ? 68 : 52;
    this.camera.updateProjectionMatrix();
  }

  // ---- 遠くの山（霧の向こうの影。いつもカメラのまわりにある） ----
  _mountains() {
    const g = new THREE.Group();
    const layers = [
      { r: 2400, top: 260, col: new THREE.Color(0x9fadb9), seed: 1 },
      { r: 1900, top: 170, col: new THREE.Color(0xb3c0ca), seed: 2 },
    ];
    for (const L of layers) {
      const N = 160;
      const pos = [];
      const col = [];
      const idx = [];
      const fog = new THREE.Color(FOG);
      for (let k = 0; k <= N; k++) {
        const a = (k / N) * Math.PI * 2;
        const hh = L.top * (0.35 + 0.65 * Math.max(0, 0.5 + 0.5 * bumpy(k * 0.9 + L.seed * 10, L.seed)) ** 1.4);
        const x = Math.sin(a) * L.r;
        const z = Math.cos(a) * L.r;
        pos.push(x, -80, z, x, hh, z);
        col.push(fog.r, fog.g, fog.b, L.col.r, L.col.g, L.col.b);
        if (k < N) {
          const i = k * 2;
          idx.push(i, i + 2, i + 1, i + 1, i + 2, i + 3);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      geo.setIndex(idx);
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide, depthWrite: false }));
      m.renderOrder = -1;
      g.add(m);
    }
    this.scene.add(g);
    this.mountains = g;
  }

  // ---- 道と崖 ----
  /** k 番目のかたまり（点 k*CHUNK 〜 (k+1)*CHUNK）を作る */
  _buildChunk(k) {
    const road = this.road;
    const i0 = k * CHUNK;
    const i1 = i0 + CHUNK;
    road.ensure(i1 + 1);
    const g = new THREE.Group();
    // 道の面・肩・崖の壁を、点ごとの横の切り口から作る
    const roadPos = [];
    const roadUv = [];
    const shPos = [];
    const shUv = [];
    const wallPos = [];
    const wallUv = [];
    const wallCol = [];
    // 崖の壁の高さの段（上から）。下へ行くほど少し外へ広がり、でこぼこ
    const levels = [0, -1.2, -5, -14, -32, -70, -140, -DROP];
    const out = [0.0, 0.1, 0.3, 0.7, 1.3, 2.2, 3.4, 5];
    for (let i = i0; i <= i1; i++) {
      const x = road.x[i];
      const z = road.z[i];
      const h = road.h[i];
      const rx = -Math.cos(h);
      const rz = Math.sin(h);
      const hw = road.w[i] / 2;
      const v = (i * ROAD.STEP) / 12;
      // 道（左 → 右）
      roadPos.push(x - rx * hw, 0.02, z - rz * hw, x + rx * hw, 0.02, z + rz * hw);
      roadUv.push(0, v, 1, v);
      // 肩と崖（左右）
      for (const side of [-1, 1]) {
        const sh = 0.55 + 0.25 * bumpy(i * 0.7, side * 3); // 肩の幅
        const e = hw + sh;
        shPos.push(x + rx * side * hw, 0.01, z + rz * side * hw, x + rx * side * e, 0.0, z + rz * side * e);
        shUv.push(0, v * 3, 1, v * 3);
        for (let L = 0; L < levels.length; L++) {
          const o = e + out[L] + (L > 0 ? (0.35 + 0.12 * L) * (0.5 + 0.5 * bumpy(i * 0.45 + L * 7, side + L)) : 0);
          wallPos.push(x + rx * side * o, levels[L], z + rz * side * o);
          wallUv.push(i * 0.08, levels[L] / 9);
          // 絵の色に、場所ごとの明るさの差だけかける（1 に近い値。かけすぎると暗くなる）
          const k = 0.8 + 0.3 * (0.5 + 0.5 * bumpy(i * 0.2 + L, side * 5));
          wallCol.push(k, k, k * 0.97);
        }
      }
    }
    const n = i1 - i0;
    const strip = (pos, uv, cols, mat, perRow, rows, flip) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      if (cols) geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
      const idx = [];
      for (const r of rows) {
        for (let j = 0; j < n; j++) {
          const a = j * perRow + r.a;
          const b = j * perRow + r.b;
          const c = (j + 1) * perRow + r.a;
          const d = (j + 1) * perRow + r.b;
          if (r.flip ?? flip) idx.push(a, b, c, b, d, c);
          else idx.push(a, c, b, b, c, d);
        }
      }
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, mat);
      return m;
    };
    const rd = strip(roadPos, roadUv, null, this.mats.road, 2, [{ a: 0, b: 1 }], true);
    rd.receiveShadow = true;
    const shRows = [
      { a: 0, b: 1, flip: true },
      { a: 2, b: 3, flip: false },
    ];
    const sh = strip(shPos, shUv, null, this.mats.shoulder, 4, shRows, false);
    sh.receiveShadow = true;
    const NL = levels.length;
    const wRows = [];
    for (let L = 0; L < NL - 1; L++) {
      wRows.push({ a: L, b: L + 1, flip: true }); // 左の壁（外向き）
      wRows.push({ a: NL + L, b: NL + L + 1, flip: false }); // 右の壁
    }
    const wall = strip(wallPos, wallUv, wallCol, this.mats.rock, NL * 2, wRows, false);
    g.add(rd, sh, wall);
    this.scene.add(g);
    return g;
  }

  /** 道のかたまりを、s（点の番号）のまわりだけそろえる */
  updateRoad(i) {
    const k0 = Math.max(0, Math.floor((i - BEHIND) / CHUNK));
    const k1 = Math.floor((i + AHEAD) / CHUNK);
    for (let k = k0; k <= k1; k++) if (!this.chunks.has(k)) this.chunks.set(k, this._buildChunk(k));
    for (const [k, g] of this.chunks) {
      if (k >= k0 && k <= k1) continue;
      this.scene.remove(g);
      g.traverse((o) => o.geometry?.dispose());
      this.chunks.delete(k);
    }
  }

  // ---- トラック ----
  /**
   * 1 本の車体のトラック（運転台と荷台は固定。動くのは前の車輪の向きだけ）。原点 = 後ろの車輪の真ん中・地面。+z が前。
   * ghost: ほかの人のトラック（その人の色の半透明。影・光なし）
   */
  _makeTruck(ghost = null) {
    const gm = ghost ? new THREE.MeshBasicMaterial({ color: ghost, transparent: true, opacity: 0.36, depthWrite: false }) : null;
    const lam = (c, o = {}) => gm || new THREE.MeshLambertMaterial({ color: c, ...o });
    const box = (w, h, l, mat, x, y, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), mat);
      m.position.set(x, y, z);
      m.castShadow = !ghost;
      return m;
    };
    const wheelGeo = (this._wheelGeo ||= new THREE.CylinderGeometry(0.52, 0.52, 0.42, 24).rotateZ(Math.PI / 2));
    const hubGeo = (this._hubGeo ||= new THREE.CylinderGeometry(0.22, 0.22, 0.44, 12).rotateZ(Math.PI / 2));
    const tire = lam(0x1c1d20);
    const hub = lam(0x9aa0a6);
    const wheel = (x, z, dual = false) => {
      const g = new THREE.Group();
      const t = new THREE.Mesh(wheelGeo, tire);
      t.castShadow = !ghost;
      g.add(t);
      if (dual) {
        const t2 = t.clone();
        t2.position.x = -Math.sign(x) * 0.45;
        g.add(t2);
      }
      g.add(new THREE.Mesh(hubGeo, hub));
      g.position.set(x, 0.52, z);
      return g;
    };
    const W = TRUCK.WIDTH;
    const TW = TRUCK.TRACK / 2 + 0.12;
    const front = TRUCK.L + TRUCK.FRONT; // 前のはし
    const back = -TRUCK.REAR; // 後ろのはし
    const cabZ = front - TRUCK.CAB / 2;
    const g = new THREE.Group();
    const red = lam(0xd8443a);
    const chassis = lam(0x33363b);
    // 運転台（前）
    g.add(box(W, 2.5, TRUCK.CAB, red, 0, 2.15, cabZ));
    g.add(box(W - 0.1, 0.8, TRUCK.CAB - 0.4, red, 0, 3.65, cabZ - 0.15));
    g.add(box(W - 0.3, 1.0, 0.06, lam(0x3a4a5a), 0, 2.75, front + 0.01)); // 前の窓
    g.add(box(W + 0.02, 0.35, 0.3, lam(0xc9ccd1), 0, 1.0, front - 0.1)); // バンパー
    for (const s of [-1, 1]) g.add(box(0.35, 0.2, 0.06, lam(0xfff6d8, { emissive: 0xfff2c0, emissiveIntensity: 0.4 }), s * (W / 2 - 0.35), 1.25, front + 0.02)); // 前の灯り
    // 荷台（運転台のすぐ後ろから、後ろのはしまで。つながっていて曲がらない）
    const boxFront = front - TRUCK.CAB - 0.2;
    const L = boxFront - back;
    const zc = back + L / 2;
    g.add(box(2.6, 3.4, L, lam(0xeef0f2), 0, 2.95, zc));
    g.add(box(2.5, 0.35, front - back - 0.4, chassis, 0, 1.0, (front + back) / 2)); // 下の枠（前から後ろまで 1 本）
    if (!ghost) {
      for (let k = 1; k < 11; k++) g.add(box(2.62, 0.05, 0.05, lam(0xd6d9dc), 0, 4.66, back + (L / 11) * k)); // 屋根のすじ
      g.add(box(2.5, 3.2, 0.05, lam(0xdfe2e5), 0, 2.95, back - 0.03)); // 後ろの扉
      g.add(box(0.04, 3.2, 0.06, lam(0xa9aeb4), 0, 2.95, back - 0.06));
      g.add(box(2.4, 0.25, 0.12, lam(0x30333a), 0, 0.85, back + 0.05)); // 後ろのバンパー
      g.add(box(0.5, 0.5, 1.4, lam(0xb0b5ba), W / 2 - 0.3, 1.0, cabZ - 2.2)); // 燃料タンク
      g.add(box(0.5, 0.5, 1.4, lam(0xb0b5ba), -W / 2 + 0.3, 1.0, cabZ - 2.2));
    }
    // 車輪: 後ろは 2 本（2 重）、前はハンドルで向きが変わる
    const fronts = [];
    for (const s of [-1, 1]) {
      g.add(wheel(s * TW, 0.7, true));
      g.add(wheel(s * TW, -0.7, true));
      const fw = wheel(s * TW, TRUCK.L);
      fronts.push(fw);
      g.add(fw);
    }
    const out = { fronts };
    if (!ghost) {
      // ブレーキのランプ（踏むと明るく光る）と、地面を照らす光
      out.lampMat = new THREE.MeshLambertMaterial({ color: 0x7a1010, emissive: 0xff2a1a, emissiveIntensity: 0.35 });
      for (const s of [-1, 1]) {
        const lp = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.25, 0.08), out.lampMat);
        lp.position.set(s * 0.95, 1.25, back - 0.08);
        g.add(lp);
      }
      const spot = new THREE.SpotLight(0xff2010, 0, 26, 0.75, 0.6, 1.2);
      spot.position.set(0, 1.3, back - 0.3);
      spot.target.position.set(0, -0.6, back - 9);
      g.add(spot, spot.target);
      out.spot = spot;
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(7, 9), new THREE.MeshBasicMaterial({ map: glowTex(), color: 0xff2a14, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      glow.rotation.x = -Math.PI / 2;
      glow.position.set(0, 0.05, back - 3.6);
      g.add(glow);
      out.glow = glow;
    } else {
      g.traverse((o) => {
        if (o.isMesh) o.renderOrder = 3;
      });
    }
    // 傾けるための入れ物（外 = 位置と向き、中 = 傾き）
    const outer = new THREE.Group();
    const tilt = new THREE.Group();
    tilt.add(g);
    outer.add(tilt);
    outer.rotation.order = 'YXZ';
    this.scene.add(outer);
    return Object.assign(out, { outer, tilt });
  }

  _truck() {
    this.truck = this._makeTruck();
    this.ghosts = new Map();
  }

  /** 傾ける（外側の車輪の所を軸に）。roll: 正 = 右（-x）が下。pitch: 前のめり（正 = 前が下） */
  _tilt(t, roll, pitch = 0) {
    const xp = roll >= 0 ? -TRUCK.WIDTH / 2 : TRUCK.WIDTH / 2; // 下がる側の車輪
    t.tilt.rotation.order = 'XZY';
    t.tilt.rotation.z = roll;
    t.tilt.rotation.x = pitch;
    t.tilt.position.set(xp - xp * Math.cos(roll), -xp * Math.sin(roll), 0);
  }

  /** 走っているトラックの置き場所（x, z = 後ろの車輪、th = 向き、roll、delta = 前の車輪の角度） */
  _place(o, x, y, z, th, roll, pitch, delta) {
    o.outer.position.set(x, y, z);
    o.outer.rotation.set(0, th, 0);
    this._tilt(o, roll, pitch);
    for (const fw of o.fronts) fw.rotation.y = delta;
  }

  setTruck(t) {
    this._place(this.truck, t.x, 0, t.z, t.th, t.roll, 0, t.delta || 0);
    this._brake(t.brake);
    this.truckView = { x: t.x, z: t.z, th: t.th };
  }

  /** 落ちていく・横だおしのトラック（体の真ん中 → 後ろの車輪へ戻して置く） */
  setWreck(w) {
    const b = w.bodies[0];
    this._place(this.truck, b.x - Math.sin(b.yaw) * MID, b.y, b.z - Math.cos(b.yaw) * MID, b.yaw, b.roll, b.pitch, 0);
    this._brake(0);
  }

  /** ほかの人のトラック（半透明・その人の色）。list: [{ key, color, x, y, z, th, roll, pitch, delta }] */
  setGhosts(list) {
    const seen = new Set();
    for (const g of list) {
      seen.add(g.key);
      let o = this.ghosts.get(g.key);
      if (!o) {
        o = this._makeTruck(g.color);
        this.ghosts.set(g.key, o);
      }
      o.outer.visible = true;
      this._place(o, g.x, g.y, g.z, g.th, g.roll, g.pitch, g.delta);
    }
    for (const [k, o] of this.ghosts) if (!seen.has(k)) o.outer.visible = false;
  }

  _brake(b) {
    const k = this._bk == null ? b : this._bk + (b - this._bk) * 0.35;
    this._bk = k;
    const T = this.truck;
    T.lampMat.emissiveIntensity = 0.35 + k * 3.2;
    T.spot.intensity = k * 60;
    T.glow.material.opacity = k * 0.55;
  }

  /** カメラ: 走っている間はトラックの後ろの高い所から、道の先を見る */
  chaseCamera(dt, snap = false) {
    const v = this.truckView;
    if (!v) return;
    // 向きはゆっくり追いかける（細かいハンドルで画面がゆれないように）
    this.camYaw = snap || this.camPos == null ? v.th : this.camYaw + angDiff(this.camYaw, v.th) * Math.min(1, dt * 2.2);
    const fx = Math.sin(this.camYaw);
    const fz = Math.cos(this.camYaw);
    const pos = new THREE.Vector3(v.x - fx * 30, 30, v.z - fz * 30);
    if (snap || !this.camPos) this.camPos = pos.clone();
    else this.camPos.lerp(pos, Math.min(1, dt * 6));
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(v.x + fx * 34, 0, v.z + fz * 34);
    this._follow = null;
  }

  /** カメラ: 落ちた・横転したら、トラックを追いかけて見る */
  followCamera(w, dt) {
    const b = w.bodies[0];
    const tx = b.x;
    const ty = b.y;
    const tz = b.z;
    if (!this._follow) {
      // はじめ: いまのカメラの場所から、落ちていく側の外へ回りこむ
      const dx = this.camera.position.x - tx;
      const dz = this.camera.position.z - tz;
      const l = Math.hypot(dx, dz) || 1;
      const rx = -Math.cos(b.yaw) * w.side;
      const rz = Math.sin(b.yaw) * w.side;
      this._follow = { ox: (dx / l) * 0.45 + rx, oz: (dz / l) * 0.45 + rz };
    }
    const F = this._follow;
    const ol = Math.hypot(F.ox, F.oz) || 1;
    const dist = 40;
    const want = new THREE.Vector3(tx + (F.ox / ol) * dist, Math.max(ty + 12, ty * 0.6 + 18), tz + (F.oz / ol) * dist);
    this.camPos.lerp(want, Math.min(1, dt * 1.6));
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(tx, ty, tz);
  }

  render() {
    const c = this.camera.position;
    this.mountains.position.set(c.x, 0, c.z);
    // 影はトラックのまわりだけ（日の光もいっしょに動かす）
    const o = this.truck.outer.position;
    const th = this.truckView?.th ?? 0;
    const cx = o.x + Math.sin(th) * MID;
    const cz = o.z + Math.cos(th) * MID;
    this.sun.position.set(cx + 18, 60, cz + 10);
    this.sun.target.position.set(cx, 0, cz);
    this.renderer.render(this.scene, this.camera);
  }

  destroy() {
    this._ro.disconnect();
    this.scene.traverse((o) => {
      o.geometry?.dispose?.();
      if (o.material) for (const m of [].concat(o.material)) {
        m.map?.dispose?.();
        m.dispose?.();
      }
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

