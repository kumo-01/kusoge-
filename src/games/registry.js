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
      '小さなカートに乗った犬たちが3つのコースで3周勝負。ホネを投げ、バナナを置き、ブーストで追い抜き、体当たりで相手をはじき飛ばそう。タイミングブーストと、最終ラップの豪雨で大逆転も！先に3周したほうの勝ち！',
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
      ['Q / ☔ボタン', '豪雨をよぶ（最終ラップ・1レース1回）'],
    ],
    // ホストが準備画面で選べる設定（room state で共有される）
    options: [
      {
        key: 'course',
        label: 'コース',
        choices: [
          { value: 0, label: '🌼 わんわん草原サーキット' },
          { value: 1, label: '🏖️ しっぽフリフリ海岸' },
          { value: 2, label: '❄️ もこもこ雪山' },
        ],
        default: 0,
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
    ],
    tips: [
      '🦴 ホネアタック: 前に骨を投げる。当たるとクルクル回る（壁で跳ね返るので自爆注意）',
      '🍌 バナナトラップ: 後ろに置く。踏むとツルッとスピン',
      '⚡ わんわんブースト: しばらく超加速',
      '💥 高速で体当たりすると相手を大きくはじき飛ばせる',
      '📦 アイテムは1つまで。持っている間はアイテムボックスをすり抜ける',
      '⚡ タイミングブースト: レース中に1〜2回、リングが出る。縮んだリングが真ん中に重なった瞬間に画面を押すとブースト',
      '☔ 豪雨: 最終ラップに入ると☔ボタンが出る。早い者勝ちで1レース1回、呼んだ人以外はしばらく遅くなる',
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

/** 設定値が定義された選択肢に含まれるものだけ残す */
export function validOptions(def, raw) {
  const o = defaultOptions(def);
  for (const opt of def?.options || []) {
    const v = raw?.[opt.key];
    if (opt.choices.some((c) => c.value === v)) o[opt.key] = v;
  }
  return o;
}
