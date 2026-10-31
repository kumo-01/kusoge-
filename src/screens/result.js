// ⑥ 結果画面（1 レースだけのとき / 連戦の途中経過 / 連戦の最終結果）
import { h } from '../core/util.js';
import { getGame } from '../games/registry.js';
import { dogAvatar, PLAYERS, roomSummary } from './common.js';

export function mount(el, app) {
  let played = '';
  function render() {
    const room = app.room;
    const s = room.state;
    const r = s.result;
    const se = s.series;
    const isHost = room.role === 'host';
    const def = getGame(r?.gameId);
    const word = def?.roundWord || 'ラウンド'; // 連戦の 1 回の呼び方（カートは「レース」）
    const players = r?.players || []; // 結果に載っている人（席の番号つき）
    const me = room.slot;
    // 連戦の最終結果は合計ポイントで勝敗を決める（途中経過・1 レースだけのときは、そのレースの勝者）
    let winner = r?.winner ?? null;
    if (se?.final) {
      const top = Math.max(...players.map((p) => se.scores[p.slot]));
      const tops = players.filter((p) => se.scores[p.slot] === top);
      winner = tops.length === 1 ? tops[0].slot : null;
    }
    const key = `${se?.round || 0}-${r?.title || ''}`;
    if (played !== key && r) {
      played = key;
      if (!se || se.final) app.sound.play(winner === me ? 'finish' : winner != null ? 'lose' : 'ready');
    }
    const col = (p, i) => {
      const pl = PLAYERS[p.slot];
      return h(`div.result-player.player-${pl.color}${winner === p.slot ? '.is-winner' : ''}`, null,
        winner === p.slot ? h('div.crown', null, '👑') : null,
        h('div.avatar', { html: dogAvatar(pl.kind, 96) }),
        p.slot === me ? h('span.me-badge.inline', null, 'あなた') : null,
        h('div.player-name', null, `${pl.name}（${pl.role}）`),
        h('div.result-headline', null, se ? (se.final ? `${se.scores[p.slot]} pt` : p.headline) : p.headline),
        h('div.small', null, se ? (se.final ? `${se.total}戦の合計ポイント` : `${r?.points?.[i] ?? 0} pt 獲得（合計 ${se.scores[p.slot]} pt）`) : p.detail));
    };

    const head = ['', ...players.map((p) => `${PLAYERS[p.slot].icon} ${PLAYERS[p.slot].name}`)];
    const table = (rows) =>
      h('div.card.stats-card', null,
        h('table.stats', null,
          h('thead', null, h('tr', null, head.map((t) => h('th', null, t)))),
          h('tbody', null, rows.map((x) =>
            h(`tr${x.total ? '.is-total' : ''}`, null,
              h('th', null, x.label),
              x.text != null ? h('td', { colspan: players.length }, x.text) : x.values.map((v) => h('td', null, v)))))));

    let title = r?.title || '結果';
    if (se) {
      if (se.final && players.length === 1) title = `🏁 ${se.total}${word}の合計 ${se.scores[players[0].slot]} pt！`;
      else if (se.final) title = winner != null ? `🏆 ${PLAYERS[winner].name}がシリーズ優勝！ワン！` : '🤝 シリーズ引き分け！';
      else title = `第${se.round}戦 / 全${se.total}戦　${r?.title || ''}`;
    }
    const seriesRows = se
      ? [
          ...se.history.map((x, i) => ({ label: `第${i + 1}戦 ${x.name}`, values: players.map((p) => `${x.points[p.slot]} pt`) })),
          { label: '合計', values: players.map((p) => `${se.scores[p.slot]} pt`), total: true },
        ]
      : null;

    const next = se && !se.final;
    const sum = roomSummary(s);
    const canNext = sum.enough && sum.allConnected;
    el.replaceChildren(
      h('div.screen.screen-result', null,
        h('div.confetti', { 'aria-hidden': 'true' }, Array.from({ length: 24 }, (_, i) => h('i', { style: { '--i': i } }))),
        h('p.sub', null, def ? `${def.emoji} ${def.title}${r?.course ? `（${r.course}）` : ''}` : ''),
        h('h2.result-title', null, title),
        h('div.result-row', null, players.map(col)),
        se && r?.score?.length ? [h('h3.result-sub', null, `第${se.round}戦のポイント`), table(r.score)] : null,
        se ? [h('h3.result-sub', null, se.final ? `全${word}のポイント` : 'ここまでのポイント'), table(seriesRows)] : null,
        r?.stats?.length ? [se ? h('h3.result-sub', null, `第${se.round}戦の成績`) : null, table(r.stats)] : null,
        h('div.card.action-card', null,
          isHost
            ? [
                next
                  ? h('button.btn.btn-primary.btn-xl', { disabled: !canNext, onclick: () => { app.sound.play('ready'); room.nextRace(); } }, `▶ 次の${word}へ（第${se.round + 1}戦）`)
                  : h('button.btn.btn-primary.btn-xl', { onclick: () => room.goSelect() }, '🎮 ゲーム選択へ戻る'),
                next ? h('button.btn.btn-ghost', { onclick: () => room.goSelect() }, 'ここでやめてゲーム選択へ戻る') : null,
                next && !canNext ? h('p.small.warn-text', null, '参加者の接続を待っています…') : null,
              ]
            : h('div.waiting', null, h('span.paw-spinner', null, '🐾'), next ? `ホストが次の${word}を始めるのを待っています…` : 'ホストの操作を待っています…'))),
    );
  }
  render();
  return { update: render, destroy() {} };
}
