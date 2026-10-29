// ミニゲームの登録簿。
// 新しいゲームを追加するときは、ここに 1 件追加し、load() で createGame() を export する
// モジュールを返すだけでよい（接続処理・部屋管理は共通システムがそのまま使える）。

export const GAMES = [
  {
    id: 'dogKart',
    title: 'わんわん爆走カート',
    emoji: '🏎️',
    tagline: '柴犬とコーギーが爆走！体当たりとアイテムで邪魔しあう3周レース',
    description:
      '小さなカートに乗った犬たちが10のコース（トンネルや洞窟もあるよ）で3周勝負。ホネを投げ、バナナを置き、ブーストで追い抜き、体当たりで相手をはじき飛ばそう。道のドッグフードを拾うほど少し速くなる！タイミングブーストと、後ろの人ほど出やすい飼い主登場・豪雨・犬小屋で大逆転も！2〜6連戦のポイント勝負にも。',
    players: '2人対戦',
    controls: [
      ['W / ↑', 'アクセル'],
      ['S / ↓', 'ブレーキ・バック'],
      ['A / ←', '左に曲がる'],
      ['D / →', '右に曲がる'],
      ['Space', 'アイテムを使う'],
      ['R', 'チェックポイントに復帰'],
      ['C', 'カメラ切り替え（三人称 / 一人称）'],
      ['クリック / タップ / Enter', 'タイミングブースト（リングが重なった瞬間に）'],
      ['スマホ・タブレット', '左下の ◀ ▶ でハンドル（オートアクセル）、右下でブレーキ・アイテム、画面タップでタイミングブースト'],
    ],
    // ホストが準備画面で選べる設定（room state で共有される）
    options: [
      {
        key: 'course',
        label: 'コース',
        choices: [
          { value: 99, label: '🎲 ランダム', random: true },
          { value: 0, label: '🌼 わんわん草原サーキット' },
          { value: 1, label: '🏖️ しっぽフリフリ海岸' },
          { value: 2, label: '❄️ もこもこ雪山' },
          { value: 3, label: '🍁 ひらひら紅葉の森' },
          { value: 4, label: '🌃 きらきら夜のスタジアム' },
          { value: 5, label: '💎 ひんやり水晶の洞窟（トンネル）' },
          { value: 6, label: '🚇 ガタゴト地下鉄トンネル（地下）' },
          { value: 7, label: '🌋 ぐつぐつ火山（トンネル）' },
          { value: 8, label: '🏜️ からから砂漠の大砂丘（岩のトンネル）' },
          { value: 9, label: '🍭 ふわふわおかしの国（チョコのトンネル）' },
        ],
        default: 0,
      },
      {
        key: 'races',
        label: 'レース数（連戦はポイント制）',
        choices: [
          { value: 1, label: '1レースだけ' },
          { value: 2, label: '2連戦' },
          { value: 3, label: '3連戦' },
          { value: 4, label: '4連戦' },
          { value: 6, label: '6連戦' },
        ],
        default: 1,
      },
      {
        key: 'npcs',
        label: 'NPC（コンピューターの犬）',
        choices: [
          { value: 0, label: 'なし（1対1）' },
          { value: 1, label: '1台' },
          { value: 2, label: '2台' },
          { value: 3, label: '3台' },
          { value: 4, label: '4台' },
        ],
        default: 2,
      },
      {
        key: 'boss',
        label: 'ボス犬（かなり強いNPC）',
        choices: [
          { value: 1, label: '出す（ドーベルマン）' },
          { value: 0, label: '出さない' },
        ],
        default: 1,
      },
    ],
    tips: [
      '🦴 ホネアタック: 前に骨を投げる。当たるとクルクル回る（壁で跳ね返るので自爆注意）',
      '🍌 バナナトラップ: 後ろに置く。踏むとツルッとスピン',
      '⚡ わんわんブースト: しばらく超加速',
      '🛡️ ガード: 何かに当たっても1回だけ防ぐ（最下位以外が引ける）',
      '🥏 フリスビー: すぐ前の相手を追いかけて当てる（2位以下が引ける。飛べる距離に限りあり）',
      '🧑 飼い主登場: 後ろの順位ほど出やすい。しばらく飼い主に引っぱられて、無敵で自動で超高速に走る。触れた車ははね飛ばされる（マリオカートのキラー）',
      '🏠 犬小屋: 2位以下が引ける。今の1位の頭上に必ず落ちる（落ちるまで少し時間あり）。落ちた場所の近くにいる車も巻き込まれる。ガードで1回防げる',
      '💥 高速で体当たりすると相手を大きくはじき飛ばせる',
      '📦 アイテムは1つまで。持っている間はアイテムボックスをすり抜ける',
      '⚡ タイミングブースト: レース中に1〜2回、リングが出る。縮んだリングが真ん中に重なった瞬間に画面を押すとブースト',
      '☔ 豪雨: 最下位の人だけがアイテムボックスから引ける。使った人以外はしばらく遅くなる大逆転の切り札（ガードで防げる）',
      '🍖 ドッグフード: 道に落ちている。最大15個まで持てて、多いほど少し速い（ぶつけられると3個落とす）。取られても少しするとまた出る',
      '🌑 トンネル: 中は暗くて雨も降らない。ランプの光とミニマップの暗い線が目印',
      '👑 ボス犬ドーベルマン: かなり強いNPC。ホネやフリスビーで足止めしよう（ゴールしても勝敗には関係なし）',
      '🏆 連戦: 毎レース、順位ポイント + ドッグフード + 体当たり + アイテム命中 + ファステストラップのポイントがつき、合計が高いほうがシリーズ優勝',
      '🐩 NPC（プードル・パグ・ダックス・ハスキー）は最大4台（順位は全員の中で表示。勝敗はホストとゲストのどちらが先にゴールしたか）',
    ],
    load: () => import('./dogKart/index.js'),
  },
];

export function getGame(id) {
  return GAMES.find((g) => g.id === id) || null;
}

/** ゲームの設定の初期値 */
export function defaultOptions(def) {
  const o = {};
  for (const opt of def?.options || []) o[opt.key] = opt.default;
  return o;
}

/**
 * 1 レースぶんの設定を確定する。ランダム（random: true の選択肢）は、連戦の中でまだ使っていないものから選ぶ。
 * @param {Record<string, number[]>} used 連戦でこれまでに使った値（キーごと）
 */
export function resolveMatchOptions(def, options, used = {}) {
  const o = validOptions(def, options);
  for (const opt of def?.options || []) {
    const rnd = opt.choices.find((c) => c.random);
    if (!rnd || o[opt.key] !== rnd.value) continue;
    const all = opt.choices.filter((c) => !c.random).map((c) => c.value);
    const fresh = all.filter((v) => !(used[opt.key] || []).includes(v));
    const pool = fresh.length ? fresh : all;
    o[opt.key] = pool[Math.floor(Math.random() * pool.length)];
  }
  return o;
}

/** 設定値が定義された選択肢に含まれるものだけ残す */
export function validOptions(def, raw) {
  const o = defaultOptions(def);
  for (const opt of def?.options || []) {
    const v = raw?.[opt.key];
    if (opt.choices.some((c) => c.value === v)) o[opt.key] = v;
  }
  return o;
}
