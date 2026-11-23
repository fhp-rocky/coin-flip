import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, startGame, finishGame, checkTime, placeBet, randomFace,
  fractionBet, getStats, getSeries, restoreGame, DURATION_MS, DURATION_OPTIONS } from '../engine.js';

const startedAt = 1_800_000_000_000;
const active = () => startGame(createGame(), startedAt);
const bet = (game, amount, face = 'heads', side = 'heads', now = startedAt + 1000) =>
  placeBet(game, { side, amount, now, draw: () => face });

test('初始 100 枚，默认精确计时 5 分钟，重复开始不重置', () => {
  const ready = createGame();
  assert.equal(ready.balance, 100);
  assert.equal(ready.endsAt, null);
  const game = startGame(ready, startedAt);
  assert.equal(game.endsAt - game.startedAt, 300000);
  assert.equal(startGame(game, startedAt + 10000), game);
});
test('5–10 分钟逐分钟可选，各自截止时刻与刷新恢复一致', () => {
  assert.deepEqual(DURATION_OPTIONS, [5, 6, 7, 8, 9, 10]);
  for (const minutes of DURATION_OPTIONS) {
    const game = startGame(createGame(minutes), startedAt);
    const deadline = startedAt + minutes * 60000;
    assert.equal(game.endsAt, deadline);
    assert.equal(checkTime(game, deadline - 1).status, 'playing');
    assert.equal(checkTime(game, deadline).status, 'finished');
    assert.deepEqual(restoreGame(JSON.stringify(game), startedAt + 1000), game);
    assert.equal(restoreGame(JSON.stringify(game), deadline).finishedAt, deadline);
  }
});
test('无效时长不能开始或从存档恢复', () => {
  for (const minutes of [0, -1, 1, 4, 5.5, 11, NaN, Infinity, '5']) {
    assert.throws(() => createGame(minutes));
    const invalid = { ...active(), durationMs: minutes * 60000 };
    if (minutes !== '5') assert.equal(restoreGame(JSON.stringify(invalid), startedAt + 1000), null);
  }
});
test('旧版十分钟存档保持原截止时间，未开始的旧存档采用五分钟默认值', () => {
  const game = bet(startGame(createGame(10), startedAt), 20);
  const legacy = { ...game }; delete legacy.durationMs;
  assert.deepEqual(restoreGame(JSON.stringify(legacy), startedAt + 1000), game);
  assert.equal(restoreGame(JSON.stringify(legacy), startedAt + 600000).status, 'finished');
  const ready = createGame(); delete ready.durationMs;
  assert.equal(restoreGame(JSON.stringify(ready)).durationMs, 300000);
});
test('正反面均按等额盈亏结算；不会修改上一轮状态', () => {
  const initial = active();
  const win = bet(initial, 20);
  const lose = bet(win, 1, 'heads', 'tails');
  assert.equal(initial.balance, 100);
  assert.equal(initial.rounds.length, 0);
  assert.equal(win.balance, 120);
  assert.equal(lose.balance, 119);
  assert.equal(bet(initial, 20, 'tails', 'tails').balance, 120);
  assert.equal(lose.rounds.at(-1).delta, -1);
});
test('拒绝零、负数、小数、非数和超额下注，非法下注不抽取随机数', () => {
  for (const amount of [0, -1, 0.5, 1.2, NaN, Infinity, '20', 101, Number.MAX_SAFE_INTEGER + 1]) {
    let drawn = false;
    const game = active();
    assert.throws(() => placeBet(game, { side: 'heads', amount, now: startedAt, draw: () => { drawn = true; return 'heads'; } }));
    assert.equal(drawn, false);
    assert.equal(game.balance, 100);
  }
});
test('必须先开始；只接受正面或反面', () => {
  assert.throws(() => bet(createGame(), 1));
  assert.throws(() => bet(active(), 1, 'heads', 'invalid'));
});
test('全部下注猜错时归零并自动结束，后续不能继续下注', () => {
  const game = bet(active(), 100, 'tails');
  assert.equal(game.balance, 0);
  assert.equal(game.status, 'finished');
  assert.equal(game.reason, 'bankrupt');
  assert.throws(() => bet(game, 1));
});
test('截止时刻禁止新下注；截止前接受的投掷正常保留', () => {
  const deadline = startedAt + DURATION_MS;
  const before = bet(active(), 10, 'heads', 'heads', deadline - 1);
  assert.equal(before.balance, 110);
  const at = bet(before, 10, 'heads', 'heads', deadline);
  assert.equal(at.status, 'finished');
  assert.equal(at.reason, 'time');
  assert.equal(at.finishedAt, deadline);
  assert.equal(at.rounds.length, 1);
  assert.equal(at.balance, 110);
});
test('主动结束保留余额和实际结束时间', () => {
  const played = bet(active(), 20);
  const ended = finishGame(played, 'manual', startedAt + 3000);
  assert.equal(ended.balance, 120);
  assert.equal(ended.finishedAt, startedAt + 3000);
  assert.equal(finishGame(ended, 'time', startedAt + DURATION_MS), ended);
});
test('随机映射恰好六个正面、四个反面，并拒绝取模余数区间', () => {
  const faces = Array.from({ length: 10 }, (_, i) => randomFace(() => i));
  assert.equal(faces.filter(f => f === 'heads').length, 6);
  assert.equal(faces.filter(f => f === 'tails').length, 4);
  const samples = [4294967295, 4294967290, 6];
  assert.equal(randomFace(() => samples.shift()), 'tails');
  assert.equal(samples.length, 0);
});
test('对比策略比例四舍五入、最少 1 枚且不超余额', () => {
  assert.equal(fractionBet(100, 0.2), 20);
  assert.equal(fractionBet(15, 0.1), 2);
  assert.equal(fractionBet(1, 0.1), 1);
  assert.equal(fractionBet(101, 1), 101);
  assert.equal(fractionBet(0, 0.2), 0);
});
test('对比策略使用同一结果序列、当时余额、整数下注', () => {
  let game = active();
  for (const face of ['heads', 'tails', 'heads']) game = bet(game, 20, face);
  assert.deepEqual(getSeries(game), { player: [100, 120, 100, 120], ten: [100, 110, 99, 109], twenty: [100, 120, 96, 115] });
  assert.deepEqual(getStats(game), { count: 3, wins: 2, heads: 2, winRate: 2 / 3, headsRate: 2 / 3, profit: 20 });
});
test('对比策略破产后保持为零', () => {
  let game = active();
  for (let i = 0; i < 100; i++) game = bet(game, 1, 'tails');
  const { ten, twenty } = getSeries(game);
  for (const values of [ten, twenty]) {
    assert.ok(values.includes(0));
    assert.ok(values.every(Number.isSafeInteger));
    assert.ok(values.every(v => v >= 0));
    assert.ok(values.slice(values.indexOf(0)).every(v => v === 0));
  }
});
test('刷新恢复投掷结果、金额和原截止时间', () => {
  const game = bet(active(), 20);
  const restored = restoreGame(JSON.stringify(game), startedAt + 3000);
  assert.deepEqual(restored, game);
  assert.equal(restored.endsAt, startedAt + DURATION_MS);
});
test('刷新、后台返回超过截止时间时，立即结束且不重置倒计时', () => {
  const game = bet(active(), 20);
  const restored = restoreGame(JSON.stringify(game), startedAt + DURATION_MS + 30000);
  assert.equal(restored.status, 'finished');
  assert.equal(restored.balance, 120);
  assert.equal(restored.finishedAt, startedAt + DURATION_MS);
  assert.equal(checkTime(restored, startedAt + DURATION_MS + 60000), restored);
});
test('可恢复已结束且未投掷的对局，以及破产对局', () => {
  for (const game of [finishGame(active(), 'manual', startedAt + 500), bet(active(), 100, 'tails')]) {
    assert.deepEqual(restoreGame(JSON.stringify(game), startedAt + 10000), game);
  }
});
test('损坏或不符合规则的存档安全退回', () => {
  const game = bet(active(), 20);
  const modified = structuredClone(game);
  modified.rounds[0].balance = 999;
  for (const raw of ['bad json', 'null', '{}', JSON.stringify({ ...game, balance: -1 }),
    JSON.stringify({ ...game, endsAt: game.endsAt + 1 }), JSON.stringify(modified)]) {
    assert.equal(restoreGame(raw, startedAt + 2000), null);
  }
});
test('30 个玩家状态彼此独立，无共享余额', () => {
  const games = Array.from({ length: 30 }, active).map((game, i) => bet(game, i + 1, i % 2 ? 'tails' : 'heads'));
  games.forEach((game, i) => assert.equal(game.balance, 100 + (i % 2 ? -(i + 1) : i + 1)));
  assert.equal(new Set(games.map(game => game.rounds)).size, 30);
});
