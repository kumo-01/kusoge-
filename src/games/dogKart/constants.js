// わんわん爆走カートの調整用パラメータ（ここを変えると遊び心地が変わる）

export const RACE = {
  LAPS: 3,
  COUNTDOWN: 3.6, // 開始カウントダウン（秒）。raceTime は -COUNTDOWN から始まり 0 で GO
  END_DELAY: 4.0, // 勝者確定から結果画面までの演出時間
  CHECKPOINTS: 12, // 1周あたりのチェックポイント数（0番がスタートライン）。長いコースなので復帰位置が遠くなりすぎないよう多めに
  MAX_HUMANS: 3, // 人間は最大 3 人（部屋の 0 = ホスト, 1・2 = ゲスト）。車は人間が先、そのあとに NPC
  MAX_KARTS: 7, // 全部で 7 台まで（人間 + 通常の NPC + ボス）。通常の NPC は 6 - 人間の数 台まで
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
  OWNER: 6, // 飼い主登場（マリオカートのキラー）
  RAIN: 7, // 豪雨
  HOUSE: 8, // 犬小屋（1位に必ず当たる）
  COUNT: 9,
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
  FRISBEE_LATERAL: 22, // コースに沿って飛びながら横に寄る速さ（m/s）
  FRISBEE_RANGE: 130, // 飛べる距離。これを超えると消える
  FRISBEE_BOUNCES: 1,
  INVULN_AFTER_SPIN: 1.1, // スピン後の無敵時間（連続でハメられないように）
  OWNER_TIME: 6, // 飼い主に引っ張ってもらえる時間（秒）。その間は無敵で自動で走る
  OWNER_FACTOR: 1.14, // 飼い主モード中の最高速の倍率
  OWNER_SPIN: 1.4, // 飼い主にはね飛ばされた車のスピン時間
  HOUSE_DELAY: 2.2, // 犬小屋を使ってから落ちてくるまでの時間（落下地点は1位を追いかける）
  HOUSE_STAY: 1.2, // 落ちたあと地面に残る時間
  HOUSE_RADIUS: 9, // 落ちたとき巻き込まれる範囲
  HOUSE_SPIN: 1.7,
  HOUSE_MAX: 4,
};

export const NET = {
  INPUT_SEND_EVERY: 2, // ゲストは 2 tick ごと（30Hz）に入力をまとめて送る
  INTERP_MAX: 0.3, // 通信が揺れるときに増やす補間遅延の上限
  INTERP_DELAY: 0.1, // 相手の車の表示遅延（補間用。配信間隔 1/30 秒の 2 倍強）
  INPUT_REDUNDANCY: 8, // 入力を送るとき直近何 tick 分を重ねて送るか（取りこぼし対策）
  PREDICTION: true, // ゲスト自身の車をクライアント予測する
  SNAP_DIST: 6, // 予測の誤差がこれ以上なら瞬時に合わせる
  INPUT_BUFFER_MAX: 40, // サーバーに溜まった入力がこれを超えたら一気に追いつく（端末が止まっていたときなど）
  INPUT_ADJUST_TICKS: 30, // この tick ごとに、入力の届く遅れに合わせて 1 tick 待つ・飛ばすかを決める
  OWN_SMOOTH: 10, // 自分の車の補正を見た目に反映する速さ（同上。操作の手応えのため、ほかの車より速め）
  REMOTE_SMOOTH: 6, // ほかの車の見た目のずれを戻す速さ（ばねの固有角速度 rad/s。大きいほど早く正確に、小さいほど滑らかに）
  REMOTE_AHEAD_MAX: 30, // ほかの車を先へ計算する上限（tick）。回線がとても遅いときは、これ以上は先へ進めない
  INPUT_LEAD_MAX: 4, // 入力が使われるまでの余裕がずっとこれ（tick）を超えていたら 1 tick 飛ばす
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

// 豪雨: 最下位の車だけがアイテムとして引ける。使った車以外は一時的に遅くなる
export const RAIN = {
  DURATION: 7, // 雨が降っている時間
  SLOW_TIME: 5, // 使った車以外が遅くなる時間
  FACTOR: 0.72, // その間の最高速の倍率
};

// ドッグフード: 道に落ちている（マリオカートのコイン）。拾うほど少し速くなる
export const FOOD = {
  GROUPS: 25, // 1 周に並べる列の数
  PER_GROUP: 5, // 1 列の個数
  SPACING: 5.5, // 列の中の間隔
  RADIUS: 2.7, // 拾える距離
  MAX: 15, // 持てる最大数
  SPEED: 0.004, // 1 個あたりの最高速アップ（15 個で +6%）
  RESPAWN: 16, // 取られてからまた出るまでの秒数
  HIT_LOSS: 3, // スピンさせられたときに落とす数
};

// 連戦のポイント（人間 2 人それぞれに 1 レースごと計算して足していく）
export const SCORE = {
  RANK: [15, 12, 10, 8, 6, 4, 2, 1], // 総合順位ごと（全員の中での順位）
  FOOD: 1, // ドッグフード 1 個につき
  BUMP: 2, // 体当たり成功 1 回につき
  HIT: 3, // アイテム命中 1 回につき
  FAST: 5, // ベストラップが 2 人のうち速かったほう（ゴールしている人だけ）
};

// ボス犬: かなり強い NPC（ふつうの NPC より速く、アイテムも上手に使う。ゴールしてもレースの勝敗には関わらない）
export const BOSS = {
  SPEED: 1.06, // 最高速の倍率
  SPEED_BEHIND: 1.09, // 人間に遅れているとき
  SPEED_FAR: 1.0, // 人間より大きく先行しているとき（追いつける余地を残す）
  FAR_DIST: 380,
  BEHIND_DIST: 120,
};

// NPC（コンピューター）の運転
export const NPC = {
  SPEED: 0.93, // 最高速の倍率（ふつう）
  SPEED_BEHIND: 1.02, // 人間より大きく遅れているとき
  SPEED_AHEAD: 0.84, // 人間より大きく先行しているとき
  RUBBER_DIST: 140, // 追い上げ/手加減を始める差（コース上の距離）
};
