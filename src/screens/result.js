// ⑥ 結果画面（1 レースだけのとき / 連戦の途中経過 / 連戦の最終結果）
import { h } from '../core/util.js';
import { getGame } from '../games/registry.js';
import { dogAvatar, PLAYERS } from './common.js';

export function mount(el, app) {
  let played = '';
  function render() {
    const room = app.room;
    const s = room.state;
    const r = s.result;
    const se = s.series;
    const isHost = room.role === 'host';
    const def = getGame(r?.gameId);
    const me = isHost ? 'host' : 'guest';
    // 連戦の最終結果は合計ポイントで勝敗を決める（途中経過・1 レースだけのときは、そのレースの勝者）
    const winner = se?.final ? (se.host > se.guest ? 'host' : se.guest > se.host ? 'guest' : null) : r?.winner;
    const key = `${se?.round || 0}-${r?.title || ''}`;
    if (played !== key && r) {
      played = key;
      if (!se || se.final) app.sound.play(winner === me ? 'finish' : winner ? 'lose' : 'ready');
    }
    const col = (who) =>
      h(`div.result-player.player-${PLAYERS[who].color}${winner === who ? '.is-winner' : ''}`, null,
        winner === who ? h('div.crown', null, '👑') : null,
        h('div.avatar', { html: dogAvatar(PLAYERS[who].kind, 96) }),
        who === me ? h('span.me-badge.inline', null, 'あなた') : null,
        h('div.player-name', null, `${PLAYERS[who].name}（${PLAYERS[who].role}）`),
        se ? h('div.result-headline', null, se.final ? `${se[who]} pt` : r?.[who]?.headline || '') : h('div.result-headline', null, r?.[who]?.headline || ''),
        h('div.small', null, se ? (se.final ? `${se.total}戦の合計ポイント` : `${r?.points?.[who] ?? 0} pt 獲得（合計 ${se[who]} pt）`) : r?.[who]?.detail || ''));

    const table = (rows, head = ['', `🔴 ${PLAYERS.host.name}`, `🔵 ${PLAYERS.guest.name}`]) =>
      h('div.card.stats-card', null,
        h('table.stats', null,
          h('thead', null, h('tr', null, head.map((t) => h('th', null, t)))),
          h('tbody', null, rows.map((x) => h(`tr${x.total ? '.is-total' : ''}`, null, h('th', null, x.label), h('td', null, x.host), h('td', null, x.guest))))));

    let title = r?.title || '結果';
    if (se) {
      if (se.final) title = winner ? `🏆 ${PLAYERS[winner].name}がシリーズ優勝！ワン！` : '🤝 シリーズ引き分け！';
      else title = `第${se.round}戦 / 全${se.total}戦　${r?.title || ''}`;
    }
    const seriesRows = se
      ? [
          ...se.history.map((x, i) => ({ label: `第${i + 1}戦 ${x.name}`, host: `${x.host} pt`, guest: `${x.guest} pt` })),
          { label: '合計', host: `${se.host} pt`, guest: `${se.guest} pt`, total: true },
        ]
      : null;

    const next = se && !se.final;
    el.replaceChildren(
      h('div.screen.screen-result', null,
        h('div.confetti', { 'aria-hidden': 'true' }, Array.from({ length: 24 }, (_, i) => h('i', { style: { '--i': i } }))),
        h('p.sub', null, def ? `${def.emoji} ${def.title}${r?.course ? `（${r.course}）` : ''}` : ''),
        h('h2.result-title', null, title),
        h('div.result-row', null, col('host'), col('guest')),
        se && r?.score?.length ? [h('h3.result-sub', null, `第${se.round}戦のポイント`), table(r.score)] : null,
        se ? [h('h3.result-sub', null, se.final ? '全レースのポイント' : 'ここまでのポイント'), table(seriesRows)] : null,
        r?.stats?.length ? [se ? h('h3.result-sub', null, `第${se.round}戦の成績`) : null, table(r.stats)] : null,
        h('div.card.action-card', null,
          isHost
            ? [
                next
                  ? h('button.btn.btn-primary.btn-xl', { disabled: s.guest !== 'connected', onclick: () => { app.sound.play('ready'); room.nextRace(); } }, `▶ 次のレースへ（第${se.round + 1}戦）`)
                  : h('button.btn.btn-primary.btn-xl', { onclick: () => room.goSelect() }, '🎮 ゲーム選択へ戻る'),
                next ? h('button.btn.btn-ghost', { onclick: () => room.goSelect() }, 'ここでやめてゲーム選択へ戻る') : null,
                next && s.guest !== 'connected' ? h('p.small.warn-text', null, 'ゲストの接続を待っています…') : null,
              ]
            : h('div.waiting', null, h('span.paw-spinner', null, '🐾'), next ? 'ホストが次のレースを始めるのを待っています…' : 'ホストの操作を待っています…'))),
    );
  }
  render();
  return { update: render, destroy() {} };
}
