// いぬいぬゴム鉄砲バトルの数値（ゲームの手ざわりはここで調整する）
// 長さの単位は「犬の背の高さ = 1」（立った犬の高さ 1、伏せると 0.55）。人間の家の家具は、犬から見た大きさで置く。

export const ROUND = {
  COUNT: 3, // ラウンド数
  TIME: 405, // 1 ラウンドの長さ（秒）。6 分 45 秒
  PICK: 12, // ラウンドの前に武器を選ぶ時間（全員が選んだら早く進む）
  INTRO: 3, // 始まる前の 3・2・1
  END: 4, // ラウンドの終わりの結果表示
};

export const PLAYER = {
  RADIUS: 0.35, // ぶつかる太さ（半径）
  HEIGHT: 1.25, // 立っている高さ（2026-11-13 に 1.0 → 1.25）
  CROUCH_HEIGHT: 0.66, // 伏せの高さ（テーブルの下・トンネルをくぐれる）
  EYE: 1.06, // 目の高さ
  CROUCH_EYE: 0.52,
  HEAD: 0.74, // 体の高さのこの割合より上に当たったら頭（ヘッドショット）
  SPEED: 5.2, // 歩く速さ
  CROUCH_SPEED: 2.3,
  ACCEL: 40, // 速さが変わる速さ（地上）
  AIR_ACCEL: 12,
  // 走る（ゲージ式）: Shift を押している間、ゲージがあるだけ速く走れる。離して少しすると回復
  SPRINT_SPEED: 8.8,
  STAMINA: 100, // ゲージの最大
  STAMINA_DRAIN: 30, // 走っている間 1 秒に減る量（約 3.3 秒走れる）
  STAMINA_REGEN: 22, // 回復する量（1 秒に）
  STAMINA_WAIT: 0.8, // 走るのをやめてから回復が始まるまで
  STAMINA_MIN: 15, // 走り始めるのに要る量（空になった直後にすぐ走り出せないように）
  JUMP: 7.4, // ジャンプの初速（約 1.25 の高さまで。ソファの座面に乗れる）
  GRAVITY: 22,
  STEP: 0.5, // これより低い段差は歩いて上がれる（ラグ・クッション・犬のベッド）
  PUSH_SPEED: 2.4, // 押せるもの（段ボールなど）を押して進む速さ（ズルズル）
  HP: 100,
  REGEN: 1, // 生きている間、1 秒に回復する体力
  RESPAWN: 3, // 倒れてから復活するまで（秒）
  INVINCIBLE: 2, // 復活してから無敵の時間
  STUN: 0.3, // 当てられてよろける時間
  STUN_SPEED: 0.35, // よろけている間の速さの割合
  KNOCK: 4.5, // 当てられたときに押される速さ
  HIT_RADIUS: 0.55, // 輪ゴムが当たる太さ（半径。少し太めにして当てやすく）
};

export const GUN = {
  AMMO: 10, // 1 回に撃てる数
  RELOAD: 1.5, // 撃ち切ってから補充まで
  FIRE_GAP: 0.18, // 連射の間隔
  SPEED: 50.4, // 輪ゴムの速さ
  BOUNCES: 1, // ふつうの輪ゴムも 1 回だけ跳ね返る
  GRAVITY: 2.5, // ほんの少し落ちる（ほぼ狙ったとおりに飛ぶ）
  LIFE: 1.8, // 飛んでいられる時間（約 90 先まで）
  RADIUS: 0.08,
  MUZZLE: 0.55, // 目から銃口までの距離
};

/** アイテム（0 = なし） */
export const ITEM = {
  NONE: 0,
  THICK: 1, // 極太ゴム
  TRIPLE: 2, // 3 方向ゴム
  BOUNCE: 3, // 跳ね返りゴム
  HOMING: 4, // 追いかけゴム
  SMOKE: 5, // 煙幕
  SHAKE: 6, // 照準ぶれ
  NOAMMO: 7, // ゴム切れ
  GUM: 8, // ネバネバガム
  HEAL: 9, // 回復のおやつ
  STAR: 10, // 無敵スター
  COUNT: 11, // プレゼント箱から出る種類の数（ここまで）
  GOLD: 11, // 金の輪ゴム（空からの補給箱の中身。箱からは出ない）
};

/** ゴムが変わるアイテム → 撃つ輪ゴムの種類 */
export const BAND_ITEMS = [ITEM.THICK, ITEM.TRIPLE, ITEM.BOUNCE, ITEM.HOMING];
/** プレゼント箱から出るアイテム（回復は箱からは出ない。会場に落ちているおやつを拾う） */
export const BOX_ITEMS = Array.from({ length: ITEM.COUNT - 1 }, (_, k) => k + 1).filter((it) => it !== ITEM.HEAL);

/**
 * お楽しみの仕組み（2026-11-13）
 * - ラストスパート: 各ラウンドの残り SPURT 秒は、入る点が 2 倍
 * - 連続撃破: 死なずに続けて倒すと、STREAK_BONUS の数のときにおまけの点
 * - リベンジ: 自分を倒した相手を倒し返すと +REVENGE_BONUS
 * - トランポリン: 乗ると TRAMP_V の速さで上へ跳ねる
 * - 補給箱: ラウンドの DROP_FIRST 秒から、取られて DROP_EVERY 秒ごとに空から落ちてくる。中身は金の輪ゴム（次の GOLD_SHOTS 発がダメージ 2 倍）
 * - 突風: ときどき WIND_TIME 秒、横風が吹いて輪ゴム・爆弾・毛玉が流される
 * - スライディング: 走っている間に伏せを押すと、低い姿勢で前へ滑りこむ（ゲージを使う）
 * - 遠吠え: V で「ワン！」（吹き出しと声。BARK_CD 秒に 1 回）
 */
export const FUN = {
  SPURT: 30,
  STREAK_BONUS: { 3: 2, 5: 3, 7: 4 },
  REVENGE_BONUS: 3,
  TRAMP_V: 13,
  DROP_FIRST: 35,
  DROP_EVERY: 55,
  DROP_HEIGHT: 26,
  DROP_FALL: 3.2, // 落ちる速さ（パラシュート）
  DROP_RADIUS: 1.3, // これより近づくと取れる
  GOLD_SHOTS: 3,
  GOLD_MUL: 2,
  WIND_FIRST: 50,
  WIND_EVERY: [55, 85],
  WIND_TIME: 15,
  WIND_ACC: 7, // 横風の強さ（輪ゴムが 1 秒に流される速さの増え方）
  SLIDE_TIME: 0.65,
  SLIDE_SPEED: 12,
  SLIDE_CD: 1.2,
  SLIDE_STAM: 20,
  BARK_CD: 2.5,
};

export const ITEMS = {
  BOX_RESPAWN: 10, // 箱を取ってから次が出るまで
  BOX_RADIUS: 0.8, // これより近づくと取れる
  SPECIAL_SHOTS: 5, // ゴムが変わるアイテムは次の 5 発
  THICK_SPEED: 37.8,
  THICK_RADIUS: 0.22,
  THICK_DAMAGE: 2,
  TRIPLE_SPREAD: 0.14, // 3 方向の開き（ラジアン）
  BOUNCES: 3,
  BOUNCE_LIFE: 2.6,
  HOMING_TURN: 3.2, // 追いかけゴムの曲がる速さ（ラジアン/秒）
  HOMING_CONE: 0.9, // 進む向きからこの角度（ラジアン）以内の相手を追う
  HOMING_RANGE: 30,
  SMOKE_RANGE: 18, // 煙幕を投げられる距離
  SMOKE_RADIUS: 3.2,
  SMOKE_TIME: 6,
  SHAKE_TIME: 3,
  NOAMMO_TIME: 3,
  GUM_TIME: 25, // 置いたガムが残る時間
  GUM_RADIUS: 0.6,
  GUM_STUCK: 2, // 踏むと動けない時間
  HEAL: 40, // 回復する体力
  STAR_TIME: 10, // 無敵の時間
};

/** 回復のおやつ（会場に落ちている。拾うと体力が戻る。拾ったあとしばらくするとまた出る） */
export const TREAT = { HEAL: 40, RESPAWN: 20, RADIUS: 0.9, COUNT: 8 };

export const SCORE = {
  DMG_PER_POINT: 10, // 相手に与えたダメージ 10 ごとに 1 点
  KILL: 3,
};

export const BOT = {
  MAX: 5,
  VIEW: 48, // 見える距離
  AIM_ERROR: 0.2, // 狙いのぶれ（ラジアン）
  REACT: 1.0, // 相手を見つけてから撃ち始めるまで
  FIRE_GAP: 0.7, // CPU の連射の間隔（人より遅い）
  TURN: 2.4, // 向きを変える速さ（ラジアン/秒）
  LEAD: 0.5, // 相手の動きを読む割合（1 = ぴったり）
};

export const ITEM_INFO = {
  [ITEM.THICK]: { name: '極太ゴム', icon: 'thick', desc: '次の5発が太くて当たりやすく、ダメージ1.6倍' },
  [ITEM.TRIPLE]: { name: '3方向ゴム', icon: 'triple', desc: '次の5発が、扇の形に3本ずつ飛ぶ' },
  [ITEM.BOUNCE]: { name: '跳ね返りゴム', icon: 'bounce', desc: '次の5発が、壁や家具で3回まで跳ね返る' },
  [ITEM.HOMING]: { name: '追いかけゴム', icon: 'target', desc: '次の5発が、狙った近くの相手へゆるく曲がる' },
  [ITEM.SMOKE]: { name: '煙幕', icon: 'cloud', desc: '狙った所に煙を投げる。中は見えない' },
  [ITEM.SHAKE]: { name: '照準ぶれ', icon: 'spiral', desc: '自分以外の全員の狙いが3秒ゆらゆら' },
  [ITEM.NOAMMO]: { name: 'ゴム切れ', icon: 'scissors', desc: '自分以外の全員が3秒撃てない' },
  [ITEM.GUM]: { name: 'ネバネバガム', icon: 'candy', desc: '足もとに置く罠。踏んだ相手は2秒動けない' },
  [ITEM.HEAL]: { name: '回復おやつ', icon: 'heal', desc: '体力が40回復する' },
  [ITEM.STAR]: { name: '無敵スター', icon: 'star', desc: '10秒間、輪ゴムもガムも効かない' },
  [ITEM.GOLD]: { name: '金の輪ゴム', icon: 'crown', desc: '空からの補給箱の中身。次の3発がダメージ2倍' },
};

/**
 * 武器（ラウンドの前の選択画面で選ぶ）
 * ダメージは距離で決まる: dmg = [近い, 遠い]、fall = [この距離まで「近い」, この距離から「遠い」]（間はなめらかに）
 * ふつうの鉄砲は近いほど強く、スナイパーは遠いほど強い。爆弾は爆発の中心からの距離（blast = 半径）
 */
export const WEAPON = { NORMAL: 0, SNIPER: 1, RIFLE: 2, BOMB: 3 }; // BOMB は武器ではなく、全員が持つ爆弾（輪ゴムの種類として使う）
export const WEAPONS = {
  [WEAPON.NORMAL]: { name: '輪ゴム鉄砲', desc: '10発ずつ。連射がきく。近いほど痛い（14〜6）', ammo: 10, reload: 1.5, gap: 0.18, speed: 50.4, gravity: 2.5, dmg: [14, 6], fall: [8, 40], r: 0.08, life: 1.8 },
  [WEAPON.SNIPER]: { name: 'スナイパー', desc: '5発ずつ。まっすぐ飛ぶ。遠いほど痛い（30〜60）。のぞくと拡大', ammo: 5, reload: 2.4, gap: 1.0, speed: 72, gravity: 0.3, dmg: [30, 60], fall: [10, 45], r: 0.06, life: 1.6, zoomFov: 24 },
  // ライフル: どんな距離でも当たれば一撃（体力 100 ぶん）。1 発しか込められず、補充はスナイパーより少し長い
  [WEAPON.RIFLE]: { name: 'ライフル', desc: '1発ずつ。どんな距離でも、当たれば一撃で倒す。1発ごとに3秒かけて補充。のぞくと拡大', ammo: 1, reload: 3.0, gap: 0.3, speed: 90, gravity: 0.2, dmg: [100, 100], fall: [0, 1], r: 0.05, life: 1.3, zoomFov: 20 },
  // 爆弾（全員が 1 ラウンドに BOMB_COUNT 回まで投げられる。G キー）
  [WEAPON.BOMB]: { name: '爆弾', desc: '山なりに投げて、何かに当たると爆発。まわりの相手まとめて（中心36〜はじ8）', gap: 0.9, speed: 19, gravity: 15, dmg: [36, 8], blast: 3.5, r: 0.2, life: 3.2 },
};
/** ラウンドの前に選べる武器 */
export const WEAPON_LIST = [WEAPON.NORMAL, WEAPON.SNIPER, WEAPON.RIFLE];
/** 爆弾: 1 ラウンドに投げられる数（全員） */
export const BOMB_COUNT = 5;
/** ヘッドショット（頭に当たった）: スナイパーは体力の 8 割（80）、ほかの鉄砲はいつもより 15% 多い。ライフルは頭でなくても一撃 */
export const HEADSHOT = { SNIPER_RATE: 0.8, MUL: 1.15 };
/** 極太ゴムのダメージの倍率 */
export const THICK_MUL = 1.6;

/** CPU の犬（番号の順。準備画面のチーム分けにも名前を出す） */
export const BOT_DOGS = [
  { kind: 'chihuahua', name: 'チワワ', css: '#ffb703' },
  { kind: 'dachs', name: 'ダックス', css: '#8338ec' },
  { kind: 'husky', name: 'ハスキー', css: '#06d6a0' },
  { kind: 'beagle', name: 'ビーグル', css: '#fb8500' },
  { kind: 'golden', name: 'ゴールデン', css: '#8d99ae' },
];

/** 遊び方 */
export const MODE = { FFA: 'ffa', TEAM: 'team', BOSS: 'boss' };

/** チーム戦のチーム（番号の偶数・奇数で 2 チーム。人と CPU を交互に並べるので人数がそろう） */
export const TEAMS = [
  { name: 'あかチーム', css: '#e04f3a', hex: 0xe04f3a },
  { name: 'あおチーム', css: '#2f6fe0', hex: 0x2f6fe0 },
];
export const teamOf = (mode, i) => (mode === MODE.TEAM ? i % 2 : -1);

/**
 * チームの組み方（準備画面の設定 teams）: -1 = 自動（交互）。0 以上はビット: 0〜3 = 人の席 0〜3、4〜 = CPU 1 匹目〜。1 = あお、0 = あか
 */
export const TEAM_AUTO = -1;
export const TEAM_CPU_BIT = 4;

/**
 * 試合の番号ごとのチーム（人 = slots の順、そのあと CPU nBots 匹）。チーム戦でなければ全員 -1。
 * 片方のチームがだれもいないときは、自動（交互）にもどす（撃ち合えないので）
 */
export function teamList(mode, teams, slots, nBots) {
  const n = slots.length + nBots;
  if (mode !== MODE.TEAM) return Array(n).fill(-1);
  const auto = Array.from({ length: n }, (_, i) => i % 2);
  if (!Number.isInteger(teams) || teams < 0) return auto;
  const list = [...slots.map((slot) => (teams >> slot) & 1), ...Array.from({ length: nBots }, (_, k) => (teams >> (TEAM_CPU_BIT + k)) & 1)];
  return list.includes(0) && list.includes(1) ? list : auto;
}

/** 自動（交互）の組み方をビットにしたもの（準備画面で 1 匹ずつ切り替えるときの元） */
export function autoTeamBits(slots, nBots) {
  let m = 0;
  slots.forEach((slot, j) => (m |= (j % 2) << slot));
  for (let k = 0; k < nBots; k++) m |= ((slots.length + k) % 2) << (TEAM_CPU_BIT + k);
  return m;
}

/** ボス戦: でけぇ猫 */
export const BOSS = {
  NAME: 'でけぇ猫',
  HP_BASE: 600, // 体力 = HP_BASE + HP_PER × 人数（CPU も入れた全員）× ラウンドの倍率
  HP_PER: 800,
  ROUND_MUL: [1, 1.2, 1.4],
  RADIUS: 2.1, // ぶつかる太さ
  HIT_RADIUS: 2.3, // 輪ゴムが当たる太さ
  HEIGHT: 3.6,
  SPEED: 4.2,
  TURN: 3,
  SWIPE_RANGE: 3.9, // ひっかきが届く距離
  SWIPE_WIND: 0.55, // 前ぶり（よけられる）
  SWIPE_DMG: 25,
  POUNCE_EVERY: [4, 7], // とびかかりの間隔（秒）
  POUNCE_WIND: 0.7,
  POUNCE_TIME: 0.9,
  POUNCE_RADIUS: 3.8,
  POUNCE_DMG: 25,
  SPIT_EVERY: [2.6, 4.5], // 毛玉を吐く間隔
  SPIT_SPEED: 20,
  SPIT_RADIUS: 0.35,
  SPIT_DMG: 12,
  KILL_BONUS: 5, // とどめを刺した人
  DIZZY: 3, // 照準ぶれ・ゴム切れを使われると、ふらふらで攻撃しない
  STUCK: 2, // ガムを踏むと動けない
};
/** 毛玉（猫が吐く玉）の種類の番号（輪ゴムの種類と同じ並びで扱う） */
export const HAIRBALL = 20;
