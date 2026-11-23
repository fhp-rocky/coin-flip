export const INITIAL_BALANCE = 100;
export const DURATION_MS = 5 * 60 * 1000;
export const DURATION_OPTIONS = Object.freeze([5, 6, 7, 8, 9, 10]);
const SIDES = new Set(['heads', 'tails']);

export function createGame(durationMinutes = DURATION_MS / 60000) {
  if (!DURATION_OPTIONS.includes(durationMinutes)) throw new Error('请选择有效的游戏时长。');
  return { version: 1, status: 'ready', balance: INITIAL_BALANCE,
    durationMs: durationMinutes * 60000,
    startedAt: null, endsAt: null, finishedAt: null, reason: null, rounds: [] };
}

export function startGame(game, now = Date.now()) {
  if (game.status !== 'ready') return game;
  return { ...game, status: 'playing', startedAt: now, endsAt: now + game.durationMs };
}

export function finishGame(game, reason = 'manual', now = Date.now()) {
  if (game.status !== 'playing') return game;
  return { ...game, status: 'finished', reason, finishedAt: now };
}

export function checkTime(game, now = Date.now()) {
  return game.status === 'playing' && now >= game.endsAt
    ? finishGame(game, 'time', game.endsAt) : game;
}

// 拒绝取样消除取模偏差：0–5 为正面，6–9 为反面。每次独立抽样。
export function randomFace(nextUint = () => crypto.getRandomValues(new Uint32Array(1))[0]) {
  let value;
  do { value = nextUint(); } while (value >= 4294967290);
  return value % 10 < 6 ? 'heads' : 'tails';
}

export function placeBet(game, { side, amount, now = Date.now(), draw = randomFace }) {
  const timed = checkTime(game, now);
  if (timed !== game) return timed;
  if (game.status !== 'playing') throw new Error('请先开始游戏。');
  if (!SIDES.has(side)) throw new Error('请选择正面或反面。');
  if (!Number.isSafeInteger(amount) || amount < 1) throw new Error('请输入至少 1 枚的整数金额。');
  if (amount > game.balance) throw new Error('下注金额不能超过当前余额。');
  const face = draw();
  if (!SIDES.has(face)) throw new Error('硬币结果无效，请重试。');
  const delta = face === side ? amount : -amount;
  const balance = game.balance + delta;
  if (!Number.isSafeInteger(balance)) throw new Error('金额已达到计算上限，请结束本局。');
  const next = { ...game, balance,
    rounds: [...game.rounds, { side, amount, face, delta, balance, at: now }] };
  return balance === 0 ? finishGame(next, 'bankrupt', now) : next;
}

export function fractionBet(balance, fraction) {
  return balance === 0 ? 0 : Math.min(balance, Math.max(1, Math.round(balance * fraction)));
}

export function getStats(game) {
  const n = game.rounds.length;
  const wins = game.rounds.filter(r => r.delta > 0).length;
  const heads = game.rounds.filter(r => r.face === 'heads').length;
  return { count: n, wins, heads, winRate: n ? wins / n : 0,
    headsRate: n ? heads / n : 0, profit: game.balance - INITIAL_BALANCE };
}

export function getSeries(game) {
  const player = [INITIAL_BALANCE], ten = [INITIAL_BALANCE], twenty = [INITIAL_BALANCE];
  for (const round of game.rounds) {
    player.push(round.balance);
    for (const [series, fraction] of [[ten, 0.1], [twenty, 0.2]]) {
      const previous = series.at(-1);
      const bet = fractionBet(previous, fraction);
      series.push(previous + (round.face === 'heads' ? bet : -bet));
    }
  }
  return { player, ten, twenty };
}

// 只恢复经过完整规则校验的状态，避免损坏的存档造成负余额或重置计时。
export function restoreGame(raw, now = Date.now()) {
  try {
    const saved = JSON.parse(raw);
    if (saved.version !== 1 || !Array.isArray(saved.rounds) || saved.rounds.length > 10000) return null;
    if (saved.status === 'ready') return saved.rounds.length === 0
      ? createGame(saved.durationMs === undefined ? undefined : saved.durationMs / 60000) : null;
    // 兼容原版未记录 durationMs 的十分钟存档。
    const durationMs = saved.durationMs === undefined ? 10 * 60000 : saved.durationMs;
    if (!Number.isSafeInteger(durationMs) || !DURATION_OPTIONS.includes(durationMs / 60000)) return null;
    if (!['playing', 'finished'].includes(saved.status) || !Number.isSafeInteger(saved.startedAt)
      || saved.startedAt < 0 || saved.endsAt !== saved.startedAt + durationMs) return null;
    let game = startGame(createGame(durationMs / 60000), saved.startedAt);
    let lastAt = saved.startedAt;
    for (const round of saved.rounds) {
      if (!Number.isSafeInteger(round.at) || round.at < lastAt || round.at >= saved.endsAt) return null;
      game = placeBet(game, { side: round.side, amount: round.amount, now: round.at, draw: () => round.face });
      if (game.balance !== round.balance || game.rounds.at(-1).delta !== round.delta) return null;
      lastAt = round.at;
    }
    if (saved.balance !== game.balance) return null;
    if (saved.status === 'finished') {
      if (!['manual', 'time', 'bankrupt'].includes(saved.reason)
        || !Number.isSafeInteger(saved.finishedAt) || saved.finishedAt < lastAt) return null;
      if (saved.reason === 'bankrupt' && game.balance !== 0) return null;
      if (saved.reason === 'time' && saved.finishedAt !== saved.endsAt) return null;
      game = finishGame(game, saved.reason, saved.finishedAt);
    } else if (game.status === 'finished') return null;
    return checkTime(game, now);
  } catch { return null; }
}
