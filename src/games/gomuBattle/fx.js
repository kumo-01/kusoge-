// エフェクト用の、まとめて描く粒（1 回の描画で数百個）と、地面・壁に貼る跡（使い回し）。
// 1 つずつ Mesh を作ると重いので、決まった数の粒を用意して、空いているものを使う。
import * as THREE from 'three';

const VERT = `
attribute float size;
attribute float alpha;
attribute vec3 tint;
varying float vAlpha;
varying vec3 vTint;
uniform float scale;
void main() {
  vAlpha = alpha;
  vTint = tint;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * scale / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = `
uniform sampler2D map;
varying float vAlpha;
varying vec3 vTint;
void main() {
  vec4 c = texture2D(map, gl_PointCoord);
  if (c.a * vAlpha < 0.01) discard;
  gl_FragColor = vec4(vTint * c.rgb, c.a * vAlpha);
  #include <colorspace_fragment>
}`;

/** 丸くぼかした粒の絵 */
function softTex(hard = 0.3) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const x = cv.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(hard, 'rgba(255,255,255,0.8)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(cv);
  return t;
}

/**
 * 粒の集まり。spawn({ x, y, z, vx, vy, vz, life, size, color, grow, g, drag, a0 }) で 1 つ出す。
 * additive: 光るもの（火花・きらめき・ホタル）は足して明るく
 */
export class Particles {
  constructor(scene, N = 600, additive = false) {
    this.N = N;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(N * 3);
    this.size = new Float32Array(N);
    this.alpha = new Float32Array(N);
    this.tint = new Float32Array(N * 3);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    g.setAttribute('tint', new THREE.BufferAttribute(this.tint, 3));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: softTex(additive ? 0.2 : 0.45) }, scale: { value: 400 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
    // 粒ごとの動き
    this.p = Array.from({ length: N }, () => ({ on: false }));
    this.next = 0;
    this.live = 0;
    this._c = new THREE.Color();
  }

  /** 画面の高さに合わせて粒の大きさを決める */
  setScale(px) {
    this.mat.uniforms.scale.value = px;
  }

  spawn(o) {
    // 空いている粒（なければいちばん古いもの）
    let k = this.next;
    for (let n = 0; n < this.N; n++) {
      const j = (this.next + n) % this.N;
      if (!this.p[j].on) {
        k = j;
        break;
      }
    }
    this.next = (k + 1) % this.N;
    const q = this.p[k];
    if (!q.on) this.live++;
    q.on = true;
    q.x = o.x;
    q.y = o.y;
    q.z = o.z;
    q.vx = o.vx || 0;
    q.vy = o.vy || 0;
    q.vz = o.vz || 0;
    q.life = o.life || 0.6;
    q.age = 0;
    q.s0 = o.size ?? 0.2;
    q.grow = o.grow ?? 0;
    q.g = o.g ?? 0;
    q.drag = o.drag ?? 0;
    q.a0 = o.a0 ?? 1;
    q.blink = o.blink || 0;
    this._c.set(o.color ?? 0xffffff);
    this.tint[k * 3] = this._c.r;
    this.tint[k * 3 + 1] = this._c.g;
    this.tint[k * 3 + 2] = this._c.b;
    return q;
  }

  step(dt, t = 0) {
    if (!this.live) return;
    let live = 0;
    for (let k = 0; k < this.N; k++) {
      const q = this.p[k];
      if (!q.on) continue;
      q.age += dt;
      if (q.age >= q.life) {
        q.on = false;
        this.alpha[k] = 0;
        continue;
      }
      live++;
      q.vy -= q.g * dt;
      const dr = Math.max(0, 1 - q.drag * dt);
      q.vx *= dr;
      q.vy *= dr;
      q.vz *= dr;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.z += q.vz * dt;
      const f = q.age / q.life;
      this.pos[k * 3] = q.x;
      this.pos[k * 3 + 1] = q.y;
      this.pos[k * 3 + 2] = q.z;
      this.size[k] = q.s0 * (1 + q.grow * f);
      let a = q.a0 * (f < 0.15 ? f / 0.15 : 1 - (f - 0.15) / 0.85);
      if (q.blink) a *= 0.35 + 0.65 * Math.max(0, Math.sin(t * q.blink + k));
      this.alpha[k] = a;
    }
    this.live = live;
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.size.needsUpdate = true;
    g.attributes.alpha.needsUpdate = true;
    g.attributes.tint.needsUpdate = true;
  }

  dispose() {
    this.points.parent?.remove(this.points);
    this.points.geometry.dispose();
    this.mat.dispose();
  }
}

/**
 * 地面・壁に貼る跡（輪ゴムの当たった跡・雪の足あと）。N 枚を使い回す。add(x, y, z, nx, ny, nz, size, life, color, yaw)
 */
export class Decals {
  constructor(scene, N, tex, opacity = 0.7) {
    this.N = N;
    this.list = [];
    this.next = 0;
    const geo = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < N; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
      m.visible = false;
      m.renderOrder = 2;
      scene.add(m);
      this.list.push({ m, life: 0, age: 0, op: opacity });
    }
    this._n = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 0, 1);
  }

  add(x, y, z, nx, ny, nz, size = 0.3, life = 8, color = 0x222222, yaw = 0) {
    const d = this.list[this.next];
    this.next = (this.next + 1) % this.N;
    d.m.visible = true;
    d.m.position.set(x + nx * 0.01, y + ny * 0.01, z + nz * 0.01);
    this._n.set(nx, ny, nz).normalize();
    d.m.quaternion.setFromUnitVectors(this._up, this._n);
    if (yaw) d.m.rotateZ(yaw);
    d.m.scale.set(size, size * (d.stretch || 1), 1);
    d.m.material.color.setHex(color);
    d.life = life;
    d.age = 0;
    return d;
  }

  step(dt) {
    for (const d of this.list) {
      if (!d.m.visible) continue;
      d.age += dt;
      if (d.age >= d.life) {
        d.m.visible = false;
        continue;
      }
      d.m.material.opacity = d.op * Math.min(1, (d.life - d.age) / (d.life * 0.4));
    }
  }

  dispose() {
    for (const d of this.list) {
      d.m.parent?.remove(d.m);
      d.m.material.dispose();
    }
    this.list[0]?.m.geometry.dispose();
  }
}

/** 輪ゴムの当たった跡（こすれた黒い輪） */
export function markTex() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const x = cv.getContext('2d');
  x.strokeStyle = 'rgba(0,0,0,0.85)';
  x.lineWidth = 7;
  x.beginPath();
  x.arc(32, 32, 20, 0, Math.PI * 2);
  x.stroke();
  x.fillStyle = 'rgba(0,0,0,0.35)';
  x.beginPath();
  x.arc(32, 32, 12, 0, Math.PI * 2);
  x.fill();
  return new THREE.CanvasTexture(cv);
}

/** 雪の足あと（肉球の形） */
export function pawTex() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const x = cv.getContext('2d');
  x.fillStyle = 'rgba(120,140,170,0.9)';
  x.beginPath();
  x.ellipse(32, 40, 13, 11, 0, 0, Math.PI * 2);
  x.fill();
  for (const [px, py] of [[16, 22], [27, 15], [38, 15], [49, 22]]) {
    x.beginPath();
    x.ellipse(px, py, 5.5, 6.5, 0, 0, Math.PI * 2);
    x.fill();
  }
  return new THREE.CanvasTexture(cv);
}
