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
      '小さなカートに乗った犬たちが草原サーキットで3周勝負。ホネを投げ、バナナを置き、ブーストで追い抜き、体当たりで相手をはじき飛ばそう。先に3周したほうの勝ち！',
    players: '2人対戦',
    controls: [
      ['W / ↑', 'アクセル'],
      ['S / ↓', 'ブレーキ・バック'],
      ['A / ←', '左に曲がる'],
      ['D / →', '右に曲がる'],
      ['Space', 'アイテムを使う'],
      ['R', 'チェックポイントに復帰'],
      ['C', 'カメラ切り替え（三人称 / 一人称）'],
    ],
    // ホストが準備画面で選べる設定（room state で共有される）
    options: [
      {
        key: 'npcs',
        label: 'NPC（コンピューターの犬）',
        choices: [
          { value: 0, label: 'なし（1対1）' },
          { value: 1, label: '1台（プードル）' },
          { value: 2, label: '2台（プードル・パグ）' },
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
      '🐩 NPC も走ります（順位は全員の中で表示。勝敗はホストとゲストのどちらが先にゴールしたか）',
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
