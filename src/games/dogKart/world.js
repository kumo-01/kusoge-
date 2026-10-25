// 3D の世界: レンダラー・空・草原・コース・背景オブジェクト・アイテムの見た目
// ゲーム状態は持たず、渡された状態を描くだけ。
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { KartView } from './kart.js';
import { Effects } from './effects.js';
import { buildDog } from './dog.js';

// 背景配置用の決定的な乱数（ホストとゲストで同じ景色になる）
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(w, hgt, draw, { repeat = false } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = hgt;
  draw(c.getContext('2d'), w, hgt);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

const FONT = '"M PLUS Rounded 1c", "Hiragino Maru Gothic ProN", "Arial Rounded MT Bold", sans-serif';

export class World {
  constructor(container, track, boxPos) {
    this.track = track;
    this.boxPos = boxPos;
    this.disposables = [];
    this.container = container;

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.domElement.className = 'game-canvas';
    container.append(renderer.domElement);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    this.scene = scene;
    const skyColor = new THREE.Color(0x9fdcff);
    scene.background = skyColor;
    scene.fog = new THREE.Fog(skyColor, 160, 520);

    this.camera = new THREE.PerspectiveCamera(62, 1, 0.3, 1200);

    // 光
    scene.add(new THREE.HemisphereLight(0xdff4ff, 0x76c85b, 1.25));
    const sun = new THREE.DirectionalLight(0xfff4e0, 1.7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -45;
    sc.right = 45;
    sc.top = 45;
    sc.bottom = -45;
    sc.near = 1;
    sc.far = 200;
    sun.shadow.bias = -0.0008;
    scene.add(sun, sun.target);
    this.sun = sun;

    this._buildSky();
    this._buildGround();
    this._buildTrack();
    this._buildScenery();
    this._buildItemViews();

    this.karts = [new KartView(0), new KartView(1)];
    for (const k of this.karts) scene.add(k.group, k.blob);
    this.effects = new Effects(scene);

    // シェーダーを先にコンパイルしておく（初回フレームのカクつき防止）
    try {
      renderer.compile(scene, this.camera);
    } catch {
      /* noop */
    }
    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(container);
    this.resize();
  }

  _track(obj) {
    this.disposables.push(obj);
    return obj;
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  _buildSky() {
    const geo = this._track(new THREE.SphereGeometry(900, 24, 12));
    const mat = this._track(
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: { top: { value: new THREE.Color(0x4fb4ff) }, bottom: { value: new THREE.Color(0xe6f7ff) } },
        vertexShader: 'varying vec3 vPos; void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vPos; void main(){ float h = clamp(normalize(vPos).y * 1.6 + 0.1, 0.0, 1.0); gl_FragColor = vec4(mix(bottom, top, h), 1.0); }',
      }),
    );
    this.sky = new THREE.Mesh(geo, mat);
    this.scene.add(this.sky);

    // 雲（白い球の集まり）
    const rnd = seeded(7);
    const cloudMat = this._track(new THREE.MeshToonMaterial({ color: 0xffffff }));
    const puff = this._track(new THREE.IcosahedronGeometry(1, 1));
    this.clouds = [];
    for (let i = 0; i < 16; i++) {
      const g = new THREE.Group();
      const n = 3 + Math.floor(rnd() * 4);
      for (let j = 0; j < n; j++) {
        const m = new THREE.Mesh(puff, cloudMat);
        m.position.set(j * 5 - n * 2.5, rnd() * 2, rnd() * 4);
        m.scale.setScalar(4 + rnd() * 4);
        g.add(m);
      }
      const a = rnd() * Math.PI * 2;
      const r = 150 + rnd() * 250;
      g.position.set(Math.cos(a) * r, 70 + rnd() * 50, Math.sin(a) * r);
      g.userData.speed = 0.6 + rnd();
      this.scene.add(g);
      this.clouds.push(g);
    }

    // 遠くの山
    const mountainGeo = this._track(new THREE.ConeGeometry(1, 1, 7));
    const colors = [0x8fd18b, 0x7cc6a0, 0x9bd4c4, 0xa9dc8f];
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2 + rnd() * 0.2;
      const r = 430 + rnd() * 80;
      const m = new THREE.Mesh(mountainGeo, this._track(new THREE.MeshToonMaterial({ color: colors[i % colors.length] })));
      const s = 60 + rnd() * 70;
      m.scale.set(s * 1.3, s, s * 1.3);
      m.position.set(Math.cos(a) * r, s / 2 - 2, Math.sin(a) * r);
      this.scene.add(m);
    }
  }

  _buildGround() {
    const tex = this._track(
      canvasTexture(256, 256, (x, w, h) => {
        x.fillStyle = '#7fd35f';
        x.fillRect(0, 0, w, h);
        const r = seeded(3);
        for (let i = 0; i < 900; i++) {
          x.fillStyle = r() < 0.5 ? 'rgba(90,180,70,0.35)' : 'rgba(170,235,120,0.35)';
          x.fillRect(r() * w, r() * h, 2 + r() * 4, 2 + r() * 4);
        }
      }, { repeat: true }),
    );
    tex.repeat.set(120, 120);
    const ground = new THREE.Mesh(this._track(new THREE.PlaneGeometry(1400, 1400)), this._track(new THREE.MeshToonMaterial({ map: tex })));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
  }

  /** 中心線に沿ったリボン状のメッシュ */
  _ribbon(latA, latB, y, vScale) {
    // 三角形の向きを揃える（上から見えるように）
    if (latA > latB) [latA, latB] = [latB, latA];
    const t = this.track;
    const N = t.n;
    const pos = new Float32Array((N + 1) * 2 * 3);
    const uv = new Float32Array((N + 1) * 2 * 2);
    const idx = [];
    for (let i = 0; i <= N; i++) {
      const k = i % N;
      // 頂点の法線はセグメント前後の平均
      const p = (k - 1 + N) % N;
      let tx = t.tx[k] + t.tx[p];
      let tz = t.tz[k] + t.tz[p];
      const l = Math.hypot(tx, tz) || 1;
      tx /= l;
      tz /= l;
      const nx = tz;
      const nz = -tx;
      pos.set([t.x[k] + nx * latA, y, t.z[k] + nz * latA, t.x[k] + nx * latB, y, t.z[k] + nz * latB], i * 6);
      const v = (i === N ? t.length : t.cum[k]) / vScale;
      uv.set([0, v, 1, v], i * 4);
      if (i < N) {
        const a = i * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return this._track(geo);
  }

  _buildTrack() {
    const t = this.track;
    // 道路（中央に白い破線）
    const roadTex = this._track(
      canvasTexture(128, 256, (x, w, h) => {
        x.fillStyle = '#7a7690';
        x.fillRect(0, 0, w, h);
        const r = seeded(11);
        for (let i = 0; i < 500; i++) {
          x.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
          x.fillRect(r() * w, r() * h, 2, 2);
        }
        x.fillStyle = '#fffbea';
        x.fillRect(w / 2 - 3, 0, 6, h * 0.55);
        x.fillStyle = 'rgba(255,255,255,0.5)';
        x.fillRect(4, 0, 3, h);
        x.fillRect(w - 7, 0, 3, h);
      }, { repeat: true }),
    );
    const road = new THREE.Mesh(this._ribbon(t.roadHalf, -t.roadHalf, 0.02, 14), this._track(new THREE.MeshToonMaterial({ map: roadTex })));
    road.receiveShadow = true;
    this.scene.add(road);

    // 縁石（赤白）
    const curbTex = this._track(
      canvasTexture(16, 64, (x, w, h) => {
        x.fillStyle = '#ff4d5e';
        x.fillRect(0, 0, w, h / 2);
        x.fillStyle = '#ffffff';
        x.fillRect(0, h / 2, w, h / 2);
      }, { repeat: true }),
    );
    const curbMat = this._track(new THREE.MeshToonMaterial({ map: curbTex }));
    for (const side of [1, -1]) {
      const curb = new THREE.Mesh(this._ribbon(side * t.roadHalf, side * (t.roadHalf + 1.3), 0.04, 4), curbMat);
      curb.receiveShadow = true;
      this.scene.add(curb);
    }
    // 芝生の路肩（少し濃い緑）
    const shoulderMat = this._track(new THREE.MeshToonMaterial({ color: 0x67c24f }));
    for (const side of [1, -1]) {
      const sh = new THREE.Mesh(this._ribbon(side * (t.roadHalf + 1.3), side * (t.wallDist + 0.3), 0.015, 8), shoulderMat);
      sh.receiveShadow = true;
      this.scene.add(sh);
    }

    // 壁: 丸いクッションブロックを並べる（InstancedMesh）
    const blockGeo = this._track(new RoundedBoxGeometry(2.7, 1.2, 0.9, 2, 0.3));
    const blockMat = this._track(new THREE.MeshToonMaterial({ color: 0xffffff }));
    const count = t.n * 2;
    const blocks = new THREE.InstancedMesh(blockGeo, blockMat, count);
    blocks.castShadow = true;
    blocks.receiveShadow = true;
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    const wallColors = [0xffffff, 0xff7a8a, 0xffffff, 0x6fb6ff];
    let n = 0;
    for (const side of [1, -1]) {
      for (let i = 0; i < t.n; i++) {
        const nx = t.tz[i];
        const nz = -t.tx[i];
        const d = t.wallDist + 0.45;
        q.setFromAxisAngle(up, Math.atan2(t.tx[i], t.tz[i]) + Math.PI / 2);
        m4.compose(new THREE.Vector3(t.x[i] + nx * d * side, 0.6, t.z[i] + nz * d * side), q, new THREE.Vector3(1, 1, 1));
        blocks.setMatrixAt(n, m4);
        blocks.setColorAt(n, col.set(wallColors[Math.floor(i / 2) % wallColors.length]));
        n++;
      }
    }
    blocks.instanceMatrix.needsUpdate = true;
    this.scene.add(blocks);

    // スタートライン（チェッカー）
    const checker = this._track(
      canvasTexture(128, 32, (x, w, h) => {
        const s = 16;
        for (let i = 0; i < w / s; i++)
          for (let j = 0; j < h / s; j++) {
            x.fillStyle = (i + j) % 2 ? '#222' : '#fff';
            x.fillRect(i * s, j * s, s, s);
          }
      }),
    );
    const sp = t.pointAt(0, 0);
    const line = new THREE.Mesh(this._track(new THREE.PlaneGeometry(t.roadHalf * 2, 2.5)), this._track(new THREE.MeshToonMaterial({ map: checker })));
    line.rotation.x = -Math.PI / 2;
    line.position.y = 0.05;
    line.receiveShadow = true;
    const lineGroup = new THREE.Group();
    lineGroup.add(line);
    lineGroup.position.set(sp.x, 0, sp.z);
    lineGroup.rotation.y = sp.h;
    this.scene.add(lineGroup);

    // スタートゲート
    const gate = new THREE.Group();
    gate.position.set(sp.x, 0, sp.z);
    gate.rotation.y = sp.h;
    const pillarGeo = this._track(new THREE.CylinderGeometry(0.8, 0.9, 9, 12));
    const pillarMat = this._track(new THREE.MeshToonMaterial({ color: 0xffb13d }));
    for (const s of [1, -1]) {
      const p = new THREE.Mesh(pillarGeo, pillarMat);
      p.position.set(s * (t.wallDist + 1.6), 4.5, 0);
      p.castShadow = true;
      gate.add(p);
      const ball = new THREE.Mesh(this._track(new THREE.SphereGeometry(1.4, 16, 12)), this._track(new THREE.MeshToonMaterial({ color: s > 0 ? 0xff4d5e : 0x3d8bff })));
      ball.position.set(s * (t.wallDist + 1.6), 10.2, 0);
      gate.add(ball);
    }
    const bannerTex = this._track(
      canvasTexture(1024, 160, (x, w, h) => {
        x.fillStyle = '#ff6f91';
        x.fillRect(0, 0, w, h);
        x.fillStyle = '#ffe066';
        for (let i = 0; i < w; i += 64) {
          x.beginPath();
          x.arc(i + 32, 12, 8, 0, Math.PI * 2);
          x.arc(i + 32, h - 12, 8, 0, Math.PI * 2);
          x.fill();
        }
        x.font = `900 92px ${FONT}`;
        x.textAlign = 'center';
        x.textBaseline = 'middle';
        x.lineWidth = 14;
        x.strokeStyle = '#ffffff';
        x.strokeText('🐾 わんわんGP 🐾', w / 2, h / 2 + 4);
        x.fillStyle = '#c81d4e';
        x.fillText('🐾 わんわんGP 🐾', w / 2, h / 2 + 4);
      }),
    );
    const banner = new THREE.Mesh(this._track(new THREE.BoxGeometry((t.wallDist + 1.6) * 2, 2.8, 0.5)), [
      pillarMat, pillarMat, pillarMat, pillarMat,
      this._track(new THREE.MeshToonMaterial({ map: bannerTex })),
      this._track(new THREE.MeshToonMaterial({ map: bannerTex })),
    ]);
    banner.position.y = 8;
    banner.castShadow = true;
    gate.add(banner);
    this.scene.add(gate);

    // チェックポイントの旗（進み具合の目印）
    const flagGeo = this._track(new THREE.ConeGeometry(0.9, 2.2, 3).rotateZ(-Math.PI / 2).translate(1.1, 0, 0));
    const poleGeo = this._track(new THREE.CylinderGeometry(0.08, 0.08, 4, 6));
    const poleMat = this._track(new THREE.MeshToonMaterial({ color: 0xffffff }));
    const flagColors = [0xff4d5e, 0xffd23f, 0x22b573, 0x3d8bff, 0xff6fae, 0x8a63ff, 0xff8a3d];
    this.flags = [];
    for (let k = 1; k < t.checkpoints; k++) {
      const p = t.pointAt(t.cpS(k), 0);
      for (const side of [1, -1]) {
        const g = new THREE.Group();
        const d = t.wallDist + 1.4;
        g.position.set(p.x + p.tz * d * side, 0, p.z - p.tx * d * side);
        const pole = new THREE.Mesh(poleGeo, poleMat);
        pole.position.y = 2;
        const flag = new THREE.Mesh(flagGeo, this._track(new THREE.MeshToonMaterial({ color: flagColors[(k - 1) % flagColors.length] })));
        flag.position.y = 3.4;
        flag.scale.set(1, 0.6, 0.25);
        g.add(pole, flag);
        g.rotation.y = Math.random() * 6;
        this.scene.add(g);
        this.flags.push(flag);
      }
    }
  }

  /** コースから十分離れているか */
  _farFromTrack(x, z, margin) {
    const p = this.track.project(x, z);
    return Math.abs(p.lat) > this.track.wallDist + margin;
  }

  _buildScenery() {
    const rnd = seeded(42);
    const scene = this.scene;
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();
    const col = new THREE.Color();

    // 木
    const spots = [];
    for (let tries = 0; tries < 3000 && spots.length < 170; tries++) {
      const x = (rnd() - 0.5) * 520;
      const z = (rnd() - 0.5) * 480 + 30;
      if (!this._farFromTrack(x, z, 6)) continue;
      if (spots.some(([a, b]) => (a - x) ** 2 + (b - z) ** 2 < 64)) continue;
      spots.push([x, z]);
    }
    const trunks = new THREE.InstancedMesh(this._track(new THREE.CylinderGeometry(0.5, 0.7, 3, 6)), this._track(new THREE.MeshToonMaterial({ color: 0x9a6a3a })), spots.length);
    const crowns = new THREE.InstancedMesh(this._track(new THREE.IcosahedronGeometry(2.6, 0)), this._track(new THREE.MeshToonMaterial({ color: 0xffffff })), spots.length * 2);
    trunks.castShadow = crowns.castShadow = true;
    const greens = [0x4cb944, 0x5fcf55, 0x3fa34d, 0x7ad35a, 0x9be070];
    spots.forEach(([x, z], i) => {
      const sc = 0.8 + rnd() * 0.8;
      q.setFromAxisAngle(v.set(0, 1, 0), rnd() * 6);
      m4.compose(v.set(x, 1.5 * sc, z), q, s.set(sc, sc, sc));
      trunks.setMatrixAt(i, m4);
      m4.compose(v.set(x, 4.2 * sc, z), q, s.set(sc * 1.1, sc, sc * 1.1));
      crowns.setMatrixAt(i * 2, m4);
      m4.compose(v.set(x, 6.2 * sc, z), q, s.set(sc * 0.7, sc * 0.7, sc * 0.7));
      crowns.setMatrixAt(i * 2 + 1, m4);
      const c = greens[Math.floor(rnd() * greens.length)];
      crowns.setColorAt(i * 2, col.set(c));
      crowns.setColorAt(i * 2 + 1, col.set(c).offsetHSL(0, 0, 0.06));
    });
    scene.add(trunks, crowns);

    // 花
    const flowerSpots = [];
    for (let tries = 0; tries < 4000 && flowerSpots.length < 500; tries++) {
      const x = (rnd() - 0.5) * 420;
      const z = (rnd() - 0.5) * 400 + 30;
      if (this._farFromTrack(x, z, 1.5)) flowerSpots.push([x, z]);
    }
    const flowers = new THREE.InstancedMesh(this._track(new THREE.IcosahedronGeometry(0.35, 0)), this._track(new THREE.MeshToonMaterial({ color: 0xffffff })), flowerSpots.length);
    const fc = [0xffffff, 0xffe066, 0xff8fb1, 0xb197fc, 0xffa94d];
    flowerSpots.forEach(([x, z], i) => {
      m4.compose(v.set(x, 0.3, z), q.identity(), s.set(1, 1, 1));
      flowers.setMatrixAt(i, m4);
      flowers.setColorAt(i, col.set(fc[i % fc.length]));
    });
    scene.add(flowers);

    // 看板
    const signs = ['わんわんGP', 'ホネ注意！', 'バナナに注意', 'スピード出しすぎ注意ワン', '体当たり上等！', 'がんばれ〜！'];
    const signTexts = signs.map((txt, i) =>
      this._track(
        canvasTexture(512, 256, (x, w, h) => {
          x.fillStyle = ['#fff3bf', '#ffe3ec', '#e7f5ff', '#ebfbee', '#fff4e6', '#f3f0ff'][i % 6];
          x.fillRect(0, 0, w, h);
          x.lineWidth = 16;
          x.strokeStyle = '#ff8a3d';
          x.strokeRect(8, 8, w - 16, h - 16);
          x.font = `900 ${txt.length > 8 ? 52 : 70}px ${FONT}`;
          x.textAlign = 'center';
          x.textBaseline = 'middle';
          x.fillStyle = '#5a3e2b';
          x.fillText(txt, w / 2, h / 2 - 10);
          x.font = `48px ${FONT}`;
          x.fillText('🐾🦴🐾', w / 2, h - 50);
        }),
      ),
    );
    const postMat = this._track(new THREE.MeshToonMaterial({ color: 0x8a5a2b }));
    const postGeo = this._track(new THREE.CylinderGeometry(0.25, 0.25, 4, 6));
    const boardGeo = this._track(new THREE.BoxGeometry(8, 4, 0.4));
    const t = this.track;
    for (let i = 0; i < 9; i++) {
      const sPos = ((i + 0.55) / 9) * t.length;
      const side = i % 2 ? 1 : -1;
      const p = t.pointAt(sPos, side * (t.wallDist + 6));
      const g = new THREE.Group();
      g.position.set(p.x, 0, p.z);
      // コース側を向く（看板の正面 = ローカル +z）
      g.rotation.y = Math.atan2(-side * p.tz, side * p.tx);
      for (const px of [-3, 3]) {
        const post = new THREE.Mesh(postGeo, postMat);
        post.position.set(px, 2, 0);
        post.castShadow = true;
        g.add(post);
      }
      const board = new THREE.Mesh(boardGeo, [postMat, postMat, postMat, postMat, this._track(new THREE.MeshToonMaterial({ map: signTexts[i % signTexts.length] })), postMat]);
      board.position.y = 5;
      board.castShadow = true;
      g.add(board);
      scene.add(g);
    }

    // 内側のランドマーク: 巨大な犬小屋・骨・消火栓・ごはん皿
    const places = [];
    for (let tries = 0; tries < 2000 && places.length < 4; tries++) {
      const x = (rnd() - 0.5) * 200;
      const z = (rnd() - 0.5) * 200 + 30;
      if (!this._farFromTrack(x, z, 18)) continue;
      // コースの内側だけに置く（このコースでは中心線の右側 = lat < 0 が内側）
      const p = t.project(x, z);
      if (p.lat > 0) continue;
      if (places.some(([a, b]) => (a - x) ** 2 + (b - z) ** 2 < 900)) continue;
      places.push([x, z]);
    }
    const builders = [() => this._dogHouse(), () => this._bigBone(), () => this._hydrant(), () => this._bowl()];
    places.forEach(([x, z], i) => {
      const o = builders[i % builders.length]();
      o.position.set(x, 0, z);
      o.rotation.y = rnd() * Math.PI * 2;
      scene.add(o);
    });

    // 応援する犬たち（スタート付近の外側）
    this.fans = [];
    const fanKinds = ['shiba', 'corgi', 'corgi', 'shiba'];
    for (let i = 0; i < 4; i++) {
      const p = t.pointAt(-20 + i * 12, -(t.wallDist + 4.5));
      const dog = buildDog(fanKinds[i]);
      dog.group.position.set(p.x, 0, p.z);
      dog.group.rotation.y = Math.atan2(p.tz, -p.tx); // コースの方を向く
      dog.group.scale.setScalar(2.2);
      scene.add(dog.group);
      this.fans.push(dog);
    }
  }

  _dogHouse() {
    const g = new THREE.Group();
    const wall = this._track(new THREE.MeshToonMaterial({ color: 0xffe0a3 }));
    const roof = this._track(new THREE.MeshToonMaterial({ color: 0xe8384f }));
    const box = new THREE.Mesh(this._track(new THREE.BoxGeometry(10, 7, 10)), wall);
    box.position.y = 3.5;
    const r = new THREE.Mesh(this._track(new THREE.ConeGeometry(8.5, 5, 4)), roof);
    r.position.y = 9.5;
    r.rotation.y = Math.PI / 4;
    const door = new THREE.Mesh(this._track(new THREE.CircleGeometry(2.4, 20)), this._track(new THREE.MeshBasicMaterial({ color: 0x3b2a20 })));
    door.position.set(0, 2.8, 5.02);
    const plate = new THREE.Mesh(
      this._track(new THREE.PlaneGeometry(5, 1.4)),
      this._track(new THREE.MeshToonMaterial({ map: this._track(canvasTexture(256, 72, (x, w, h) => {
        x.fillStyle = '#fff';
        x.fillRect(0, 0, w, h);
        x.font = `900 48px ${FONT}`;
        x.textAlign = 'center';
        x.textBaseline = 'middle';
        x.fillStyle = '#c81d4e';
        x.fillText('POCHI', w / 2, h / 2);
      })) })),
    );
    plate.position.set(0, 6.2, 5.03);
    for (const o of [box, r]) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
    g.add(box, r, door, plate);
    return g;
  }

  _bigBone() {
    const g = new THREE.Group();
    const mat = this._track(new THREE.MeshToonMaterial({ color: 0xfff3dd }));
    const shaft = new THREE.Mesh(this._track(new THREE.CylinderGeometry(1.4, 1.4, 12, 12)), mat);
    shaft.rotation.z = Math.PI / 2;
    shaft.position.y = 2.5;
    g.add(shaft);
    const ball = this._track(new THREE.SphereGeometry(2.2, 14, 10));
    for (const sx of [-6, 6])
      for (const sz of [-1.4, 1.4]) {
        const b = new THREE.Mesh(ball, mat);
        b.position.set(sx, 2.5, sz);
        b.castShadow = true;
        g.add(b);
      }
    shaft.castShadow = true;
    g.rotation.z = 0.1;
    return g;
  }

  _hydrant() {
    const g = new THREE.Group();
    const red = this._track(new THREE.MeshToonMaterial({ color: 0xff3b3b }));
    const body = new THREE.Mesh(this._track(new THREE.CylinderGeometry(1.8, 2.1, 7, 12)), red);
    body.position.y = 3.5;
    const cap = new THREE.Mesh(this._track(new THREE.SphereGeometry(1.9, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2)), red);
    cap.position.y = 7;
    const side = new THREE.Mesh(this._track(new THREE.CylinderGeometry(0.7, 0.7, 5.6, 10)), red);
    side.rotation.z = Math.PI / 2;
    side.position.y = 4.5;
    for (const o of [body, cap, side]) o.castShadow = true;
    g.add(body, cap, side);
    return g;
  }

  _bowl() {
    const g = new THREE.Group();
    const bowl = new THREE.Mesh(this._track(new THREE.CylinderGeometry(6, 4.5, 3, 20, 1, true)), this._track(new THREE.MeshToonMaterial({ color: 0x4dabf7, side: THREE.DoubleSide })));
    bowl.position.y = 1.5;
    const food = new THREE.Mesh(this._track(new THREE.CylinderGeometry(5.6, 5.6, 0.6, 20)), this._track(new THREE.MeshToonMaterial({ color: 0xa0522d })));
    food.position.y = 2.6;
    bowl.castShadow = true;
    g.add(bowl, food);
    const kib = this._track(new THREE.IcosahedronGeometry(0.6, 0));
    const kibMat = this._track(new THREE.MeshToonMaterial({ color: 0x8b4513 }));
    for (let i = 0; i < 14; i++) {
      const k = new THREE.Mesh(kib, kibMat);
      const a = i * 2.4;
      k.position.set(Math.cos(a) * (i % 4), 3 + (i % 3) * 0.3, Math.sin(a) * (i % 4));
      g.add(k);
    }
    return g;
  }

  _buildItemViews() {
    // アイテムボックス（虹色の「？」箱）
    const qTex = this._track(
      canvasTexture(128, 128, (x, w, h) => {
        const grd = x.createLinearGradient(0, 0, w, h);
        grd.addColorStop(0, '#ff8fb1');
        grd.addColorStop(0.5, '#ffe066');
        grd.addColorStop(1, '#74c0fc');
        x.fillStyle = grd;
        x.fillRect(0, 0, w, h);
        x.strokeStyle = '#fff';
        x.lineWidth = 10;
        x.strokeRect(5, 5, w - 10, h - 10);
        x.font = `900 90px ${FONT}`;
        x.textAlign = 'center';
        x.textBaseline = 'middle';
        x.lineWidth = 8;
        x.strokeText('?', w / 2, h / 2 + 4);
        x.fillStyle = '#ff4d5e';
        x.fillText('?', w / 2, h / 2 + 4);
      }),
    );
    const boxMat = this._track(new THREE.MeshToonMaterial({ map: qTex, transparent: true, opacity: 0.92 }));
    const boxGeo = this._track(new RoundedBoxGeometry(1.8, 1.8, 1.8, 2, 0.25));
    this.boxes = this.boxPos.map((p) => {
      const m = new THREE.Mesh(boxGeo, boxMat);
      m.position.set(p.x, 1.6, p.z);
      m.castShadow = true;
      this.scene.add(m);
      return m;
    });

    // ホネ
    const boneMat = this._track(new THREE.MeshToonMaterial({ color: 0xfff6e6 }));
    this._boneParts = {
      shaft: this._track(new THREE.CylinderGeometry(0.22, 0.22, 1.6, 8).rotateZ(Math.PI / 2)),
      knob: this._track(new THREE.SphereGeometry(0.34, 10, 8)),
      mat: boneMat,
    };
    // バナナ
    this._bananaParts = {
      body: this._track(new THREE.TorusGeometry(0.55, 0.2, 8, 14, Math.PI * 0.85)),
      mat: this._track(new THREE.MeshToonMaterial({ color: 0xffe14d })),
      tip: this._track(new THREE.SphereGeometry(0.12, 6, 5)),
      tipMat: this._track(new THREE.MeshToonMaterial({ color: 0x6b4423 })),
    };
    this.projViews = new Map();
    this.bananaViews = new Map();
    this._viewPool = { bone: [], banana: [] };
  }

  _makeBone() {
    const g = new THREE.Group();
    const p = this._boneParts;
    g.add(new THREE.Mesh(p.shaft, p.mat));
    for (const sx of [-0.8, 0.8])
      for (const sz of [-0.22, 0.22]) {
        const k = new THREE.Mesh(p.knob, p.mat);
        k.position.set(sx, 0, sz);
        g.add(k);
      }
    g.traverse((o) => (o.castShadow = true));
    g.scale.setScalar(1.3);
    return g;
  }

  _makeBanana() {
    const g = new THREE.Group();
    const p = this._bananaParts;
    const b = new THREE.Mesh(p.body, p.mat);
    b.rotation.x = Math.PI / 2;
    g.add(b);
    for (const a of [0, Math.PI * 0.85]) {
      const t = new THREE.Mesh(p.tip, p.tipMat);
      t.position.set(Math.cos(a) * 0.55, 0, -Math.sin(a) * 0.55);
      g.add(t);
    }
    g.traverse((o) => (o.castShadow = true));
    g.scale.setScalar(1.5);
    return g;
  }

  _syncViews(list, views, kind, make, place) {
    const seen = new Set();
    for (const it of list) {
      seen.add(it.id);
      let v = views.get(it.id);
      if (!v) {
        v = this._viewPool[kind].pop() || make();
        v.visible = true;
        this.scene.add(v);
        views.set(it.id, v);
      }
      place(v, it);
    }
    for (const [id, v] of views) {
      if (!seen.has(id)) {
        v.visible = false;
        views.delete(id);
        this._viewPool[kind].push(v);
      }
    }
  }

  /** アイテム類の描画を状態に合わせる */
  updateItems(items, dt) {
    this._t = (this._t || 0) + dt;
    const t = this._t;
    items.boxes.forEach((timer, i) => {
      const m = this.boxes[i];
      if (!m) return;
      m.visible = timer <= 0;
      if (m.visible) {
        m.rotation.y = t * 1.5 + i;
        m.rotation.x = Math.sin(t + i) * 0.3;
        m.position.y = 1.6 + Math.sin(t * 2.5 + i) * 0.25;
      }
    });
    this._syncViews(items.proj, this.projViews, 'bone', () => this._makeBone(), (v, p) => {
      v.position.set(p.x, 1.1, p.z);
      v.rotation.y = t * 18;
    });
    this._syncViews(items.bananas, this.bananaViews, 'banana', () => this._makeBanana(), (v, b) => {
      v.position.set(b.x, 0.35, b.z);
      v.rotation.y = b.id * 1.7;
    });
  }

  updateAmbient(dt) {
    for (const c of this.clouds) {
      c.position.x += c.userData.speed * dt;
      if (c.position.x > 420) c.position.x = -420;
    }
    for (const f of this.fans) f.animate({ dt, speed: 6, steer: Math.sin(performance.now() / 600) * 0.5, spin: 0, boost: 0, bump: 0, mood: 1 });
    const tt = performance.now() / 1000;
    this.flags.forEach((f, i) => (f.rotation.y = Math.sin(tt * 3 + i) * 0.4));
  }

  /** 影を落とすライトを注目点に合わせて動かす */
  followSun(x, z) {
    this.sun.position.set(x + 40, 80, z + 25);
    this.sun.target.position.set(x, 0, z);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this._ro.disconnect();
    for (const k of this.karts) k.dispose();
    this.effects.dispose();
    for (const d of this.disposables) d.dispose?.();
    this.scene.traverse((o) => {
      if (o.isInstancedMesh) o.dispose();
    });
    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
    this.renderer.domElement.remove();
  }
}
