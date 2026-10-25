// わんわん爆走カートの調整用パラメータ（ここを変えると遊び心地が変わる）

export const RACE = {
  LAPS: 3,
  COUNTDOWN: 3.6, // 開始カウントダウン（秒）。raceTime は -COUNTDOWN から始まり 0 で GO
  END_DELAY: 4.0, // 勝者確定から結果画面までの演出時間
  CHECKPOINTS: 8, // 1周あたりのチェックポイント数（0番がスタートライン）
};

export const KART = {
  RADIUS: 1.35, // 当たり判定の半径
  MAX_SPEED: 27,
  BOOST_SPEED: 40,
  ACCEL: 20,
  BOOST_ACCEL: 45,
  BRAKE: 34,
  REVERSE_ACCEL: 14,
  REVERSE_MAX: 9,
  COAST: 7, // アクセルを離したときの減速
  OVERSPEED_DECAY: 22, // 最高速を超えている時に戻す速さ
  STEER_RATE: 2.35, // rad/s
  GRASS_FACTOR: 0.55, // 芝生の上では最高速が下がる
  GRASS_DRAG: 10,
  KNOCK_DECAY: 3.2, // 横方向の押し出し速度の減衰
  KNOCK_MAX: 16,
  GRAVITY: 30,
  WALL_RESTITUTION: 0.35,
  KART_RESTITUTION: 0.55,
  SLOW_FACTOR: 0.65, // 体当たり後の一時的な速度低下
};

export const ITEMS = {
  NONE: 0,
  BONE: 1,
  BANANA: 2,
  BOOST: 3,
  BOX_RESPAWN: 4.0,
  BOX_RADIUS: 2.2,
  ROULETTE: 1.1, // アイテムが決まるまでのルーレット時間
  BONE_SPEED: 46,
  BONE_LIFE: 2.6,
  BONE_BOUNCES: 2,
  BONE_HIT_R: 2.0,
  BONE_SPIN: 1.3,
  BANANA_LIFE: 25,
  BANANA_HIT_R: 1.7,
  BANANA_SPIN: 1.05,
  BANANA_MAX: 6,
  BOOST_TIME: 2.4,
  INVULN_AFTER_SPIN: 1.1, // スピン後の無敵時間（連続でハメられないように）
};

export const NET = {
  INPUT_SEND_EVERY: 2, // ゲストは 2 tick ごと（30Hz）に入力をまとめて送る
  INTERP_DELAY: 0.1, // 相手の車の表示遅延（補間用）
  PREDICTION: true, // ゲスト自身の車をクライアント予測する
  SNAP_DIST: 6, // 予測の誤差がこれ以上なら瞬時に合わせる
  INPUT_BUFFER_MAX: 8,
};

// 入力ビット
export const IN = {
  UP: 1,
  DOWN: 2,
  LEFT: 4,
  RIGHT: 8,
  ITEM: 16, // 押した瞬間だけ
  RESPAWN: 32, // 押した瞬間だけ
  HELD: 15,
  ONESHOT: 48,
};
