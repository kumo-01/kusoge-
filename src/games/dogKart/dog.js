// 犬のモデル（Three.js のプリミティブを組み合わせたローポリ・デフォルメ）
// ホスト: 柴犬 / ゲスト: コーギー
import * as THREE from 'three';

const geo = {};
function g(key, make) {
  return geo[key] || (geo[key] = make());
}
const mats = {};
function m(color, opts = {}) {
  const key = `${color}-${JSON.stringify(opts)}`;
  return mats[key] || (mats[key] = new THREE.MeshToonMaterial({ color, ...opts }));
}

const SPHERE = () => g('sphere', () => new THREE.SphereGeometry(1, 20, 14));
const SPHERE_LO = () => g('sphereLo', () => new THREE.SphereGeometry(1, 12, 8));
const CONE = () => g('cone', () => new THREE.ConeGeometry(1, 1, 4, 1));
const CAPSULE = () => g('capsule', () => new THREE.CapsuleGeometry(0.16, 0.5, 4, 8));

function mesh(geometry, material, { pos, scale, rot } = {}) {
  const o = new THREE.Mesh(geometry, material);
  if (pos) o.position.set(...pos);
  if (scale) o.scale.set(...scale);
  if (rot) o.rotation.set(...rot);
  o.castShadow = true;
  return o;
}

const STYLE = {
  shiba: { fur: 0xf2a04b, dark: 0xcf7a2a, cream: 0xfff1d6, inner: 0xffd2a6, earH: 0.42, earW: 0.24, earSpread: 0.33, earTilt: 0.18, scarf: 0xe8384f },
  corgi: { fur: 0xe8893a, dark: 0xc46a22, cream: 0xffffff, inner: 0xffc1a3, earH: 0.62, earW: 0.3, earSpread: 0.38, earTilt: 0.32, scarf: 0x3b82f6 },
  // NPC
  poodle: { fur: 0xfff3f6, dark: 0xf2d4dd, cream: 0xffffff, inner: 0xffd0dc, ears: 'floppy', earSpread: 0.46, scarf: 0xff6fae, pom: true },
  pug: { fur: 0xead1a4, dark: 0x3b2f2a, cream: 0xf6e3c0, inner: 0x3b2f2a, ears: 'fold', earSpread: 0.36, scarf: 0x22b573, muzzle: 0x3b2f2a },
};

/**
 * 犬を作る。原点は座席の座面中央。+z が前。
 * @returns {{ group: THREE.Group, animate: (a: object) => void }}
 */
export function buildDog(kind) {
  const st = STYLE[kind] || STYLE.shiba;
  const fur = m(st.fur);
  const dark = m(st.dark);
  const cream = m(st.cream);
  const black = m(0x2a1d14);
  const white = m(0xffffff);
  const pink = m(0xff8fa3);
  const blush = m(0xff9aae, { transparent: true, opacity: 0.6 });

  const group = new THREE.Group();

  // 胴体（座っている）
  const body = new THREE.Group();
  group.add(body);
  body.add(mesh(SPHERE(), fur, { pos: [0, 0.45, 0], scale: [0.5, 0.55, 0.45] }));
  body.add(mesh(SPHERE(), cream, { pos: [0, 0.5, 0.2], scale: [0.36, 0.42, 0.3] })); // 胸
  // スカーフ
  body.add(mesh(g('torus', () => new THREE.TorusGeometry(0.33, 0.08, 8, 20)), m(st.scarf), { pos: [0, 0.88, 0.02], rot: [Math.PI / 2, 0, 0] }));
  body.add(mesh(CONE(), m(st.scarf), { pos: [0.12, 0.78, -0.3], scale: [0.14, 0.26, 0.05], rot: [0.4, 0, 0.3] }));

  // 腕（ハンドルへ伸びる）
  const arms = [];
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.36, 0.72, 0.1);
    const arm = mesh(CAPSULE(), fur, { pos: [0, 0, 0.3], rot: [Math.PI / 2 + 0.35, 0, 0] });
    shoulder.add(arm);
    const paw = mesh(SPHERE_LO(), cream, { pos: [0, -0.12, 0.62], scale: [0.15, 0.13, 0.15] });
    shoulder.add(paw);
    shoulder.rotation.y = -side * 0.35;
    body.add(shoulder);
    arms.push(shoulder);
  }

  // 頭（大きめ＝かわいい）
  const head = new THREE.Group();
  head.position.set(0, 1.28, 0.08);
  body.add(head);
  head.add(mesh(SPHERE(), fur, { scale: [0.56, 0.5, 0.5] }));
  // 口元
  if (kind === 'corgi') {
    head.add(mesh(SPHERE(), cream, { pos: [0, 0.18, 0.32], scale: [0.12, 0.32, 0.2] })); // 額の白いライン
  }
  head.add(mesh(SPHERE(), st.muzzle ? m(st.muzzle) : cream, { pos: [0, -0.14, 0.34], scale: [0.34, 0.26, 0.26] }));
  head.add(mesh(SPHERE(), cream, { pos: [-0.3, -0.12, 0.22], scale: [0.18, 0.15, 0.15] }));
  head.add(mesh(SPHERE(), cream, { pos: [0.3, -0.12, 0.22], scale: [0.18, 0.15, 0.15] }));
  // 鼻・口
  head.add(mesh(SPHERE_LO(), black, { pos: [0, -0.04, 0.6], scale: [0.09, 0.07, 0.07] }));
  head.add(mesh(SPHERE_LO(), white, { pos: [-0.025, -0.015, 0.66], scale: [0.025, 0.02, 0.02] }));
  const tongue = mesh(SPHERE_LO(), pink, { pos: [0, -0.3, 0.52], scale: [0.08, 0.1, 0.05] });
  tongue.visible = kind === 'corgi' || kind === 'pug';
  head.add(tongue);
  // 目
  const eyes = [];
  for (const side of [-1, 1]) {
    const eye = new THREE.Group();
    eye.position.set(side * 0.2, 0.06, 0.43);
    eye.add(mesh(SPHERE_LO(), black, { scale: [0.075, 0.09, 0.05] }));
    eye.add(mesh(SPHERE_LO(), white, { pos: [side * -0.02 + 0.015, 0.03, 0.04], scale: [0.025, 0.025, 0.02] }));
    head.add(eye);
    eyes.push(eye);
    head.add(mesh(SPHERE_LO(), blush, { pos: [side * 0.36, -0.12, 0.3], scale: [0.09, 0.05, 0.04] }));
    if (kind === 'shiba') head.add(mesh(SPHERE_LO(), cream, { pos: [side * 0.17, 0.22, 0.42], scale: [0.06, 0.04, 0.03] })); // 麻呂眉
  }
  // 耳（立ち耳 / 垂れ耳 / 折れ耳）
  const ears = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    if (st.ears === 'floppy') {
      // プードル: もこもこの垂れ耳
      pivot.position.set(side * st.earSpread, 0.12, -0.02);
      for (const [y, r] of [[-0.12, 0.17], [-0.3, 0.19], [-0.46, 0.15]]) pivot.add(mesh(SPHERE_LO(), fur, { pos: [side * 0.04, y, 0], scale: [r * 0.8, r, r] }));
    } else if (st.ears === 'fold') {
      // パグ: 小さく前に折れた耳
      pivot.position.set(side * st.earSpread, 0.34, 0.02);
      pivot.add(mesh(CONE(), dark, { pos: [side * 0.06, 0.02, 0.08], scale: [0.2, 0.2, 0.08], rot: [1.9, Math.PI / 4, side * 0.4] }));
    } else {
      pivot.position.set(side * st.earSpread, 0.36, -0.02);
      pivot.rotation.z = -side * st.earTilt;
      const ear = mesh(CONE(), fur, { pos: [0, st.earH / 2, 0], scale: [st.earW, st.earH, 0.12], rot: [0, Math.PI / 4, 0] });
      const inner = mesh(CONE(), m(st.inner), { pos: [0, st.earH * 0.42, 0.045], scale: [st.earW * 0.6, st.earH * 0.7, 0.05], rot: [0, Math.PI / 4, 0] });
      pivot.add(ear, inner);
    }
    head.add(pivot);
    ears.push({ pivot, side });
  }
  // プードルの頭のぽんぽん
  if (st.pom) {
    for (const [x, y, z, r] of [[0, 0.5, -0.02, 0.24], [-0.17, 0.42, 0.02, 0.17], [0.17, 0.42, 0.02, 0.17], [0, 0.42, 0.18, 0.15]]) head.add(mesh(SPHERE_LO(), fur, { pos: [x, y, z], scale: [r, r, r] }));
    head.add(mesh(g('bow', () => new THREE.TorusGeometry(0.08, 0.04, 6, 10)), m(0xff6fae), { pos: [0.22, 0.6, 0.05], scale: [1.4, 0.8, 1] }));
  }
  // しっぽ
  const tail = new THREE.Group();
  tail.position.set(0, 0.35, -0.42);
  if (kind === 'shiba' || kind === 'pug') {
    // くるんと巻いたしっぽ
    tail.add(mesh(g('tailTorus', () => new THREE.TorusGeometry(0.16, 0.08, 8, 14, Math.PI * 1.6)), fur, { pos: [0, 0.2, 0], rot: [0, Math.PI / 2, 0] }));
    tail.add(mesh(SPHERE_LO(), cream, { pos: [0, 0.34, 0.05], scale: [0.08, 0.08, 0.08] }));
  } else if (kind === 'poodle') {
    tail.add(mesh(SPHERE_LO(), fur, { pos: [0, 0.3, -0.1], scale: [0.2, 0.2, 0.2] })); // ぽんぽんしっぽ
  } else {
    tail.add(mesh(SPHERE_LO(), dark, { pos: [0, 0.05, -0.08], scale: [0.14, 0.12, 0.16] })); // コーギーの短いしっぽ
  }
  body.add(tail);

  // 泣き顔用の涙
  const tears = [];
  for (const side of [-1, 1]) {
    const tear = mesh(SPHERE_LO(), m(0x7cc8ff, { transparent: true, opacity: 0.85 }), { pos: [side * 0.22, -0.05, 0.45], scale: [0.04, 0.07, 0.04] });
    tear.visible = false;
    head.add(tear);
    tears.push(tear);
  }

  let t = Math.random() * 10;
  /**
   * @param {{ dt, speed, steer, spin, boost, bump, mood }} a
   *   mood: 0 通常 / 1 勝利 / -1 敗北
   */
  function animate(a) {
    t += a.dt;
    const sp = Math.min(1.5, Math.abs(a.speed) / 27);
    // 頭の揺れ（走行中の振動・曲がる方向へ傾く）
    const bob = Math.sin(t * (6 + sp * 10)) * 0.02 * (0.3 + sp);
    head.position.y = 1.28 + bob + a.bump * 0.15 * Math.sin(t * 40);
    head.rotation.z = a.steer * 0.25 + Math.sin(t * 3) * 0.03;
    head.rotation.y = a.steer * 0.3;
    head.rotation.x = -sp * 0.08 - a.boost * 0.15;
    body.rotation.z = a.steer * 0.12;
    // 耳: 速いほど後ろへなびき、パタパタ
    for (const e of ears) {
      const flap = Math.sin(t * (12 + sp * 20) + e.side) * 0.08 * (0.3 + sp);
      e.pivot.rotation.x = -sp * 0.55 - a.boost * 0.4 + flap;
    }
    tail.rotation.y = Math.sin(t * 14) * (kind === 'corgi' ? 0.6 : 0.35);
    // ハンドル操作
    arms[0].rotation.x = a.steer * 0.25;
    arms[1].rotation.x = -a.steer * 0.25;
    tongue.visible = kind === 'corgi' || kind === 'pug' || a.boost > 0 || a.mood === 1;
    tongue.scale.y = 0.1 + Math.sin(t * 20) * 0.02 + (a.boost > 0 ? 0.04 : 0);
    // スピン中は目を回す（目が縦につぶれる）
    for (const e of eyes) {
      e.scale.y = a.spin > 0 ? 0.35 + Math.abs(Math.sin(t * 20)) * 0.4 : a.mood === 1 ? 0.45 : 1;
      e.rotation.z = a.spin > 0 ? t * 15 : 0;
    }
    // 勝利: ぴょんぴょん。敗北: しょんぼり＆涙
    if (a.mood === 1) {
      body.position.y = Math.abs(Math.sin(t * 8)) * 0.25;
      arms[0].rotation.x = -1.6 + Math.sin(t * 10) * 0.3;
      arms[1].rotation.x = -1.6 - Math.sin(t * 10) * 0.3;
    } else if (a.mood === -1) {
      body.position.y = 0;
      head.rotation.x = 0.35;
      for (const e of ears) e.pivot.rotation.x = 0.5;
    } else {
      body.position.y = 0;
    }
    for (const tr of tears) {
      tr.visible = a.mood === -1;
      if (tr.visible) tr.position.y = -0.05 - ((t * 0.6) % 0.3);
    }
  }

  return { group, animate };
}
