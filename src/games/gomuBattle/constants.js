// いぬいぬゴム鉄砲バトルの数値（ゲームの手ざわりはここで調整する）
// 長さの単位は「犬の背の高さ = 1」（立った犬の高さ 1、伏せると 0.55）。人間の家の家具は、犬から見た大きさで置く。

export const ROUND = {
  COUNT: 3, // ラウンド数
  TIME: 360, // 1 ラウンドの長さ（秒）
  INTRO: 3, // 始まる前の 3・2・1
  END: 4, // ラウンドの終わりの結果表示
};

export const PLAYER = {
  RADIUS: 0.35, // ぶつかる太さ（半径）
  HEIGHT: 1.0, // 立っている高さ
  CROUCH_HEIGHT: 0.55, // 伏せの高さ（テーブルの下をくぐれる）
  EYE: 0.85, // 目の高さ
  CROUCH_EYE: 0.42,
  SPEED: 5.2, // 歩く速さ
  CROUCH_SPEED: 2.3,
  ACCEL: 40, // 速さが変わる速さ（地上）
  AIR_ACCEL: 12,
  DASH_SPEED: 12,
  DASH_TIME: 0.28,
  DASH_COOLDOWN: 2.2,
  JUMP: 7.4, // ジャンプの初速（約 1.25 の高さまで。ソファの座面に乗れる）
  GRAVITY: 22,
  STEP: 0.5, // これより低い段差は歩いて上がれる（ラグ・クッション・犬のベッド）
  PUSH_SPEED: 2.4, // 押せるもの（段ボールなど）を押して進む速さ（ズルズル）
  HP: 5,
  RESPAWN: 3, // 倒れてから復活するまで（秒）
  INVINCIBLE: 2, // 復活してから無敵の時間
  STUN: 0.3, // 当てられてよろける時間
  STUN_SPEED: 0.35, // よろけている間の速さの割合
  KNOCK: 4.5, // 当てられたときに押される速さ
  HIT_RADIUS: 0.55, // 輪ゴムが当たる太さ（半径。少し太めにして当てやすく）
};

export const GUN = {
  AMMO: 5, // 1 回に撃てる数
  RELOAD: 1.5, // 撃ち切ってから補充まで
  FIRE_GAP: 0.18, // 連射の間隔
  SPEED: 28, // 輪ゴムの速さ
  GRAVITY: 2.5, // ほんの少し落ちる（ほぼ狙ったとおりに飛ぶ）
  LIFE: 1.8, // 飛んでいられる時間（約 50 先まで）
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
  COUNT: 11,
};

/** ゴムが変わるアイテム → 撃つ輪ゴムの種類 */
export const BAND_ITEMS = [ITEM.THICK, ITEM.TRIPLE, ITEM.BOUNCE, ITEM.HOMING];

export const ITEMS = {
  BOX_RESPAWN: 10, // 箱を取ってから次が出るまで
  BOX_RADIUS: 0.8, // これより近づくと取れる
  SPECIAL_SHOTS: 5, // ゴムが変わるアイテムは次の 5 発
  THICK_SPEED: 21,
  THICK_RADIUS: 0.22,
  THICK_DAMAGE: 2,
  TRIPLE_SPREAD: 0.14, // 3 方向の開き（ラジアン）
  BOUNCES: 2,
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
  HEAL: 3, // 回復する体力
  STAR_TIME: 10, // 無敵の時間
};

export const SCORE = {
  HIT: 1,
  KILL: 3,
};

export const BOT = {
  MAX: 5,
  VIEW: 40, // 見える距離
  AIM_ERROR: 0.2, // 狙いのぶれ（ラジアン）
  REACT: 1.0, // 相手を見つけてから撃ち始めるまで
  FIRE_GAP: 0.7, // CPU の連射の間隔（人より遅い）
  TURN: 2.4, // 向きを変える速さ（ラジアン/秒）
  LEAD: 0.5, // 相手の動きを読む割合（1 = ぴったり）
};

export const ITEM_INFO = {
  [ITEM.THICK]: { name: '極太ゴム', icon: '💪', desc: '次の5発が太くて当たりやすい。当たると2ダメージ' },
  [ITEM.TRIPLE]: { name: '3方向ゴム', icon: '🔱', desc: '次の5発が、扇の形に3本ずつ飛ぶ' },
  [ITEM.BOUNCE]: { name: '跳ね返りゴム', icon: '🏓', desc: '次の5発が、壁や家具で2回まで跳ね返る' },
  [ITEM.HOMING]: { name: '追いかけゴム', icon: '🎯', desc: '次の5発が、狙った近くの相手へゆるく曲がる' },
  [ITEM.SMOKE]: { name: '煙幕', icon: '💨', desc: '狙った所に煙を投げる。中は見えない' },
  [ITEM.SHAKE]: { name: '照準ぶれ', icon: '🌀', desc: '自分以外の全員の狙いが3秒ゆらゆら' },
  [ITEM.NOAMMO]: { name: 'ゴム切れ', icon: '✂️', desc: '自分以外の全員が3秒撃てない' },
  [ITEM.GUM]: { name: 'ネバネバガム', icon: '🍬', desc: '足もとに置く罠。踏んだ相手は2秒動けない' },
  [ITEM.HEAL]: { name: '回復おやつ', icon: '🍖', desc: '体力が3回復する' },
  [ITEM.STAR]: { name: '無敵スター', icon: '⭐', desc: '10秒間、輪ゴムもガムも効かない' },
};
