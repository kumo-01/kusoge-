// 3D の見た目（会場・犬・輪ゴム・アイテムの箱・煙・ガム・手に持った鉄砲）。計算には関わらない
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { buildDog } from '../dogKart/dog.js';
import { device } from '../../core/device.js';
import { ROOM } from './arena.js';
import { ITEM, ITEMS, PLAYER } from './constants.js';

/** 輪ゴムの色（種類ごと） */
export const BAND_COLORS = { 0: 0xf4a261, [ITEM.THICK]: 0xe63946, [ITEM.TRIPLE]: 0x2a9d8f, [ITEM.BOUNCE]: 0x3a86ff, [ITEM.HOMING]: 0x9b5de5 };
const DOG_SCALE = 0.6;

const toon = (c, o = {}) => new THREE.MeshToonMaterial({ color: c, ...o });

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

/** 輪ゴム鉄砲（木の銃身・持ち手・先にかけた輪ゴム）。長さ約 0.6 */
export function makeGun(bandColor = BAND_COLORS[0]) {
  const g = new THREE.Group();
  const wood = toon(0xb07a45);
  const dark = toon(0x7a5230);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.62), wood);
  barrel.position.z = 0.2;
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.22, 0.1), dark);
  grip.position.set(0, -0.1, -0.06);
  grip.rotation.x = -0.35;
  const trig = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.07, 0.02), dark);
  trig.position.set(0, -0.06, 0.03);
  const hook = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.05), dark);
  hook.position.set(0, 0.05, -0.06);
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.012, 6, 14), toon(bandColor));
  band.scale.set(1, 1, 7);
  band.position.set(0, 0.045, 0.2);
  band.rotation.y = Math.PI / 2;
  g.add(barrel, grip, trig, hook, band);
  g.userData.band = band;
  return g;
}

export class GomuWorld {
  constructor(container) {
    this.container = container;
    const r = new THREE.WebGLRenderer({ antialias: !device.low, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, device.maxPixelRatio));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = !device.low;
    r.shadowMap.autoUpdate = false; // 家具の影は動かないので、会場を作ったときに 1 回だけ描く
    r.domElement.className = 'game-canvas gomu-canvas';
    container.append(r.domElement);
    this.renderer = r;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf6efe2);
    this.scene = scene;
    this.camera = new THREE.PerspectiveCamera(72, 1, 0.05, 150);
    this.camera.rotation.order = 'YXZ';
    scene.add(this.camera);
    scene.add(new THREE.HemisphereLight(0xfff8ee, 0xb59d86, 1.5));
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const sun = new THREE.DirectionalLight(0xfff1d8, 1.25);
    sun.position.set(-12, 30, -20);
    sun.castShadow = !device.low;
    sun.shadow.mapSize.set(1024, 1024);
    const sr = Math.max(ROOM.W, ROOM.D) / 2 + 6; // 影を描く範囲（部屋全体）
    Object.assign(sun.shadow.camera, { left: -sr, right: sr, top: sr, bottom: -sr, near: 1, far: 100 });
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0015;
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
    // 床・壁・天井
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), toon(0xffffff, { map: floorTexture(arena.floorK, arena.floor) }));
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
    // 家具
    for (const b of arena.boxes) G.add(this._furniture(b));
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
    this.scene.add(G);
    G.traverse((o) => {
      if (o.isMesh && o !== floor) o.castShadow = true;
      if (o.isMesh) o.receiveShadow = true;
    });
    // 動かないものの行列は 1 回だけ
    G.updateMatrixWorld(true);
    G.traverse((o) => {
      if (!this.itemBoxes.includes(o)) o.matrixAutoUpdate = false;
    });
    for (const g of this.itemBoxes) g.traverse((o) => (o.matrixAutoUpdate = true));
    this.renderer.shadowMap.needsUpdate = true;
    this.movMeshes = null; // 押せるものは新しい会場で作り直す
    // 前の会場の煙・ガム・輪ゴムは消す
    for (const id of [...this.smokes.keys()]) this.removeSmoke(id);
    for (const id of [...this.gums.keys()]) this.removeGum(id);
  }

  _furniture(b) {
    const w = b.x1 - b.x0;
    const d = b.z1 - b.z0;
    const h = b.y1 - b.y0;
    const cx = (b.x0 + b.x1) / 2;
    const cz = (b.z0 + b.z1) / 2;
    const cy = (b.y0 + b.y1) / 2;
    const mat = toon(b.c);
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
    } else if (['fabric', 'cushion', 'bed', 'toy'].includes(b.k)) {
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

  // ---- 犬 ----
  /** kinds: 番号ごとの犬の種類、colors: 番号ごとの足もとの輪の色 */
  ensureDogs(kinds, colors) {
    if (this.dogs.length === kinds.length && this.dogs.every((d, i) => d.kind === kinds[i])) return;
    for (const d of this.dogs) this.scene.remove(d.root);
    this.dogs = kinds.map((kind, i) => {
      const root = new THREE.Group();
      const dog = buildDog(kind);
      dog.group.scale.setScalar(DOG_SCALE);
      const gun = makeGun();
      gun.position.set(0.05, 0.5, 0.4);
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
      root.add(body, ring, blob, gum, star);
      this.scene.add(root);
      return { kind, root, body, dog, gun, ring, blob, gum, star, t: i };
    });
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
      d.ring.visible = !v.dead;
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

  // ---- 輪ゴム ----
  /** list: { x, y, z, vx, vy, vz, kind, spin } */
  updateBands(list, dt) {
    while (this.bands.length < list.length) {
      const m = new THREE.Mesh(new THREE.TorusGeometry(1, 0.22, 6, 16), toon(BAND_COLORS[0]));
      this.scene.add(m);
      this.bands.push(m);
    }
    this.bands.forEach((m, k) => {
      const b = list[k];
      m.visible = !!b;
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

  _stepFx(dt) {
    for (let i = this.fxList.length - 1; i >= 0; i--) {
      const m = this.fxList[i];
      const u = m.userData;
      u.age += dt;
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
    const gun = makeGun();
    gun.scale.setScalar(0.4);
    gun.rotation.y = Math.PI; // カメラの前（-z）を向く
    const paw = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), toon(0xf2a04b));
    paw.position.set(0, -0.05, 0.03);
    vm.add(gun, paw);
    vm.position.set(0.2, -0.19, -0.36);
    vm.traverse((o) => {
      if (o.material) {
        o.material = o.material.clone();
        o.material.depthTest = false; // 壁に近づいても鉄砲が壁にめりこんで見えないように、いちばん手前に描く
      }
      o.renderOrder = 1000;
    });
    this.camera.add(vm);
    this.vm = { root: vm, gun, paw, recoil: 0, bob: 0 };
  }

  /** 自分の鉄砲の見た目: 撃った反動・補充中は下げる・輪ゴムの色・歩きの揺れ */
  setViewModel({ fired = false, reloading = false, kind = 0, moving = false, visible = true, furColor = null }, dt) {
    const v = this.vm;
    v.root.visible = visible;
    if (fired) v.recoil = 1;
    v.recoil = Math.max(0, v.recoil - dt * 8);
    v.bob += dt * (moving ? 10 : 2);
    const down = reloading ? 0.12 : 0;
    v.root.position.set(0.2 + Math.sin(v.bob) * (moving ? 0.008 : 0.002), -0.19 - down - Math.abs(Math.cos(v.bob)) * (moving ? 0.01 : 0.003), -0.36 + v.recoil * 0.05);
    v.root.rotation.x = v.recoil * 0.25 + (reloading ? -0.5 : 0);
    const band = v.gun.userData.band;
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
