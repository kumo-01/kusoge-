// わんわん爆走カートの調整用パラメータ（ここを変えると遊び心地が変わる）

export const RACE = {
  LAPS: 3,
  COUNTDOWN: 3.6, // 開始カウントダウン（秒）。raceTime は -COUNTDOWN から始まり 0 で GO
  END_DELAY: 4.0, // 勝者確定から結果画面までの演出時間
  CHECKPOINTS: 8, // 1周あたりのチェックポイント数（0番がスタートライン）
  HUMANS: 2, // 0 = ホスト, 1 = ゲスト。2 以降は NPC
  MAX_NPCS: 4,
};

export const KART = {
  RADIUS: 1.4, // 当たり判定の半径
  MAX_SPEED: 34,
  BOOST_SPEED: 49,
  ACCEL: 25,
  BOOST_ACCEL: 55,
  BRAKE: 42,
  REVERSE_ACCEL: 14,
  REVERSE_MAX: 10,
  COAST: 8, // アクセルを離したときの減速
  OVERSPEED_DECAY: 26, // 最高速を超えている時に戻す速さ
  STEER_RATE: 2.4, // rad/s
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
  GUARD: 4,
  FRISBEE: 5,
  BOX_RESPAWN: 4.0,
  BOX_RADIUS: 2.2,
  ROULETTE: 1.1, // アイテムが決まるまでのルーレット時間
  BONE_SPEED: 58,
  BONE_LIFE: 2.6,
  BONE_BOUNCES: 2,
  BONE_HIT_R: 2.0,
  BONE_SPIN: 1.3,
  BANANA_LIFE: 25,
  BANANA_HIT_R: 1.7,
  BANANA_SPIN: 1.05,
  BANANA_MAX: 6,
  BOOST_TIME: 2.4,
  GUARD_TIME: 20, // ガードの持続（秒）。何かに当たると 1 回で消える
  FRISBEE_SPEED: 46, // 自分の速度に足す速さ
  FRISBEE_TURN: 3.4, // 追尾の旋回（rad/s）
  FRISBEE_RANGE: 130, // 飛べる距離。これを超えると消える
  FRISBEE_BOUNCES: 1,
  INVULN_AFTER_SPIN: 1.1, // スピン後の無敵時間（連続でハメられないように）
};

export const NET = {
  INPUT_SEND_EVERY: 2, // ゲストは 2 tick ごと（30Hz）に入力をまとめて送る
  INTERP_DELAY: 0.08, // 相手の車の表示遅延（補間用。配信間隔 1/30 秒の 2 倍強）
  INPUT_REDUNDANCY: 8, // 入力を送るとき直近何 tick 分を重ねて送るか（取りこぼし対策）
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
  TAP: 64, // タイミングブーストの「タップ」。押した瞬間だけ
  RAIN: 128, // 豪雨を呼ぶ。押した瞬間だけ
  HELD: 15,
  ONESHOT: 240,
};

// タイミングブースト: レース中に 1〜2 回、リングが縮んで的に重なった瞬間に押すとブースト
export const TIMING = {
  WINDOW: 1.6, // リングが出てから消えるまで（秒）
  SWEET: 0.45, // 残り時間がこの値のときがジャスト
  PERFECT: 0.08, // ジャストからのずれの許容（秒）
  GOOD: 0.2,
  BOOST_PERFECT: 2.4,
  BOOST_GOOD: 1.3,
};

// ブーストパッド: 床の矢印を踏むとブースト
export const PAD = {
  LENGTH: 9, // パッドの長さ（コースの進行方向）
  WIDTH: 8, // パッドの幅
  BOOST: 1.2, // ブーストの持続（秒）。踏んでいる間は延び続ける
  ACCEL: 90, // 踏んでいる間の加速（m/s²）
};

// 豪雨: 最終ラップに入った最下位の車だけが、1 レースに 1 回だけ雨雲を呼べる。呼んだ車以外は一時的に遅くなる
export const RAIN = {
  DURATION: 7, // 雨が降っている時間
  SLOW_TIME: 5, // 呼んだ車以外が遅くなる時間
  FACTOR: 0.72, // その間の最高速の倍率
  REQUEST_GRACE: 0.5, // 最終ラップに入る直前に押した入力を待つ時間（通信の遅れ対策）
};

// NPC（コンピューター）の運転
export const NPC = {
  SPEED: 0.93, // 最高速の倍率（ふつう）
  SPEED_BEHIND: 1.02, // 人間より大きく遅れているとき
  SPEED_AHEAD: 0.84, // 人間より大きく先行しているとき
  RUBBER_DIST: 140, // 追い上げ/手加減を始める差（コース上の距離）
};
