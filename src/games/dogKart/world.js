// 3D の世界: レンダラー・空・草原・コース・背景オブジェクト・アイテムの見た目
// ゲーム状態は持たず、渡された状態を描くだけ。
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { KartView } from './kart.js';
import { Effects } from './effects.js';
import { buildDog } from './dog.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PAD, ITEMS } from './constants.js';
import { device, getQualityPref, setQualityPref } from '../../core/device.js';

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

// コースごとの見た目（track.theme）
const THEMES = {
  meadow: {
    sky: [0x4fb4ff, 0xe6f7ff],
    fog: 0x9fdcff,
    hemi: [0xdff4ff, 0x76c85b],
    ground: ['#7fd35f', 'rgba(90,180,70,0.35)', 'rgba(170,235,120,0.35)'],
    shoulder: 0x67c24f,
    mountains: { colors: [0x8fd18b, 0x7cc6a0, 0x9bd4c4, 0xa9dc8f], count: 22, size: 1 },
    trees: 'round',
    deco: { colors: [0xffffff, 0xffe066, 0xff8fb1, 0xb197fc, 0xffa94d], scale: 1, y: 0.3, count: 500 },
    landmarks: 'dog',
    signs: ['わんわんGP', 'ホネ注意！', 'バナナに注意', 'スピード出しすぎ注意ワン', '体当たり上等！', 'がんばれ〜！'],
    fans: ['shiba', 'corgi', 'corgi', 'shiba'],
  },
  beach: {
    sky: [0x1f9cff, 0xfff4dc],
    fog: 0xbfe8ff,
    hemi: [0xfff7e0, 0xe8cf8f],
    ground: ['#f2d79b', 'rgba(255,255,255,0.35)', 'rgba(200,160,90,0.3)'],
    shoulder: 0xe6c27c,
    mountains: { colors: [0x5fcf8a, 0x4cb97a, 0x7ad39a], count: 9, size: 0.45 },
    trees: 'palm',
    deco: { colors: [0xff8fb1, 0xffa94d, 0xffffff, 0xffe066], scale: 0.8, y: 0.2, count: 260 },
    landmarks: 'beach',
    ocean: true,
    signs: ['しっぽフリフリ海岸', '波に注意！', 'カニ横断中', 'ヤシの実注意', '体当たり上等！', 'がんばれ〜！'],
    fans: ['poodle', 'pug', 'corgi', 'shiba'],
  },
  autumn: {
    sky: [0xf08a4b, 0xffe6c2],
    fog: 0xffd9a8,
    hemi: [0xfff0d8, 0xc98a4a],
    ground: ['#d9a35a', 'rgba(190,100,40,0.35)', 'rgba(240,200,110,0.4)'],
    shoulder: 0xc58a45,
    mountains: { colors: [0xd9803f, 0xc96b34, 0xe0a050, 0xb85a2e], count: 22, size: 1 },
    trees: 'round',
    leaves: [0xe8602c, 0xf08a2e, 0xd9441f, 0xf2b134, 0xc2381a],
    deco: { colors: [0xe8602c, 0xf2b134, 0xc2381a, 0xffd27a], scale: 1, y: 0.2, count: 500 },
    landmarks: 'dog',
    signs: ['ひらひら紅葉の森', '落ち葉ですべる！', 'どんぐり注意', '体当たり上等！', 'がんばれ〜！', 'ホネ注意！'],
    fans: ['corgi', 'dachs', 'shiba', 'pug'],
  },
  night: {
    sky: [0x0b1038, 0x3a3f7a],
    fog: 0x23285a,
    hemi: [0x8fa0ff, 0x2a2f5c],
    sun: 0.9,
    sunColor: 0xbfc8ff,
    ground: ['#2f3f6a', 'rgba(90,120,200,0.3)', 'rgba(20,30,70,0.4)'],
    shoulder: 0x38487a,
    mountains: { colors: [0x2a3566, 0x333f78, 0x242c58], count: 22, size: 1.1 },
    trees: 'pine',
    deco: { colors: [0xfff2a8, 0xa8e4ff, 0xffb8ec, 0xffffff], scale: 0.8, y: 0.3, count: 400 },
    landmarks: 'dog',
    signs: ['きらきらスタジアム', 'ナイトGP', '夜道に注意', '体当たり上等！', 'がんばれ〜！', 'ホネ注意！'],
    fans: ['husky', 'poodle', 'shiba', 'husky'],
  },
  cave: {
    sky: [0x0a0618, 0x2a1850],
    fog: 0x1a1033,
    hemi: [0x9a8cff, 0x3a2a66],
    sun: 0.6,
    sunColor: 0xb8a8ff,
    ground: ['#2b2442', 'rgba(120,90,200,0.25)', 'rgba(10,5,30,0.4)'],
    shoulder: 0x3a3058,
    mountains: { colors: [0x2f2648, 0x3a2f5a, 0x241c3a], count: 22, size: 1.1 },
    trees: 'crystal',
    deco: { colors: [0x7ff0ff, 0xff7fe6, 0x9dff9d, 0xffffff], scale: 0.8, y: 0.3, count: 500 },
    landmarks: 'dog',
    signs: ['ひんやり水晶の洞窟', '天井に注意！', 'コウモリ出没', '水晶がきれいワン', '体当たり上等！', 'がんばれ〜！'],
    fans: ['husky', 'poodle', 'shiba', 'corgi'],
    tunnel: { rock: 0x3c3358, rib: 0x6a5c9a, lamp: 0x9ff3ff, fog: 0x0d0820 },
  },
  subway: {
    sky: [0x10162e, 0x39446d],
    fog: 0x1b2240,
    hemi: [0xa8b8e8, 0x2a3050],
    sun: 0.7,
    sunColor: 0xc8d4ff,
    ground: ['#3b3f4f', 'rgba(255,255,255,0.08)', 'rgba(0,0,0,0.2)'],
    shoulder: 0x4a4f63,
    mountains: { colors: [0x2c3350, 0x353d5e, 0x262c48], count: 22, size: 1.0 },
    trees: 'building',
    deco: { colors: [0xffd27a, 0x7ad7ff, 0xff9ad5], scale: 0.7, y: 0.25, count: 360 },
    landmarks: 'dog',
    signs: ['ガタゴト地下鉄', '次は〜ホネ駅', '白線の内側をはしるワン', 'ドアに注意ワン', '体当たり上等！', 'がんばれ〜！'],
    fans: ['pug', 'husky', 'dachs', 'corgi'],
    tunnel: { rock: 0x6c7185, rib: 0x9aa1ba, lamp: 0xfff2b0, fog: 0x0b0e1a },
  },
  volcano: {
    sky: [0x3a0f10, 0xff8a3d],
    fog: 0x7a2a18,
    hemi: [0xffc9a0, 0x6a2a1a],
    sun: 1.2,
    sunColor: 0xffb070,
    ground: ['#4a2a22', 'rgba(255,110,40,0.25)', 'rgba(20,8,6,0.45)'],
    shoulder: 0x5a3326,
    mountains: { colors: [0x4a2a24, 0x5a3228, 0x3a201c], count: 22, size: 1.4, caps: true, capColor: 0xff6a1a },
    trees: 'rock',
    deco: { colors: [0xff6a1a, 0xffa21a, 0xff3d1a], scale: 3, y: 0.05, count: 260 },
    landmarks: 'dog',
    signs: ['ぐつぐつ火山', '溶岩に注意！', 'あっちっち！', '岩が落ちるワン', '体当たり上等！', 'がんばれ〜！'],
    fans: ['dachs', 'shiba', 'pug', 'husky'],
    tunnel: { rock: 0x4a2c26, rib: 0xff7a2e, lamp: 0xff9a4a, fog: 0x1a0805 },
  },
  desert: {
    sky: [0x2f9cff, 0xffe9b8],
    fog: 0xf3dcae,
    hemi: [0xfff4d8, 0xd9b36f],
    ground: ['#e8c680', 'rgba(255,240,200,0.35)', 'rgba(190,140,70,0.3)'],
    shoulder: 0xd9b36a,
    mountains: { colors: [0xd6a25a, 0xc9914a, 0xe0b46f], count: 22, size: 0.9 },
    trees: 'cactus',
    deco: { colors: [0xb88a4a, 0xa07838, 0xd9b36a], scale: 3, y: 0.05, count: 200 },
    landmarks: 'dog',
    signs: ['からから砂漠', 'ラクダ横断中', 'サボテン注意', 'あついワン…', '体当たり上等！', 'がんばれ〜！'],
    fans: ['pug', 'shiba', 'dachs', 'corgi'],
    tunnel: { rock: 0xc99a58, rib: 0xe6c080, lamp: 0xffe9a8, fog: 0x2a1c10 },
  },
  candy: {
    sky: [0xff9ad5, 0xfff0fa],
    fog: 0xffd6ee,
    hemi: [0xfff5fb, 0xffb3dc],
    ground: ['#bff0d4', 'rgba(255,150,200,0.35)', 'rgba(255,255,255,0.45)'],
    shoulder: 0x9fe3be,
    mountains: { colors: [0xff9ad5, 0x9ad7ff, 0xffe08a, 0xc5a8ff], count: 22, size: 1.0 },
    trees: 'lollipop',
    deco: { colors: [0xff6fae, 0xffd23f, 0x6fd0ff, 0x9be070, 0xb197fc], scale: 1, y: 0.4, count: 420 },
    landmarks: 'dog',
    signs: ['ふわふわおかしの国', 'あまいワン！', 'ソーダの川に注意', 'キャンディ工場', '体当たり上等！', 'がんばれ〜！'],
    fans: ['poodle', 'corgi', 'shiba', 'poodle'],
    tunnel: { rock: 0x6b4128, rib: 0xffd1e6, lamp: 0xffffff, fog: 0x2a1220 },
  },
  snow: {
    sky: [0x7fa8d8, 0xf2f7ff],
    fog: 0xe3edf8,
    hemi: [0xf0f6ff, 0xb9cbe0],
    ground: ['#f4f8ff', 'rgba(170,200,235,0.35)', 'rgba(255,255,255,0.7)'],
    shoulder: 0xdde8f5,
    mountains: { colors: [0x9fb4cf, 0x8ca3c2, 0xb4c6dc], count: 22, size: 1.25, caps: true },
    trees: 'pine',
    deco: { colors: [0xffffff, 0xeef5ff, 0xd8e8fa], scale: 3, y: 0, count: 220 },
    landmarks: 'snow',
    snowfall: true,
    signs: ['もこもこ雪山', 'カーブ連続！', '雪だるま注意', 'さむいワン…', '体当たり上等！', 'がんばれ〜！'],
    fans: ['husky', 'shiba', 'husky', 'dachs'],
  },
};

export class World {
  constructor(container, track, boxPos) {
    this.track = track;
    this.boxPos = boxPos;
    this.theme = THEMES[track.theme] || THEMES.meadow;
    const bb = track.bounds();
    this.bb = bb;
    this.center = { x: (bb.minX + bb.maxX) / 2, z: (bb.minZ + bb.maxZ) / 2 };
    const spanX = bb.maxX - bb.minX;
    const spanZ = bb.maxZ - bb.minZ;
    this.span = Math.max(spanX, spanZ); // コースの大きさ
    this.ringR = Math.max(430, Math.hypot(spanX, spanZ) / 2 + 150); // 遠くの山・雲を並べる半径
    this.dens = Math.min(2.6, Math.max(1, Math.sqrt(spanX * spanZ) / 410)); // 大きなコースほど背景を増やす
    this.disposables = [];
    this.container = container;

    // 画質: 端末に合わせて始め、重ければ render() で自動的に下げる（'high' のときは下げない）
    this.qualityPref = getQualityPref();
    this.lite = device.low || this.qualityPref === 'light'; // シーンの密度を下げる（木・雲・応援犬・天気の粒）
    const renderer = new THREE.WebGLRenderer({ antialias: this.qualityPref !== 'light', powerPreference: 'high-performance' });
    this.quality = 0;
    this._slowTime = 0;
    this._lastRender = 0;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = device.low ? THREE.BasicShadowMap : THREE.PCFShadowMap;
    renderer.domElement.className = 'game-canvas';
    container.append(renderer.domElement);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    this.scene = scene;
    const skyColor = new THREE.Color(this.theme.fog);
    scene.background = skyColor;
    scene.fog = new THREE.Fog(skyColor.clone(), 160, 520);

    this.camera = new THREE.PerspectiveCamera(62, 1, 0.3, 1200);

    // 光
    this.hemi = new THREE.HemisphereLight(this.theme.hemi[0], this.theme.hemi[1], 1.25);
    scene.add(this.hemi);
    const sun = new THREE.DirectionalLight(this.theme.sunColor || 0xfff4e0, this.theme.sun ?? 1.7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(device.shadowSize, device.shadowSize);
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
    this._buildWeather();

    this.setQualityLevel(this.startLevel());

    this._tun = 0; // トンネルの中の暗さ 0..1
    this._tunTarget = 0;
    this.karts = [];
    this.ensureKarts(2);
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
        uniforms: { top: { value: new THREE.Color(this.theme.sky[0]) }, bottom: { value: new THREE.Color(this.theme.sky[1]) } },
        vertexShader: 'varying vec3 vPos; void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vPos; void main(){ float h = clamp(normalize(vPos).y * 1.6 + 0.1, 0.0, 1.0); gl_FragColor = vec4(mix(bottom, top, h), 1.0); }',
      }),
    );
    this.sky = new THREE.Mesh(geo, mat);
    this.scene.add(this.sky);

    // 雲（白い球の集まり）
    const rnd = seeded(7);
    const cloudMat = this._track(new THREE.MeshToonMaterial({ color: 0xffffff }));
    this.cloudMat = cloudMat;
    const puff = this._track(new THREE.IcosahedronGeometry(1, 1));
    this.clouds = [];
    const rk = this.ringR / 430;
    this.cloudRange = 420 * rk;
    for (let i = 0; i < Math.round((this.lite ? 7 : 16) * Math.min(2, this.dens)); i++) {
      const g = new THREE.Group();
      const n = 3 + Math.floor(rnd() * 4);
      for (let j = 0; j < n; j++) {
        const m = new THREE.Mesh(puff, cloudMat);
        m.position.set(j * 5 - n * 2.5, rnd() * 2, rnd() * 4);
        m.scale.setScalar(4 + rnd() * 4);
        g.add(m);
      }
      const a = rnd() * Math.PI * 2;
      const r = (150 + rnd() * 250) * rk;
      g.position.set(this.center.x + Math.cos(a) * r, 70 + rnd() * 50, this.center.z + Math.sin(a) * r);
      g.userData.speed = 0.6 + rnd();
      this.scene.add(g);
      this.clouds.push(g);
    }

    // 遠くの山（海のコースでは小さな島、雪山では雪をかぶった山）
    const mountainGeo = this._track(new THREE.ConeGeometry(1, 1, 7));
    const mt = this.theme.mountains;
    const capMat = mt.caps ? this._track(new THREE.MeshToonMaterial({ color: mt.capColor || 0xffffff })) : null;
    const mCount = this.lite ? mt.count : Math.round(mt.count * Math.min(1.6, this.dens));
    for (let i = 0; i < mCount; i++) {
      const a = (i / mCount) * Math.PI * 2 + rnd() * 0.2;
      let r = this.ringR + rnd() * 80;
      const m = new THREE.Mesh(mountainGeo, this._track(new THREE.MeshToonMaterial({ color: mt.colors[i % mt.colors.length] })));
      const s = (60 + rnd() * 70) * mt.size * Math.min(2.2, this.ringR / 430);
      m.scale.set(s * 1.3, s, s * 1.3);
      // 山の裾がコースにかかると、壁のようにコースをふさぐ（当たり判定はない）ので、コースから十分離れるまで外側へずらす
      const base = s * 1.3 + this.track.wallDist + 12;
      for (let k = 0; k < 40; k++) {
        const x = this.center.x + Math.cos(a) * r;
        const z = this.center.z + Math.sin(a) * r;
        if (Math.abs(this.track.project(x, z).lat) > base) break;
        r += 25;
      }
      m.position.set(this.center.x + Math.cos(a) * r, s / 2 - 2, this.center.z + Math.sin(a) * r);
      this.scene.add(m);
      if (capMat) {
        const cap = new THREE.Mesh(mountainGeo, capMat);
        cap.scale.set(s * 1.3 * 0.42, s * 0.42, s * 1.3 * 0.42);
        cap.position.set(m.position.x, s - 2 - s * 0.21 + 0.3, m.position.z);
        this.scene.add(cap);
      }
    }
  }

  _buildGround() {
    const [base, dotA, dotB] = this.theme.ground;
    const tex = this._track(
      canvasTexture(256, 256, (x, w, h) => {
        x.fillStyle = base;
        x.fillRect(0, 0, w, h);
        const r = seeded(3);
        for (let i = 0; i < 900; i++) {
          x.fillStyle = r() < 0.5 ? dotA : dotB;
          x.fillRect(r() * w, r() * h, 2 + r() * 4, 2 + r() * 4);
        }
      }, { repeat: true }),
    );
    const mat = this._track(new THREE.MeshToonMaterial({ map: tex }));
    let ground;
    if (this.theme.ocean) {
      // 砂浜の島（楕円）と、まわりの海
      const bb = this.bb;
      this.island = { rx: (bb.maxX - bb.minX) / 2 + 95, rz: (bb.maxZ - bb.minZ) / 2 + 95 };
      tex.repeat.set(60 * Math.min(2.4, this.dens), 60 * Math.min(2.4, this.dens));
      ground = new THREE.Mesh(this._track(new THREE.CircleGeometry(1, 72)), mat);
      ground.scale.set(this.island.rx, this.island.rz, 1);
      // 波打ち際の白い縁
      const surf = new THREE.Mesh(this._track(new THREE.RingGeometry(1, 1.06, 72)), this._track(new THREE.MeshToonMaterial({ color: 0xffffff })));
      surf.rotation.x = -Math.PI / 2;
      surf.scale.set(this.island.rx, this.island.rz, 1);
      surf.position.set(this.center.x, -0.1, this.center.z);
      this.surf = surf;
      this.scene.add(surf);
      const sea = new THREE.Mesh(this._track(new THREE.PlaneGeometry(Math.max(2400, this.span * 2.4), Math.max(2400, this.span * 2.4))), this._track(new THREE.MeshToonMaterial({ color: 0x35b4e8 })));
      sea.rotation.x = -Math.PI / 2;
      sea.position.set(this.center.x, -0.4, this.center.z);
      sea.receiveShadow = true;
      this.scene.add(sea);
      ground.position.set(this.center.x, 0, this.center.z);
    } else {
      const gsize = Math.max(1400, this.span + 1000);
      tex.repeat.set((120 * gsize) / 1400, (120 * gsize) / 1400);
      ground = new THREE.Mesh(this._track(new THREE.PlaneGeometry(gsize, gsize)), mat);
      ground.position.set(this.center.x, 0, this.center.z);
    }
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
  }

  /** 背景を置ける地面の上か（海のコースでは島の中だけ） */
  _onLand(x, z, margin = 0) {
    if (!this.island) return true;
    const dx = (x - this.center.x) / (this.island.rx - margin);
    const dz = (z - this.center.z) / (this.island.rz - margin);
    return dx * dx + dz * dz < 1;
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
    const shoulderMat = this._track(new THREE.MeshToonMaterial({ color: this.theme.shoulder }));
    for (const side of [1, -1]) {
      const sh = new THREE.Mesh(this._ribbon(side * (t.roadHalf + 1.3), side * (t.wallDist + 0.3), 0.015, 8), shoulderMat);
      sh.receiveShadow = true;
      this.scene.add(sh);
    }

    // 壁: 丸いクッションブロックを並べる。画面外のかたまりを描かないよう 20 個ずつの InstancedMesh に分ける（影は落とさない）
    const blockGeo = this._track(new RoundedBoxGeometry(2.7, 1.2, 0.9, 1, 0.3));
    this._blockFar = this._track(new THREE.BoxGeometry(2.7, 1.2, 0.9)); // 遠くは四角いだけの形（三角形 12 個）にして軽くする
    this._blockNear = blockGeo;
    this.wallChunks = [];
    const blockMat = this._track(new THREE.MeshToonMaterial({ color: 0xffffff }));
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const one = new THREE.Vector3(1, 1, 1);
    const pos = new THREE.Vector3();
    const col = new THREE.Color();
    const wallColors = [0xffffff, 0xff7a8a, 0xffffff, 0x6fb6ff];
    const CHUNK = 20;
    for (const side of [1, -1]) {
      for (let i0 = 0; i0 < t.n; i0 += CHUNK) {
        const cnt = Math.min(CHUNK, t.n - i0);
        const blocks = new THREE.InstancedMesh(blockGeo, blockMat, cnt);
        blocks.receiveShadow = true;
        for (let j = 0; j < cnt; j++) {
          const i = i0 + j;
          const nx = t.tz[i];
          const nz = -t.tx[i];
          const d = t.wallDist + 0.45;
          q.setFromAxisAngle(up, Math.atan2(t.tx[i], t.tz[i]) + Math.PI / 2);
          m4.compose(pos.set(t.x[i] + nx * d * side, 0.6, t.z[i] + nz * d * side), q, one);
          blocks.setMatrixAt(j, m4);
          blocks.setColorAt(j, col.set(wallColors[Math.floor(i / 2) % wallColors.length]));
        }
        blocks.instanceMatrix.needsUpdate = true;
        blocks.computeBoundingSphere();
        this.scene.add(blocks);
        const mid = Math.min(t.n - 1, i0 + (cnt >> 1));
        this.wallChunks.push({ mesh: blocks, x: t.x[mid], z: t.z[mid], near: true });
      }
    }

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

    this._buildPads();
    this._buildTunnels();

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

  /** ブーストパッド: 路面に光る矢印（流れるようにアニメーションする） */
  _buildPads() {
    const tex = this._track(
      canvasTexture(128, 128, (x, w, h) => {
        const g = x.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, '#ff9f1c');
        g.addColorStop(1, '#ffd23f');
        x.fillStyle = g;
        x.fillRect(0, 0, w, h);
        // 進行方向（キャンバスの下）を向いた矢印
        x.fillStyle = '#ffffff';
        x.strokeStyle = '#d9480f';
        x.lineWidth = 5;
        x.beginPath();
        x.moveTo(w * 0.12, h * 0.1);
        x.lineTo(w * 0.5, h * 0.55);
        x.lineTo(w * 0.88, h * 0.1);
        x.lineTo(w * 0.88, h * 0.36);
        x.lineTo(w * 0.5, h * 0.88);
        x.lineTo(w * 0.12, h * 0.36);
        x.closePath();
        x.fill();
        x.stroke();
      }, { repeat: true }),
    );
    tex.repeat.set(1, 2);
    this.padTex = tex;
    const geo = this._track(new THREE.PlaneGeometry(PAD.WIDTH, PAD.LENGTH));
    const mat = this._track(new THREE.MeshBasicMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    const glowGeo = this._track(new THREE.PlaneGeometry(PAD.WIDTH + 1.2, PAD.LENGTH + 1.2));
    const glowMat = this._track(new THREE.MeshBasicMaterial({ color: 0xfff1a8, transparent: true, opacity: 0.55, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    for (const p of this.track.pads) {
      const g = new THREE.Group();
      g.position.set(p.x, 0.06, p.z);
      g.rotation.y = p.h;
      const glow = new THREE.Mesh(glowGeo, glowMat);
      glow.rotation.x = -Math.PI / 2;
      glow.position.y = -0.01;
      const pad = new THREE.Mesh(geo, mat);
      pad.rotation.x = -Math.PI / 2;
      pad.receiveShadow = true;
      g.add(glow, pad);
      this.scene.add(g);
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
    const th = this.theme;
    const bb = this.bb;
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();
    const col = new THREE.Color();
    const inArea = (pad) => [bb.minX - pad + rnd() * (bb.maxX - bb.minX + pad * 2), bb.minZ - pad + rnd() * (bb.maxZ - bb.minZ + pad * 2)];

    // 木（草原: 丸い木 / 海: ヤシの木 / 雪山: もみの木）
    const spots = [];
    const treeN = Math.round((this.lite ? 90 : 180) * this.dens);
    for (let tries = 0; tries < treeN * 20 && spots.length < treeN; tries++) {
      const [x, z] = inArea(100);
      if (!this._farFromTrack(x, z, 6) || !this._onLand(x, z, 8)) continue;
      if (spots.some(([a, b]) => (a - x) ** 2 + (b - z) ** 2 < 64)) continue;
      spots.push([x, z]);
    }
    // 背景は区画ごとに別のメッシュにする（見えない区画は描かれないので、大きなコースでも軽い）
    const cells = (list, size = 170) => {
      const m = new Map();
      for (const p of list) {
        const key = `${Math.floor(p[0] / size)},${Math.floor(p[1] / size)}`;
        if (!m.has(key)) m.set(key, []);
        m.get(key).push(p);
      }
      return [...m.values()];
    };
    const buildTrees = {
      palm: (g) => this._palmTrees(g, rnd),
      pine: (g) => this._pineTrees(g, rnd),
      crystal: (g) => this._crystals(g, rnd),
      building: (g) => this._buildings(g, rnd),
      rock: (g) => this._rocks(g, rnd),
      cactus: (g) => this._cacti(g, rnd),
      lollipop: (g) => this._lollipops(g, rnd),
    }[th.trees];
    for (const group of cells(spots)) {
      if (buildTrees) {
        buildTrees(group);
        continue;
      }
      const trunks = new THREE.InstancedMesh(this._track(new THREE.CylinderGeometry(0.5, 0.7, 3, 6)), this._track(new THREE.MeshToonMaterial({ color: 0x9a6a3a })), group.length);
      const crowns = new THREE.InstancedMesh(this._track(new THREE.IcosahedronGeometry(2.6, 0)), this._track(new THREE.MeshToonMaterial({ color: 0xffffff })), group.length * 2);
      trunks.castShadow = crowns.castShadow = true;
      const greens = th.leaves || [0x4cb944, 0x5fcf55, 0x3fa34d, 0x7ad35a, 0x9be070];
      group.forEach(([x, z], i) => {
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
    }

    // 小物（花 / 貝がら / 雪のかたまり）
    const deco = th.deco;
    const decoSpots = [];
    const decoN = Math.round(deco.count * this.dens * (this.lite ? 0.6 : 1));
    for (let tries = 0; tries < decoN * 8 && decoSpots.length < decoN; tries++) {
      const [x, z] = inArea(50);
      if (this._farFromTrack(x, z, 1.5 + deco.scale * 0.4) && this._onLand(x, z, 4)) decoSpots.push([x, z]);
    }
    const decoGeo = this._track(new THREE.IcosahedronGeometry(0.35, deco.scale > 1 ? 1 : 0));
    const decoMat = this._track(new THREE.MeshToonMaterial({ color: 0xffffff }));
    let di = 0;
    for (const group of cells(decoSpots, 220)) {
      const decos = new THREE.InstancedMesh(decoGeo, decoMat, group.length);
      group.forEach(([x, z], i) => {
        const sc = deco.scale * (0.6 + rnd() * 0.8);
        q.setFromAxisAngle(v.set(0, 1, 0), rnd() * 6);
        m4.compose(v.set(x, deco.y, z), q, s.set(sc, deco.scale > 1 ? sc * 0.55 : sc, sc));
        decos.setMatrixAt(i, m4);
        decos.setColorAt(i, col.set(deco.colors[di++ % deco.colors.length]));
      });
      decos.receiveShadow = true;
      scene.add(decos);
    }

    // 看板
    const signs = th.signs;
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
    const signN = Math.round(9 * this.dens);
    for (let i = 0; i < signN; i++) {
      const sPos = ((i + 0.55) / signN) * t.length;
      const side = i % 2 ? 1 : -1;
      const p = t.pointAt(sPos, side * (t.wallDist + 6));
      // 別の区間のコースに近すぎる場所には置かない
      if (!this._farFromTrack(p.x, p.z, 3)) continue;
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

    // 内側のランドマーク
    const places = [];
    const placeN = Math.round(4 * this.dens);
    for (let tries = 0; tries < 6000 && places.length < placeN; tries++) {
      const [x, z] = inArea(0);
      if (!this._farFromTrack(x, z, 18)) continue;
      // コースの内側だけに置く（どのコースも中心線の右側 = lat < 0 が内側）
      const p = t.project(x, z);
      if (p.lat > 0) continue;
      if (places.some(([a, b]) => (a - x) ** 2 + (b - z) ** 2 < 900)) continue;
      places.push([x, z]);
    }
    const builders = {
      dog: [() => this._dogHouse(), () => this._bigBone(), () => this._hydrant(), () => this._bowl()],
      beach: [() => this._sandCastle(), () => this._parasol(), () => this._beachBall(), () => this._parasol()],
      snow: [() => this._snowman(), () => this._igloo(), () => this._snowman(), () => this._bigBone()],
    }[th.landmarks];
    places.forEach(([x, z], i) => {
      const o = builders[i % builders.length]();
      o.position.set(x, 0, z);
      o.rotation.y = rnd() * Math.PI * 2;
      scene.add(o);
    });

    // 応援する犬たち（スタート付近の外側）
    this.fans = [];
    for (let i = 0; i < (this.lite ? 2 : 4); i++) {
      const p = t.pointAt(-20 + i * 12, -(t.wallDist + 4.5));
      const dog = buildDog(th.fans[i]);
      dog.group.position.set(p.x, 0, p.z);
      dog.group.rotation.y = Math.atan2(p.tz, -p.tx); // コースの方を向く
      dog.group.scale.setScalar(2.2);
      scene.add(dog.group);
      this.fans.push(dog);
    }
  }

  _palmTrees(spots, rnd) {
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();
    const col = new THREE.Color();
    const trunks = new THREE.InstancedMesh(this._track(new THREE.CylinderGeometry(0.35, 0.6, 9, 6).translate(0, 4.5, 0)), this._track(new THREE.MeshToonMaterial({ color: 0xb98a55 })), spots.length);
    const leafGeo = this._track(new THREE.BoxGeometry(0.9, 0.15, 5).translate(0, 0, 2.4));
    const leaves = new THREE.InstancedMesh(leafGeo, this._track(new THREE.MeshToonMaterial({ color: 0xffffff })), spots.length * 6);
    const nuts = new THREE.InstancedMesh(this._track(new THREE.SphereGeometry(0.45, 8, 6)), this._track(new THREE.MeshToonMaterial({ color: 0x7a4a24 })), spots.length * 2);
    trunks.castShadow = leaves.castShadow = true;
    spots.forEach(([x, z], i) => {
      const sc = 0.8 + rnd() * 0.5;
      const lean = (rnd() - 0.5) * 0.3;
      e.set(lean, rnd() * 6, 0, 'YXZ');
      q.setFromEuler(e);
      m4.compose(v.set(x, 0, z), q, s.set(sc, sc, sc));
      trunks.setMatrixAt(i, m4);
      const topX = x + Math.sin(lean) * 9 * sc * Math.sin(e.y);
      const topZ = z + Math.sin(lean) * 9 * sc * Math.cos(e.y);
      const topY = 9 * sc;
      for (let j = 0; j < 6; j++) {
        e.set(0.35 + rnd() * 0.2, (j / 6) * Math.PI * 2 + rnd() * 0.3, 0, 'YXZ');
        q.setFromEuler(e);
        m4.compose(v.set(topX, topY, topZ), q, s.set(sc, sc, sc));
        leaves.setMatrixAt(i * 6 + j, m4);
        leaves.setColorAt(i * 6 + j, col.set(j % 2 ? 0x3fae4f : 0x5fcf55));
      }
      for (let j = 0; j < 2; j++) {
        m4.compose(v.set(topX + (j ? 0.5 : -0.5), topY - 0.6, topZ), q.identity(), s.set(sc, sc, sc));
        nuts.setMatrixAt(i * 2 + j, m4);
      }
    });
    this.scene.add(trunks, leaves, nuts);
  }

  _pineTrees(spots, rnd) {
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();
    const col = new THREE.Color();
    const trunks = new THREE.InstancedMesh(this._track(new THREE.CylinderGeometry(0.4, 0.55, 2.4, 6)), this._track(new THREE.MeshToonMaterial({ color: 0x7a5232 })), spots.length);
    const cones = new THREE.InstancedMesh(this._track(new THREE.ConeGeometry(1, 1, 7)), this._track(new THREE.MeshToonMaterial({ color: 0xffffff })), spots.length * 4);
    trunks.castShadow = cones.castShadow = true;
    const greens = [0x2f7d4f, 0x3a8f5c, 0x276b45];
    spots.forEach(([x, z], i) => {
      const sc = 0.8 + rnd() * 0.7;
      q.setFromAxisAngle(v.set(0, 1, 0), rnd() * 6);
      m4.compose(v.set(x, 1.2 * sc, z), q, s.set(sc, sc, sc));
      trunks.setMatrixAt(i, m4);
      const green = greens[Math.floor(rnd() * greens.length)];
      // 3 段の葉と、てっぺんの雪
      [[3.2, 3.4, 3], [5.2, 2.6, 2.6], [7, 1.8, 2.2], [8.1, 0.9, 1.0]].forEach(([y, r, hgt], j) => {
        m4.compose(v.set(x, y * sc, z), q, s.set(r * sc, hgt * sc, r * sc));
        cones.setMatrixAt(i * 4 + j, m4);
        cones.setColorAt(i * 4 + j, col.set(j === 3 ? 0xffffff : green));
      });
    });
    this.scene.add(trunks, cones);
  }

  /** 洞窟: 光る水晶のかたまり（暗くても光って見えるよう、光の影響を受けない材質） */
  _crystals(spots, rnd) {
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const col = new THREE.Color();
    const mesh = new THREE.InstancedMesh(this._track(new THREE.ConeGeometry(0.9, 1, 5).translate(0, 0.5, 0)), this._track(new THREE.MeshBasicMaterial({ color: 0xffffff })), spots.length * 3);
    const colors = [0x7ff0ff, 0xff7fe6, 0x9dff9d, 0xb497ff];
    spots.forEach(([x, z], i) => {
      for (let j = 0; j < 3; j++) {
        const k = 0.8 + rnd() * 1.1;
        q.setFromEuler(e.set((rnd() - 0.5) * 0.5, rnd() * 6, (rnd() - 0.5) * 0.5));
        m4.compose(v.set(x + (rnd() - 0.5) * 4, 0, z + (rnd() - 0.5) * 4), q, sc.set(k * 1.2, (5 + rnd() * 9) * k, k * 1.2));
        mesh.setMatrixAt(i * 3 + j, m4);
        mesh.setColorAt(i * 3 + j, col.set(colors[(i + j) % colors.length]));
      }
    });
    this.scene.add(mesh);
  }

  /** 地下鉄: 街のビル（窓あかりのある四角い塔）。コースにかからない場所だけ */
  _buildings(spots, rnd) {
    spots = spots.filter(([x, z]) => this._farFromTrack(x, z, 22));
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const col = new THREE.Color();
    const tex = this._track(
      canvasTexture(64, 128, (x, w, h) => {
        x.fillStyle = '#ffffff';
        x.fillRect(0, 0, w, h);
        const r = seeded(5);
        for (let yy = 6; yy < h - 4; yy += 12) {
          for (let xx = 6; xx < w - 4; xx += 12) {
            x.fillStyle = r() < 0.45 ? '#ffe9a0' : '#5a6488';
            x.fillRect(xx, yy, 7, 7);
          }
        }
      }),
    );
    const mesh = new THREE.InstancedMesh(this._track(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)), this._track(new THREE.MeshToonMaterial({ map: tex })), spots.length);
    mesh.castShadow = true;
    const tints = [0xb8c4e8, 0xe8c4d8, 0xc4e8d8, 0xd8d8f0, 0xf0d8b0];
    spots.forEach(([x, z], i) => {
      q.setFromAxisAngle(v.set(0, 1, 0), rnd() * 6);
      m4.compose(v.set(x, 0, z), q, sc.set(12 + rnd() * 12, 25 + rnd() * 55, 12 + rnd() * 12));
      mesh.setMatrixAt(i, m4);
      mesh.setColorAt(i, col.set(tints[i % tints.length]));
    });
    this.scene.add(mesh);
  }

  /** 火山: 黒っぽい岩のとげ */
  _rocks(spots, rnd) {
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const col = new THREE.Color();
    const mesh = new THREE.InstancedMesh(this._track(new THREE.ConeGeometry(1, 1, 5).translate(0, 0.5, 0)), this._track(new THREE.MeshToonMaterial({ color: 0xffffff })), spots.length * 2);
    mesh.castShadow = true;
    const greys = [0x2a1a18, 0x3a2420, 0x4a2c26];
    spots.forEach(([x, z], i) => {
      for (let j = 0; j < 2; j++) {
        const k = 0.8 + rnd() * 0.9;
        q.setFromAxisAngle(v.set(0, 1, 0), rnd() * 6);
        m4.compose(v.set(x + j * 2.2, 0, z + j * 1.2), q, sc.set(3.4 * k, (7 + rnd() * 10) * k * (j ? 0.6 : 1), 3.4 * k));
        mesh.setMatrixAt(i * 2 + j, m4);
        mesh.setColorAt(i * 2 + j, col.set(greys[(i + j) % greys.length]));
      }
    });
    this.scene.add(mesh);
  }

  /** 砂漠: サボテン（幹と 2 本の腕を 1 つの形にまとめて並べる） */
  _cacti(spots, rnd) {
    const parts = [
      new THREE.CapsuleGeometry(0.85, 5, 2, 6).translate(0, 3.3, 0),
      new THREE.CylinderGeometry(0.45, 0.45, 1.8, 6).rotateZ(Math.PI / 2).translate(1.5, 3.2, 0),
      new THREE.CapsuleGeometry(0.5, 2.2, 2, 6).translate(2.3, 4.5, 0),
      new THREE.CylinderGeometry(0.45, 0.45, 1.6, 6).rotateZ(Math.PI / 2).translate(-1.4, 4.4, 0),
      new THREE.CapsuleGeometry(0.5, 1.8, 2, 6).translate(-2.1, 5.4, 0),
    ];
    const geo = this._track(mergeGeometries(parts.map((g) => g.toNonIndexed())));
    parts.forEach((g) => g.dispose());
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const col = new THREE.Color();
    const mesh = new THREE.InstancedMesh(geo, this._track(new THREE.MeshToonMaterial({ color: 0xffffff })), spots.length);
    mesh.castShadow = true;
    const greens = [0x4fae5a, 0x3f9a4f, 0x62bb62];
    spots.forEach(([x, z], i) => {
      const k = 0.8 + rnd() * 0.8;
      q.setFromAxisAngle(v.set(0, 1, 0), rnd() * 6);
      m4.compose(v.set(x, 0, z), q, sc.set(k, k, k));
      mesh.setMatrixAt(i, m4);
      mesh.setColorAt(i, col.set(greens[i % greens.length]));
    });
    this.scene.add(mesh);
  }

  /** おかしの国: ぺろぺろキャンディの木 */
  _lollipops(spots, rnd) {
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const col = new THREE.Color();
    const sticks = new THREE.InstancedMesh(this._track(new THREE.CylinderGeometry(0.28, 0.28, 7, 6).translate(0, 3.5, 0)), this._track(new THREE.MeshToonMaterial({ color: 0xfff6ee })), spots.length);
    const heads = new THREE.InstancedMesh(this._track(new THREE.SphereGeometry(2.4, 10, 6).scale(1, 1, 0.45)), this._track(new THREE.MeshToonMaterial({ color: 0xffffff })), spots.length);
    sticks.castShadow = heads.castShadow = true;
    const candy = [0xff6fae, 0xffd23f, 0x6fd0ff, 0x9be070, 0xb197fc, 0xff9a5a];
    spots.forEach(([x, z], i) => {
      const k = 0.8 + rnd() * 0.8;
      q.setFromAxisAngle(v.set(0, 1, 0), rnd() * 6);
      m4.compose(v.set(x, 0, z), q, sc.set(k, k, k));
      sticks.setMatrixAt(i, m4);
      m4.compose(v.set(x, 7.6 * k, z), q, sc.set(k, k, k));
      heads.setMatrixAt(i, m4);
      heads.setColorAt(i, col.set(candy[i % candy.length]));
    });
    this.scene.add(sticks, heads);
  }

  /**
   * トンネル: 半円形のアーチをコースに沿って並べた殻。外側は岩山、内側は暗くてランプが並ぶ。
   * 暗さ・霧は車がトンネルの中にいる間だけ _updateWeather で切り替える。
   */
  _buildTunnels() {
    const t = this.track;
    if (!t.tunnels.length) return;
    const st = this.theme.tunnel || { rock: 0x555566, rib: 0x8888aa, lamp: 0xfff2b0, fog: 0x0b0e1a };
    const W = t.wallDist + 2.2; // 内側の半幅
    const SIDE = 4.2; // まっすぐな側壁の高さ
    const H = 10.5; // 天井の高さ
    const M = 14;
    const ring = [[W, 0]];
    for (let j = 0; j <= M; j++) {
      const f = (j / M) * Math.PI;
      ring.push([Math.cos(f) * W, SIDE + Math.sin(f) * (H - SIDE)]);
    }
    ring.push([-W, 0]);
    const rc = ring.length;
    const rock = new THREE.Color(st.rock);
    const rib = new THREE.Color(st.rib);
    const STEP = 2; // 2 セグメントごと（約 5m）に 1 つのアーチ
    const pos = [];
    const colors = [];
    const idx = [];
    let rings = 0;
    for (const tn of t.tunnels) {
      let first = true;
      let prev = -1;
      for (let i = 0; i < t.n; i += STEP) {
        if (t.cum[i] < tn.a || t.cum[i] > tn.b) continue;
        const k = i;
        const p = (k - 1 + t.n) % t.n;
        let tx = t.tx[k] + t.tx[p];
        let tz = t.tz[k] + t.tz[p];
        const l = Math.hypot(tx, tz) || 1;
        tx /= l;
        tz /= l;
        const nx = tz;
        const nz = -tx;
        const c = rings % 4 === 0 || first ? rib : rock;
        for (const [lat, y] of ring) {
          pos.push(t.x[k] + nx * lat, y, t.z[k] + nz * lat);
          colors.push(c.r, c.g, c.b);
        }
        if (prev >= 0) {
          for (let j = 0; j < rc - 1; j++) {
            const a = prev * rc + j;
            const b = rings * rc + j;
            idx.push(a, b, a + 1, a + 1, b, b + 1);
          }
        }
        prev = rings;
        rings++;
        first = false;
      }
    }
    const geo = this._track(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, this._track(new THREE.MeshToonMaterial({ vertexColors: true, side: THREE.DoubleSide })));
    this.scene.add(mesh);

    // 天井と側壁のランプ（光の影響を受けない材質）
    const lampGeo = this._track(new THREE.BoxGeometry(2.4, 0.3, 0.9));
    const lampMat = this._track(new THREE.MeshBasicMaterial({ color: st.lamp }));
    const spots = [];
    for (const tn of t.tunnels) {
      for (let s = tn.a + 10; s < tn.b - 6; s += 22) {
        const c = t.pointAt(s, 0);
        spots.push({ x: c.x, y: H - 0.35, z: c.z, h: c.h, w: 1 });
        for (const side of [1, -1]) {
          const e = t.pointAt(s + 11, side * (W - 0.4));
          spots.push({ x: e.x, y: 3.3, z: e.z, h: e.h, w: 0.8, side: true });
        }
      }
    }
    const lamps = new THREE.InstancedMesh(lampGeo, lampMat, spots.length);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    spots.forEach((l, i) => {
      q.setFromAxisAngle(up, l.h);
      m4.compose(v.set(l.x, l.y, l.z), q, sc.set(l.side ? 0.35 : 1, l.side ? 4 : 1, l.side ? 0.5 : 1));
      lamps.setMatrixAt(i, m4);
    });
    lamps.instanceMatrix.needsUpdate = true;
    lamps.frustumCulled = false;
    this.scene.add(lamps);
  }

  _sandCastle() {
    const g = new THREE.Group();
    const sand = this._track(new THREE.MeshToonMaterial({ color: 0xe9c47e }));
    const flag = this._track(new THREE.MeshToonMaterial({ color: 0xff4d5e }));
    const base = new THREE.Mesh(this._track(new THREE.BoxGeometry(14, 5, 14)), sand);
    base.position.y = 2.5;
    g.add(base);
    for (const [x, z] of [[-7, -7], [7, -7], [-7, 7], [7, 7], [0, 0]]) {
      const big = x === 0;
      const tower = new THREE.Mesh(this._track(new THREE.CylinderGeometry(big ? 3.2 : 2.2, big ? 3.6 : 2.6, big ? 10 : 7.5, 12)), sand);
      tower.position.set(x, big ? 5 : 3.75, z);
      const roof = new THREE.Mesh(this._track(new THREE.ConeGeometry(big ? 3.8 : 2.8, big ? 4 : 3, 12)), sand);
      roof.position.set(x, (big ? 10 : 7.5) + (big ? 2 : 1.5), z);
      g.add(tower, roof);
      if (big) {
        const pole = new THREE.Mesh(this._track(new THREE.CylinderGeometry(0.1, 0.1, 4, 6)), this._track(new THREE.MeshToonMaterial({ color: 0xffffff })));
        pole.position.set(0, 16, 0);
        const f = new THREE.Mesh(this._track(new THREE.BoxGeometry(2, 1.2, 0.1)), flag);
        f.position.set(1, 17.3, 0);
        g.add(pole, f);
      }
    }
    g.traverse((o) => {
      o.castShadow = true;
      o.receiveShadow = true;
    });
    return g;
  }

  _parasol() {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(this._track(new THREE.CylinderGeometry(0.3, 0.3, 11, 8)), this._track(new THREE.MeshToonMaterial({ color: 0xffffff })));
    pole.position.y = 5.5;
    g.add(pole);
    const colors = [0xff4d5e, 0xffffff, 0x3d8bff, 0xffffff, 0xffd23f, 0xffffff, 0x22b573, 0xffffff];
    for (let i = 0; i < 8; i++) {
      const seg = new THREE.Mesh(this._track(new THREE.ConeGeometry(8, 3, 8, 1, true, (i / 8) * Math.PI * 2, Math.PI / 4)), this._track(new THREE.MeshToonMaterial({ color: colors[i], side: THREE.DoubleSide })));
      seg.position.y = 11.5;
      seg.castShadow = true;
      g.add(seg);
    }
    const towel = new THREE.Mesh(this._track(new THREE.BoxGeometry(5, 0.15, 9)), this._track(new THREE.MeshToonMaterial({ color: 0xff8fb1 })));
    towel.position.set(5, 0.1, 0);
    g.add(towel);
    return g;
  }

  _beachBall() {
    const g = new THREE.Group();
    const colors = [0xff4d5e, 0xffffff, 0x3d8bff, 0xffffff, 0xffd23f, 0xffffff];
    for (let i = 0; i < 6; i++) {
      const seg = new THREE.Mesh(this._track(new THREE.SphereGeometry(5, 16, 12, (i / 6) * Math.PI * 2, Math.PI / 3)), this._track(new THREE.MeshToonMaterial({ color: colors[i] })));
      seg.position.y = 5;
      seg.castShadow = true;
      g.add(seg);
    }
    g.rotation.z = 0.3;
    return g;
  }

  _snowman() {
    const g = new THREE.Group();
    const snow = this._track(new THREE.MeshToonMaterial({ color: 0xffffff }));
    const black = this._track(new THREE.MeshToonMaterial({ color: 0x2b2b33 }));
    for (const [y, r] of [[4, 4.5], [10.5, 3.2], [15.6, 2.4]]) {
      const b = new THREE.Mesh(this._track(new THREE.SphereGeometry(r, 18, 14)), snow);
      b.position.y = y;
      b.castShadow = true;
      g.add(b);
    }
    const nose = new THREE.Mesh(this._track(new THREE.ConeGeometry(0.45, 2.4, 8).rotateX(Math.PI / 2)), this._track(new THREE.MeshToonMaterial({ color: 0xff8a3d })));
    nose.position.set(0, 15.6, 3.2);
    g.add(nose);
    for (const sx of [-0.9, 0.9]) {
      const eye = new THREE.Mesh(this._track(new THREE.SphereGeometry(0.35, 8, 6)), black);
      eye.position.set(sx, 16.4, 2.1);
      g.add(eye);
    }
    const scarf = new THREE.Mesh(this._track(new THREE.TorusGeometry(2.5, 0.6, 8, 18)), this._track(new THREE.MeshToonMaterial({ color: 0xff4d5e })));
    scarf.rotation.x = Math.PI / 2;
    scarf.position.y = 13.4;
    const hat = new THREE.Mesh(this._track(new THREE.CylinderGeometry(1.6, 1.6, 2.6, 14)), black);
    hat.position.y = 18.6;
    const brim = new THREE.Mesh(this._track(new THREE.CylinderGeometry(2.5, 2.5, 0.3, 16)), black);
    brim.position.y = 17.4;
    g.add(scarf, hat, brim);
    return g;
  }

  _igloo() {
    const g = new THREE.Group();
    const ice = this._track(new THREE.MeshToonMaterial({ color: 0xf1f7ff }));
    const dome = new THREE.Mesh(this._track(new THREE.SphereGeometry(7, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2)), ice);
    const door = new THREE.Mesh(this._track(new THREE.CylinderGeometry(2.4, 2.4, 4, 14, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2)), ice);
    door.position.set(0, 0, 7);
    const hole = new THREE.Mesh(this._track(new THREE.CircleGeometry(1.8, 16, 0, Math.PI)), this._track(new THREE.MeshBasicMaterial({ color: 0x33415c })));
    hole.position.set(0, 0.05, 9.02);
    dome.castShadow = door.castShadow = true;
    g.add(dome, door, hole);
    return g;
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

    // ドッグフード（道に落ちている粒。取られると消えて、しばらくするとまた出る）
    const foods = this.track.foods;
    const kibble = this._track(new THREE.DodecahedronGeometry(0.62, 0).scale(1, 0.75, 1));
    this.foodMesh = new THREE.InstancedMesh(kibble, this._track(new THREE.MeshBasicMaterial({ color: 0xffffff })), foods.length);
    this.foodHalo = new THREE.InstancedMesh(
      this._track(new THREE.SphereGeometry(0.95, 8, 6)),
      this._track(new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.3, depthWrite: false })),
      foods.length,
    );
    const fcol = new THREE.Color();
    for (let i = 0; i < foods.length; i++) {
      this.foodMesh.setColorAt(i, fcol.set(i % 2 ? 0xd18a3a : 0xa45f1f));
      this.foodMesh.setMatrixAt(i, this._m0 || (this._m0 = new THREE.Matrix4().makeScale(0, 0, 0)));
      this.foodHalo.setMatrixAt(i, this._m0);
    }
    this.foodMesh.frustumCulled = this.foodHalo.frustumCulled = false;
    this.scene.add(this.foodMesh, this.foodHalo);
    this._foodShown = new Array(foods.length).fill(false);

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
    this.frisbeeViews = new Map();
    this._frisbeeParts = {
      disc: this._track(new THREE.CylinderGeometry(1.0, 1.0, 0.16, 20)),
      ring: this._track(new THREE.TorusGeometry(0.62, 0.07, 6, 18).rotateX(Math.PI / 2)),
      mat: this._track(new THREE.MeshToonMaterial({ color: 0x35c2ff })),
      ringMat: this._track(new THREE.MeshToonMaterial({ color: 0xffffff })),
    };
    this.bananaViews = new Map();
    // 犬小屋: 落下地点の目印（赤い輪）と、空から落ちてくる小屋
    this.houseViews = new Map();
    this._houseParts = {
      body: this._track(new THREE.BoxGeometry(4.2, 2.6, 4.6)),
      roof: this._track(new THREE.ConeGeometry(3.7, 2.2, 4).rotateY(Math.PI / 4)),
      door: this._track(new THREE.CircleGeometry(0.95, 14)),
      mark: this._track(new THREE.RingGeometry(0.82, 1, 28).rotateX(-Math.PI / 2)),
      bodyMat: this._track(new THREE.MeshToonMaterial({ color: 0xd9a066 })),
      roofMat: this._track(new THREE.MeshToonMaterial({ color: 0xd9433a })),
      doorMat: this._track(new THREE.MeshBasicMaterial({ color: 0x3a2412 })),
      markMat: this._track(new THREE.MeshBasicMaterial({ color: 0xff3b3b, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide })),
    };
    this._viewPool = { bone: [], banana: [], frisbee: [], house: [] };
  }

  _makeHouse() {
    const g = new THREE.Group();
    const p = this._houseParts;
    const mark = new THREE.Mesh(p.mark, p.markMat);
    mark.position.y = 0.15;
    mark.name = 'mark';
    const home = new THREE.Group();
    home.name = 'home';
    const body = new THREE.Mesh(p.body, p.bodyMat);
    body.position.y = 1.3;
    const roof = new THREE.Mesh(p.roof, p.roofMat);
    roof.position.y = 3.7;
    const door = new THREE.Mesh(p.door, p.doorMat);
    door.position.set(0, 1.1, 2.32);
    home.add(body, roof, door);
    home.traverse((o) => (o.castShadow = true));
    g.add(mark, home);
    return g;
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

  _makeFrisbee() {
    const g = new THREE.Group();
    const p = this._frisbeeParts;
    g.add(new THREE.Mesh(p.disc, p.mat));
    const r = new THREE.Mesh(p.ring, p.ringMat);
    r.position.y = 0.1;
    g.add(r);
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
    if (items.foods) this._updateFoods(items.foods, t);
    this._syncViews(items.proj.filter((p) => !p.f), this.projViews, 'bone', () => this._makeBone(), (v, p) => {
      v.position.set(p.x, 1.1, p.z);
      v.rotation.y = t * 18;
    });
    this._syncViews(items.proj.filter((p) => p.f), this.frisbeeViews, 'frisbee', () => this._makeFrisbee(), (v, p) => {
      v.position.set(p.x, 1.4 + Math.sin(t * 10 + p.id) * 0.1, p.z);
      v.rotation.set(0.12, t * 22, 0.12);
    });
    this._syncViews(items.houses || [], this.houseViews, 'house', () => this._makeHouse(), (v, h) => {
      const delay = ITEMS.HOUSE_DELAY;
      const mark = v.getObjectByName('mark');
      const home = v.getObjectByName('home');
      v.position.set(h.x, 0, h.z);
      if (h.age < delay) {
        // 落下地点は 1 位を追いかけ、近づくほど小さく濃く（落ちるタイミングが分かる）
        const f = h.age / delay;
        mark.visible = true;
        mark.scale.setScalar(ITEMS.HOUSE_RADIUS * (1 + 0.55 * (1 - f)) * (1 + Math.sin(t * 14) * 0.03)); // 落ちる瞬間に当たる範囲と一致
        home.position.y = 70 * (1 - f) * (1 - f);
        home.scale.set(1, 1, 1);
      } else {
        // 落ちたあとは地面で少しつぶれてから消える
        const g = h.age - delay;
        const squish = 1 - Math.exp(-g * 14);
        mark.visible = false;
        home.position.y = 0;
        const out = Math.max(0, Math.min(1, (ITEMS.HOUSE_STAY - g) / 0.3));
        const wide = 1 + 0.1 * Math.exp(-g * 8);
        home.scale.set(wide * out, (0.78 + 0.22 * squish) * out, wide * out);
      }
    });
    this._syncViews(items.bananas, this.bananaViews, 'banana', () => this._makeBanana(), (v, b) => {
      v.position.set(b.x, 0.35, b.z);
      v.rotation.y = b.id * 1.7;
    });
  }

  /** ドッグフード: 落ちているものだけ、くるくる回りながら少し浮く */
  _updateFoods(timers, t) {
    const foods = this.track.foods;
    const m4 = this._fm || (this._fm = new THREE.Matrix4());
    const q = this._fq || (this._fq = new THREE.Quaternion());
    const up = this._fup || (this._fup = new THREE.Vector3(0, 1, 0));
    const v = this._fv || (this._fv = new THREE.Vector3());
    const sc = this._fs || (this._fs = new THREE.Vector3());
    // 遠くのものは毎フレーム動かさない（軽量化）。カメラの近く（約 140m）だけ回す
    const cam = this.camera.position;
    for (let i = 0; i < foods.length; i++) {
      const f = foods[i];
      const taken = timers[i] > 0;
      const near = (f.x - cam.x) ** 2 + (f.z - cam.z) ** 2 < 140 * 140;
      if (taken) {
        if (this._foodShown[i]) {
          this.foodMesh.setMatrixAt(i, this._m0);
          this.foodHalo.setMatrixAt(i, this._m0);
          this._foodShown[i] = false;
          this._foodDirty = true;
        }
      } else if (near || !this._foodShown[i]) {
        q.setFromAxisAngle(up, t * 2.2 + i);
        const y = 0.95 + Math.sin(t * 3 + i * 0.7) * 0.16;
        // カメラのすぐ下にあるものは小さくして消す（画面いっぱいに大きく映らないように）
        const d = Math.hypot(f.x - cam.x, f.z - cam.z);
        const k = d < 10 ? Math.max(0.001, (d - 2.5) / 7.5) : 1;
        m4.compose(v.set(f.x, y, f.z), q, sc.set(k, k, k));
        this.foodMesh.setMatrixAt(i, m4);
        this.foodHalo.setMatrixAt(i, m4);
        this._foodShown[i] = true;
        this._foodDirty = true;
      }
    }
    if (this._foodDirty) {
      this.foodMesh.instanceMatrix.needsUpdate = true;
      this.foodHalo.instanceMatrix.needsUpdate = true;
      this._foodDirty = false;
    }
  }

  updateAmbient(dt) {
    // 空はカメラについてくる（大きなコースでも端に行かない）
    this.sky.position.copy(this.camera.position);
    this._tun += (this._tunTarget - this._tun) * Math.min(1, dt * 3.5);
    for (const c of this.clouds) {
      c.position.x += c.userData.speed * dt;
      if (c.position.x > this.center.x + this.cloudRange) c.position.x = this.center.x - this.cloudRange;
    }
    for (const f of this.fans) f.animate({ dt, speed: 6, steer: Math.sin(performance.now() / 600) * 0.5, spin: 0, boost: 0, bump: 0, mood: 1 });
    const tt = performance.now() / 1000;
    this.flags.forEach((f, i) => (f.rotation.y = Math.sin(tt * 3 + i) * 0.4));
    if (this.surf) this.surf.scale.set(this.island.rx * (1 + Math.sin(tt * 0.8) * 0.006), this.island.rz * (1 + Math.sin(tt * 0.8) * 0.006), 1);
    if (this.padTex) this.padTex.offset.y += dt * 1.2; // 矢印が進行方向へ流れる
    this._updateWeather(dt);
  }

  // ---- 天気: 豪雨（全コース）と、雪山の降雪 ----
  _buildWeather() {
    const box = { w: 90, h: 40 };
    this._wbox = box;
    const rnd = seeded(99);
    // 雨: 細い線を落とす。描く本数は雨の強さで変える
    const N = this.lite ? 450 : 900;
    this._drops = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) this._drops.set([(rnd() - 0.5) * box.w, rnd() * box.h, (rnd() - 0.5) * box.w], i * 3);
    const geo = this._track(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 6), 3).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    this.rainLines = new THREE.LineSegments(geo, this._track(new THREE.LineBasicMaterial({ color: 0xc4defc, transparent: true, opacity: 0.6, depthWrite: false })));
    this.rainLines.frustumCulled = false;
    this.rainLines.visible = false;
    this.scene.add(this.rainLines);
    // 雪: ゆっくり舞う点
    if (this.theme.snowfall) {
      const M = this.lite ? 350 : 700;
      this._flakes = new Float32Array(M * 3);
      for (let i = 0; i < M; i++) this._flakes.set([(rnd() - 0.5) * box.w * 1.4, rnd() * box.h, (rnd() - 0.5) * box.w * 1.4], i * 3);
      const fg = this._track(new THREE.BufferGeometry());
      fg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(M * 3), 3).setUsage(THREE.DynamicDrawUsage));
      this.snow = new THREE.Points(fg, this._track(new THREE.PointsMaterial({ color: 0xffffff, size: 0.45, transparent: true, opacity: 0.9, depthWrite: false })));
      this.snow.frustumCulled = false;
      this.scene.add(this.snow);
    }
    this._rain = 0;
    this._base = {
      fog: this.scene.fog.color.clone(),
      top: this.sky.material.uniforms.top.value.clone(),
      bottom: this.sky.material.uniforms.bottom.value.clone(),
      hemi: this.hemi.intensity,
      sun: this.sun.intensity,
    };
    this._gray = new THREE.Color(0x5d6578);
    this._tunFog = new THREE.Color((this.theme.tunnel || {}).fog ?? 0x0b0e1a);
  }

  /** 豪雨の強さ 0..1 */
  setRain(level) {
    this._rain = level;
  }

  _updateWeather(dt) {
    const cam = this.camera.position;
    const box = this._wbox;
    const level = this._rain;
    const b = this._base;
    // 空を暗くする
    const k = level * 0.6;
    const tun = this._tun;
    this.scene.fog.color.copy(b.fog).lerp(this._gray, k);
    if (tun > 0.002) this.scene.fog.color.lerp(this._tunFog, tun);
    this.scene.background.copy(this.scene.fog.color);
    // トンネルの中は霧が近く、暗くなる（遠くは闇に溶ける）
    this.scene.fog.near = 160 - tun * 140;
    this.scene.fog.far = 520 - tun * 300;
    this.sky.material.uniforms.top.value.copy(b.top).lerp(this._gray, k);
    this.sky.material.uniforms.bottom.value.copy(b.bottom).lerp(this._gray, k * 0.8);
    this.hemi.intensity = b.hemi * (1 - level * 0.3) * (1 - tun * 0.42);
    this.sun.intensity = b.sun * (1 - level * 0.55) * (1 - tun * 0.85);
    this.cloudMat.color.setScalar(1 - level * 0.45);

    this.rainLines.visible = level > 0.02 && tun < 0.6; // トンネルの中は雨が降らない
    if (this.rainLines.visible) {
      const d = this._drops;
      const n = Math.floor((d.length / 3) * Math.min(1, level));
      const pos = this.rainLines.geometry.attributes.position;
      const arr = pos.array;
      const fall = 70 * dt;
      for (let i = 0; i < n; i++) {
        const j = i * 3;
        d[j + 1] -= fall;
        if (d[j + 1] < 0) d[j + 1] += box.h;
        // カメラの周りの箱の中で、はみ出したら反対側へ
        const x = cam.x + ((((d[j] - cam.x) % box.w) + box.w * 1.5) % box.w) - box.w / 2;
        const z = cam.z + ((((d[j + 2] - cam.z) % box.w) + box.w * 1.5) % box.w) - box.w / 2;
        const y = d[j + 1];
        arr.set([x, y, z, x + 0.15, y + 1.8, z], i * 6);
      }
      pos.needsUpdate = true;
      this.rainLines.geometry.setDrawRange(0, n * 2);
      this.rainLines.material.opacity = 0.35 + level * 0.3;
    }
    if (this.snow) {
      const f = this._flakes;
      const pos = this.snow.geometry.attributes.position;
      const arr = pos.array;
      const t = performance.now() / 1000;
      const w = box.w * 1.4;
      for (let i = 0; i < f.length / 3; i++) {
        const j = i * 3;
        f[j + 1] -= (2.2 + (i % 5) * 0.4) * dt;
        if (f[j + 1] < 0) f[j + 1] += box.h;
        const x = cam.x + ((((f[j] - cam.x) % w) + w * 1.5) % w) - w / 2 + Math.sin(t + i) * 0.8;
        const z = cam.z + ((((f[j + 2] - cam.z) % w) + w * 1.5) % w) - w / 2;
        arr[j] = x;
        arr[j + 1] = f[j + 1];
        arr[j + 2] = z;
      }
      pos.needsUpdate = true;
    }
  }

  /** 近くの壁だけ丸い形、遠くは四角い形にする（見分けがつかない距離の三角形を減らす） */
  _lodWalls() {
    const cam = this.camera.position;
    for (const c of this.wallChunks) {
      const near = (c.x - cam.x) ** 2 + (c.z - cam.z) ** 2 < 100 * 100;
      if (near !== c.near) {
        c.near = near;
        c.mesh.geometry = near ? this._blockNear : this._blockFar;
      }
    }
  }

  /** 影を落とすライトを注目点に合わせて動かす */
  followSun(x, z) {
    this.sun.position.set(x + 40, 80, z + 25);
    this.sun.target.position.set(x, 0, z);
    // 見ている車がトンネルの中（入口の少し手前から）なら暗くする
    if (this.track.tunnels.length) this._tunTarget = this.track.inTunnel(this.track.project(x, z).s, 8) ? 1 : 0;
  }

  /** 車の見た目を必要な台数だけ用意する（NPC の数はスナップショットで決まる） */
  ensureKarts(styles) {
    while (this.karts.length < styles.length) {
      const k = new KartView(styles[this.karts.length]); // 見た目の番号（6 = ボス犬）
      this.scene.add(k.group, k.blob);
      this.karts.push(k);
    }
  }

  /** 画質の段階: 0 = 端末の上限の解像度＋影 / 1 = 解像度 1 / 2 = 影なし / 3 = 解像度 0.75 / 4 = 解像度 0.6 */
  setQualityLevel(level) {
    this.quality = level;
    const cap = this.qualityPref === 'high' ? 2 : device.maxPixelRatio; // 高画質を選んだときは端末の標準より細かく描く
    const dpr = window.devicePixelRatio || 1;
    const pr = [Math.min(dpr, cap), Math.min(dpr, cap, 1), Math.min(dpr, 1), 0.75, 0.6][level];
    this.pixelRatio = pr;
    this.renderer.setPixelRatio(pr);
    this.sun.castShadow = level < 2;
    this.resize();
  }

  /** 画質の設定を切り替える（'auto' / 'high' / 'light'）。設定は端末に保存する */
  setQualityPref(pref) {
    this.qualityPref = pref;
    setQualityPref(pref);
    this._slowTime = 0;
    this.setQualityLevel(this.startLevel());
  }

  /** 最初の画質: スマホ・タブレットは影なしから（影は重いので、余裕があれば「高」で戻せる） */
  startLevel() {
    if (this.qualityPref === 'light') return 2;
    if (this.qualityPref === 'high') return 0;
    return device.low ? 2 : 0;
  }

  /** 描画が重い端末では画質を段階的に下げる */
  _adaptQuality() {
    const t = performance.now();
    const ft = this._lastRender ? t - this._lastRender : 16;
    this._lastRender = t;
    if (ft > 200) return; // タブ切り替え直後などは数えない
    if (this.qualityPref === 'high') return;
    this._ft = this._ft ? this._ft * 0.95 + ft * 0.05 : ft;
    if (this._ft > 24 && this.quality < 4) this._slowTime += ft;
    else this._slowTime = Math.max(0, this._slowTime - ft * 0.5);
    if (this._slowTime > 1500) {
      this._slowTime = 0;
      this._ft = 16; // 変えた直後の様子を見直す
      this.setQualityLevel(this.quality + 1);
    }
  }

  render() {
    this._adaptQuality();
    if (((this._lodTick = (this._lodTick | 0) + 1) & 7) === 1) this._lodWalls();
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
