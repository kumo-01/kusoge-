// ミニゲームの登録簿。
// 新しいゲームを追加するときは、ここに 1 件追加し、load() で createGame() を export する
// モジュールを返すだけでよい（接続処理・部屋管理は共通システムがそのまま使える）。

// ひとりモードで連れてこられる CPU（2D のゲーム）。2 人以上のときは準備画面に出さない（soloOnly）
const CPU_OPTIONS = [
  {
    key: 'cpu',
    label: 'CPU（ひとりのときだけ）',
    soloOnly: true,
    choices: [
      { value: 0, label: 'なし' },
      { value: 1, label: '🤖 1人' },
      { value: 2, label: '🤖 2人' },
    ],
    default: 0,
  },
  {
    key: 'cpuLevel',
    label: 'CPU の強さ',
    soloOnly: true,
    needs: 'cpu', // CPU がいるときだけ出す
    choices: [
      { value: 1, label: 'よわい' },
      { value: 2, label: 'ふつう' },
      { value: 3, label: 'つよい' },
    ],
    default: 2,
  },
];

export const GAMES = [
  {
    id: 'dogKart',
    title: 'わんわん爆走カート',
    roundWord: 'レース', // 連戦の 1 回の呼び方
    colorWord: 'のカート', // 準備画面の「赤のカート」
    serverSim: true, // Cloudflare のサーバーで計算できる（worker/relay/game.js）。ほかのゲームはホストの端末で計算する
    emoji: '🏎️',
    tagline: '柴犬・コーギー・プードルが爆走！体当たりとアイテムで邪魔しあう3周レース',
    description:
      '小さなカートに乗った犬たちが10のコース（トンネルや洞窟もあるよ）で3周勝負。ホネを投げ、バナナを置き、ブーストで追い抜き、体当たりで相手をはじき飛ばそう。道のドッグフードを拾うほど少し速くなる！タイミングブーストと、後ろの人ほど出やすい飼い主登場・豪雨・犬小屋で大逆転も！2〜6連戦のポイント勝負にも。',
    players: '1〜3人（ひとりでも遊べる）',
    controls: [
      ['W / ↑', 'アクセル'],
      ['S / ↓', 'ブレーキ・バック'],
      ['A / ←', '左に曲がる'],
      ['D / →', '右に曲がる'],
      ['Space', 'アイテムを使う'],
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
      '🥏 フリスビー: すぐ前の相手へコースに沿って飛んで当てる（2位以下が引ける。飛べる距離に限りあり）',
      '🧑 飼い主登場: 後ろの順位ほど出やすい。しばらく飼い主に引っぱられて、無敵で自動で超高速に走る。触れた車ははね飛ばされる（マリオカートのキラー）',
      '🏠 犬小屋: 2位以下が引ける。今の1位の頭上に必ず落ちる（落ちるまで少し時間あり）。落ちた場所の近くにいる車も巻き込まれる。ガードでも防げない',
      '💥 高速で体当たりすると相手を大きくはじき飛ばせる',
      '📦 アイテムは1つまで。持っている間はアイテムボックスをすり抜ける',
      '⚡ タイミングブースト: レース中に1〜2回、リングが出る。縮んだリングが真ん中に重なった瞬間に画面を押すとブースト',
      '☔ 豪雨: 最下位の人だけがアイテムボックスから引ける。使った人以外はしばらく遅くなる大逆転の切り札（ガードで1回防げる）',
      '🍖 ドッグフード: 道に落ちている。最大15個まで持てて、多いほど少し速い（ぶつけられると3個落とす）。取られても少しするとまた出る',
      '🌑 トンネル: 中は暗くて雨も降らない。ランプの光とミニマップの暗い線が目印',
      '👑 ボス犬ドーベルマン: かなり強いNPC。ホネやフリスビーで足止めしよう（ゴールしても勝敗には関係なし）',
      '🏆 連戦: 毎レース、順位ポイント + ドッグフード + 体当たり + アイテム命中 + ファステストラップのポイントがつき、合計が高いほうがシリーズ優勝',
      '🐩 NPC（プードル・パグ・ダックス・ハスキー）は最大4台（順位は全員の中で表示。勝敗は人間のうち誰が先にゴールしたか。3人のときは最大3台）',
    ],
    load: () => import('./dogKart/index.js'),
  },
  {
    id: 'angleDuel',
    title: '人間感覚角度対決',
    emoji: '📐',
    roundWord: 'ラウンド',
    tagline: '「〇〇度までもっていけ！」分度器なしで角度を作って、近いほうが勝ち',
    description:
      '画面に「〇〇度までもっていけ！」とお題が出たら、円の外周の丸をドラッグ（または円の中をタップ）して、基準線からその角度を作ろう。制限時間の間は何度でも直せる。時間切れで答え合わせ。お題にいちばん近い人の勝ち！',
    players: '1〜3人（ひとりでも遊べる）',
    controls: [
      ['ドラッグ / タップ', '外周の丸を動かす（円の中をタップすると、その向きへ）'],
      ['角度の測り方', '「0°（ここから）」の線から、反時計回り（左回り）'],
    ],
    options: [
      {
        key: 'races',
        label: 'ラウンド数（連戦はポイント制）',
        choices: [
          { value: 1, label: '1回だけ' },
          { value: 3, label: '3回戦' },
          { value: 5, label: '5回戦' },
          { value: 10, label: '10回戦' },
        ],
        default: 3,
      },
      {
        key: 'limit',
        label: '制限時間',
        choices: [
          { value: 3, label: '3秒' },
          { value: 5, label: '5秒' },
          { value: 10, label: '10秒' },
          { value: 15, label: '15秒' },
          { value: 20, label: '20秒' },
        ],
        default: 10,
      },
      {
        key: 'base',
        label: '基準線の向き',
        choices: [
          { value: 0, label: '右向き（ふつう）' },
          { value: 1, label: 'ランダム（むずかしい）' },
        ],
        default: 0,
      },
      ...CPU_OPTIONS,
    ],
    tips: [
      '📐 0°の線から反時計回り。90° は真上（基準線が右向きのとき）、180° は真左',
      '⏱ 時間内なら何度でも直せる。最後に置いた角度で勝負',
      '🏆 ずれ 1° につき 2 pt 減って、ずれ 0° なら 100 pt。勝った人は +20 pt',
      '🙈 ほかの人の角度は答え合わせまで見えない',
    ],
    load: () => import('./angleDuel/index.js'),
  },
  {
    id: 'prefBattle',
    title: '都道府県県境バトル',
    emoji: '🗾',
    roundWord: 'ラウンド',
    tagline: 'お題の都道府県の県境を、標高で色分けした日本地図に描け！本物にいちばん近い人の勝ち',
    description:
      'お題の都道府県がランダムに出たら、県境の線が無い（標高で色分けした）日本地図の上に、その県の「県境」＝となりの都道府県と接している陸の境を、指やマウスで描こう。海岸線や島は県境ではないので描かなくてOK。山の尾根や川がヒント。地図はどこまで拡大してもくっきり。戻す・消しゴム・全部リセットで直せる。時間で終了したら、みんなの描いた地図が中央の地図に合体して、本物の県境と答え合わせ。一致率が 100% に近い人の勝ち！',
    players: '1〜3人（ひとりでも遊べる）',
    controls: [
      ['✏️ ペン', 'ドラッグで線を描く'],
      ['🧽 消しゴム', 'なぞった所の線を消す'],
      ['↩️ 戻す / 🗑️ 全部リセット', '1 つ前に戻す（Ctrl+Z） / 全部消す'],
      ['✋ 移動・➕➖ 拡大縮小', '2本指でつまむ・マウスのホイールでも拡大、右ドラッグでも移動'],
    ],
    options: [
      {
        key: 'races',
        label: 'ラウンド数（連戦はポイント制）',
        choices: [
          { value: 1, label: '1回だけ' },
          { value: 3, label: '3回戦' },
          { value: 5, label: '5回戦' },
          { value: 10, label: '10回戦' },
          { value: 15, label: '15回戦' },
        ],
        default: 1,
      },
      {
        key: 'limit',
        label: '制限時間',
        choices: [
          { value: 10, label: '10秒' },
          { value: 15, label: '15秒' },
          { value: 30, label: '30秒' },
          { value: 45, label: '45秒' },
          { value: 60, label: '60秒' },
          { value: 90, label: '90秒' },
        ],
        default: 60,
      },
      ...CPU_OPTIONS,
    ],
    tips: [
      '🗾 県境 = となりの都道府県と接している陸の境だけ。海岸線・島は県境ではないので描かない（描くと線の正確さが下がる）',
      '📏 測り方: 本物の県境と描いた線を 0.25km ごとの点に分け、それぞれ相手の線までの地上の距離（km）を測る。県境の大きさで決まる距離 A 以内なら満点、T km で 0 点（答え合わせで黄色の帯として表示）',
      '🗾 一致率 = 2×①なぞれた割合×②線の正確さ÷(①+②)。半分だけ描いても、ぐちゃぐちゃに塗っても点は伸びない。線の量が本物の 1.5 倍を超えると割引（同じ所をなぞり直すのは OK）',
      '🌐 地図は北ほど引き伸ばされるので、距離は緯度ごとの縮尺で本当の km に直して測る',
      '⛰️ 県境は山の尾根や大きな川に沿っていることが多い',
      '🔍 地図は拡大するほど細かい地形が出てくる。拡大して描くと正確に描ける',
      '🏝️ 北海道と沖縄県は、となりと陸で接していないのでお題に出ません',
      '🏆 一致率 1% につき 1 pt。勝った人は +20 pt',
      '地図: 国土地理院の色別標高図。県境: 国土地理院の地球地図日本を加工して作成',
    ],
    load: () => import('./prefBattle/index.js'),
  },
  {
    id: 'reaction',
    title: '反応速度バトル',
    emoji: '⚡',
    roundWord: 'ラウンド',
    tagline: '画面の色が変わった瞬間にクリック！いちばん速い人の勝ち。フライングは失格',
    description:
      '「まだ…」の色の画面が、ランダムなタイミングでパッと別の色に変わる。その瞬間に画面のどこかをクリック（タップ・スペースキー）しよう。色が変わってから押すまでの速さ（ミリ秒）を競う。色が変わる前に押すとフライングで失格！',
    players: '1〜3人',
    controls: [
      ['クリック / タップ', '画面のどこでも'],
      ['Space / Enter', 'キーボードでも押せる'],
    ],
    options: [
      {
        key: 'races',
        label: 'ラウンド数（連戦はポイント制）',
        choices: [
          { value: 1, label: '1回だけ' },
          { value: 3, label: '3回戦' },
          { value: 5, label: '5回戦' },
          { value: 10, label: '10回戦' },
        ],
        default: 5,
      },
      ...CPU_OPTIONS,
    ],
    tips: [
      '🚦 色が変わるまでの時間は毎回ランダム（1.5〜5.5秒）。色の組み合わせも毎回変わる',
      '⏱ 速さは自分の端末で「色を画面に出した瞬間」から「押した瞬間」まで測る。通信の遅れは入らないので、遠くの人とも公平',
      '💥 色が変わる前に押すとフライング（そのラウンドは 0 pt）。2.5 秒押さないと時間切れ',
      '🏆 150ms で 100 pt、そこから 5ms 遅いごとに 1 pt 減る。いちばん速い人は +20 pt',
    ],
    load: () => import('./reaction/index.js'),
  },
  {
    id: 'rhythm',
    title: 'リズム刻みバトル',
    emoji: '🥁',
    roundWord: 'ラウンド',
    tagline: '「BPM 120 を刻め！」お手本が止まっても、同じテンポでクリックし続けろ',
    description:
      'お題の BPM（1 分間の拍の数）のお手本を 4 拍聞いて（お手本なしも選べる）、3・2・1 のカウントダウンの 0 で 1 拍目。あとは自分だけでそのテンポのままクリック（タップ・スペースキー）し続けよう。押した間隔が、お題の 1 拍にどれだけ近いかで正確さを測る。いちばん正確な人の勝ち！ゲーム中は BGM が止まります。',
    players: '1〜3人',
    controls: [
      ['クリック / タップ', '画面のどこでも'],
      ['Space / Enter', 'キーボードでも刻める'],
    ],
    options: [
      {
        key: 'races',
        label: 'ラウンド数（連戦はポイント制）',
        choices: [
          { value: 1, label: '1回だけ' },
          { value: 3, label: '3回戦' },
          { value: 5, label: '5回戦' },
          { value: 10, label: '10回戦' },
        ],
        default: 3,
      },
      {
        key: 'bpm',
        label: 'テンポ（BPM）',
        choices: [
          { value: 0, label: '🎲 ランダム', random: true },
          { value: 70, label: '70（ゆっくり）' },
          { value: 90, label: '90' },
          { value: 120, label: '120' },
          { value: 140, label: '140' },
          { value: 160, label: '160（はやい）' },
        ],
        default: 0,
      },
      {
        key: 'guide',
        label: 'お手本',
        choices: [
          { value: 1, label: '🎧 あり（4 拍聞いてから）' },
          { value: 0, label: '🙈 なし（BPM の数字だけ）' },
        ],
        default: 1,
      },
      {
        key: 'taps',
        label: '刻む回数',
        choices: [
          { value: 8, label: '8回' },
          { value: 16, label: '16回' },
        ],
        default: 8,
      },
      ...CPU_OPTIONS,
    ],
    tips: [
      '🎧 お手本ありなら、最初に 4 拍のお手本（音と光）。少し間をあけてから 3・2・1 のカウントダウン、0 で 1 拍目を押して、あとは自分だけでテンポを保つ',
      '🙈 お手本なしは、BPM の数字だけを頼りに刻む（むずかしい）',
      '📏 押した間隔ごとに、お題の 1 拍（例: BPM 120 なら 500ms）とのずれ（%）を測る。最初の 1 回は合図なので、間隔は「回数 − 1」個',
      '🎯 正確さ = 100 ×（1 − ずれの平均 ÷ 25%）。ずれ 0% で 100%、平均 25% ずれると 0%',
      '⏱ 押した時刻は自分の端末で測るので、通信の遅れは入らない',
      '🏆 正確さ 1% につき 1 pt。いちばん正確な人は +20 pt',
    ],
    load: () => import('./rhythm/index.js'),
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
