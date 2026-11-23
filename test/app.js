import { createGame, startGame, finishGame, checkTime, placeBet,
  restoreGame, getStats, getSeries, INITIAL_BALANCE } from './engine.js?v=preview-2';
import { RESULT_IMAGE, drawResultImage } from './result-image.js?v=preview-2';

const $ = id => document.getElementById(id);
// 测试版与正式版的进度分开，互不覆盖。
const KEY = 'coin-lab:test:game:v1';
const NAME_KEY = 'coin-lab:test:player:v1';
const FLIP_DELAY_MS = 3500;
const number = value => value.toLocaleString('zh-CN');
const sideName = side => side === 'heads' ? '正面' : '反面';
const signed = value => `${value > 0 ? '+' : value < 0 ? '−' : ''}${number(Math.abs(value))}`;
let game = createGame();
let selectedSide = 'heads';
let busy = false;
let showAllHistory = false;
let rotation = 0;
let animationTimeout;
let revealAt = 0;
let storageWorks = true;
let lastInput = '20';
let playerName = '';
let entered = false;
let resultImage = null;
let imageGeneration = 0;
let imageGame = null;

try {
  playerName = (sessionStorage.getItem(NAME_KEY) || '').trim().slice(0, 20);
  const raw = sessionStorage.getItem(KEY);
  if (raw) {
    const restored = restoreGame(raw);
    if (restored) {
      game = restored;
      const savedRevealAt = JSON.parse(raw).revealAt;
      if (game.rounds.length && Number.isSafeInteger(savedRevealAt)
        && savedRevealAt > Date.now() && savedRevealAt <= Date.now() + FLIP_DELAY_MS) {
        busy = true;
        revealAt = savedRevealAt;
      }
    }
    else storageNotice('上次的进度无法读取，已准备好一局新的挑战。');
  }
} catch { storageWorks = false; }
entered = Boolean(playerName && game.status !== 'ready');

function updateDuration() {
  const minutes = entered ? game.durationMs / 60000 : Number($('duration-range').value);
  $('duration-value').textContent = `${minutes} 分钟`;
  $('duration-range').setAttribute('aria-valuetext', `${minutes} 分钟`);
  $('duration-range').style.setProperty('--range-fill', `${(minutes - 5) / 5 * 100}%`);
  $('start-clock').textContent = `${String(minutes).padStart(2, '0')}:00`;
  for (const label of document.querySelectorAll('[data-duration-minutes]')) label.textContent = minutes;
}

function renderScreen() {
  $('welcome-screen').hidden = entered;
  $('game-screen').hidden = !entered;
  $('rules-button').hidden = !entered;
  $('player-badge').hidden = !entered;
  $('player-name').textContent = playerName;
  $('player-name').title = playerName;
  document.body.classList.toggle('game-entered', entered);
  updateDuration();
}

function storageNotice(message) {
  $('storage-notice').textContent = message;
  $('storage-notice').hidden = false;
}

function save() {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...game, revealAt: busy ? revealAt : null }));
    sessionStorage.setItem(NAME_KEY, playerName);
  }
  catch {
    storageWorks = false;
    storageNotice('浏览器暂时无法保存进度。你仍可正常游戏，但刷新页面会丢失本局记录。');
  }
}

function setMessage(message, tone = '') {
  $('result-message').textContent = message;
  $('result-message').className = `result-message ${tone}`;
}

function amountValue() {
  const text = $('bet-input').value.trim();
  return /^\d+$/.test(text) ? Number(text) : NaN;
}

function inputError() {
  const value = amountValue();
  if (!Number.isSafeInteger(value) || value < 1) return '请输入至少 1 枚的整数金额';
  if (value > game.balance) return `当前最多可下注 ${number(game.balance)} 枚`;
  return '';
}

function updateBet(showError = true) {
  const value = amountValue();
  const finished = game.status === 'finished';
  const error = finished ? '' : inputError();
  $('bet-input').setAttribute('aria-invalid', String(Boolean(error && showError)));
  $('bet-error').textContent = showError ? error : '';
  $('bet-share').textContent = '每次调整 1 枚';
  const max = Math.max(1, game.balance);
  const sliderValue = Number.isSafeInteger(value) ? Math.max(1, Math.min(max, value)) : 1;
  $('bet-range').max = String(max);
  $('bet-range').value = String(sliderValue);
  $('bet-range').disabled = busy || finished || game.balance <= 1;
  $('bet-range').setAttribute('aria-valuetext', `${sliderValue} 枚金币`);
  $('bet-range').style.setProperty('--range-fill', `${max > 1 ? (sliderValue - 1) / (max - 1) * 100 : 0}%`);
  $('bet-maximum').textContent = `最多 ${number(game.balance)} 枚`;
  $('minus-button').disabled = busy || finished || value <= 1;
  $('plus-button').disabled = busy || finished || value >= game.balance;
  $('flip-button').disabled = busy || (game.status === 'playing' && Boolean(error));
}

function setProfit(element, value, initial = false) {
  element.textContent = initial ? '初始 100' : value === 0 ? '持平' : `${signed(value)} 枚`;
  element.className = `profit-tag ${value > 0 ? 'positive' : value < 0 ? 'negative' : ''}`;
}

function renderTimer() {
  const remaining = game.status === 'ready' ? game.durationMs
    : Math.max(0, game.endsAt - (game.status === 'finished' ? game.finishedAt : Date.now()));
  const seconds = Math.ceil(remaining / 1000);
  const minutes = Math.floor(seconds / 60);
  $('timer').textContent = `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  $('timer').setAttribute('aria-label', `剩余时间 ${minutes} 分 ${seconds % 60} 秒`);
  $('time-progress').style.transform = `scaleX(${Math.min(1, remaining / game.durationMs)})`;
  document.querySelector('.score-card').classList.toggle('timer-urgent', seconds <= 60 && game.status === 'playing');
}

function renderChart(target, comparisons = false) {
  const { player, ten, twenty } = getSeries(game);
  const series = [{ values: player, color: '#75dfb6' }];
  if (comparisons) series.push({ values: ten, color: '#edc47e' }, { values: twenty, color: '#b4a4ed' });
  const width = 460, height = 204, left = 48, right = 12, top = 16, bottom = 30;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  const maxValue = Math.max(INITIAL_BALANCE, ...series.map(s => Math.max(...s.values)));
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(1, maxValue)));
  const ceiling = Math.ceil(maxValue * 1.12 / (magnitude / 2)) * (magnitude / 2);
  const x = index => left + index / Math.max(1, player.length - 1) * plotWidth;
  const y = value => top + plotHeight * (1 - value / ceiling);
  const label = value => value >= 1e8 ? `${+(value / 1e8).toFixed(1)}亿` : value >= 1e4 ? `${+(value / 1e4).toFixed(1)}万` : number(Math.round(value));
  const path = values => values.length === 1 ? `M${left},${y(values[0])} L${width - right},${y(values[0])}`
    : values.map((value, i) => `${i ? 'L' : 'M'}${x(i).toFixed(2)},${y(value).toFixed(2)}`).join(' ');
  const grid = [0, ceiling / 2, ceiling].map(value => `<line x1="${left}" y1="${y(value)}" x2="${width - right}" y2="${y(value)}" stroke="#ffffff0b"/><text x="${left - 10}" y="${y(value) + 4}" text-anchor="end" fill="#8595ab" font-size="12">${label(value)}</text>`).join('');
  const area = `${path(player)} L${player.length === 1 ? width - right : x(player.length - 1)},${height - bottom} L${left},${height - bottom} Z`;
  const gradientId = `${target.id}-fill`;
  const paths = [...series].reverse().map(s => `<path d="${path(s.values)}" fill="none" stroke="${s.color}" stroke-width="${s === series[0] ? 2.5 : 1.5}" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
  target.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${comparisons ? '你的余额与固定比例策略的比较' : '你的余额变化'}，共 ${game.rounds.length} 次投掷，当前余额 ${game.balance} 枚"><defs><linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#75dfb6" stop-opacity=".12"/><stop offset="1" stop-color="#75dfb6" stop-opacity="0"/></linearGradient></defs>${grid}<line x1="${left}" y1="${y(INITIAL_BALANCE)}" x2="${width - right}" y2="${y(INITIAL_BALANCE)}" stroke="#9aa9bd55" stroke-dasharray="4 5"/><path d="${area}" fill="url(#${gradientId})"/>${paths}${player.length > 1 ? `<circle cx="${x(player.length - 1)}" cy="${y(player.at(-1))}" r="4" fill="#75dfb6" stroke="#142134" stroke-width="2"/>` : ''}<text x="${left}" y="${height - 6}" fill="#8595ab" font-size="12">开始</text><text x="${width - right}" y="${height - 6}" text-anchor="end" fill="#8595ab" font-size="12">${game.rounds.length ? `第 ${game.rounds.length} 次` : '等待第一次投掷'}</text></svg>`;
}

function renderHistory() {
  const count = game.rounds.length;
  $('history-count').textContent = number(count);
  $('history-empty').hidden = count > 0;
  $('history-table-wrap').hidden = count === 0;
  $('download-button').disabled = busy || count === 0;
  $('more-history').hidden = count <= 8;
  $('more-history').textContent = showAllHistory ? '收起记录' : `查看全部 ${number(count)} 次记录`;
  const fragment = document.createDocumentFragment();
  const start = showAllHistory ? 0 : Math.max(0, count - 8);
  for (let i = count - 1; i >= start; i--) {
    const round = game.rounds[i];
    const tr = document.createElement('tr');
    for (const [index, value] of [i + 1, sideName(round.side), number(round.amount), sideName(round.face), signed(round.delta), number(round.balance)].entries()) {
      const td = document.createElement('td');
      if (index === 3) { const span = document.createElement('span'); span.className = 'face-tag'; span.textContent = value; td.append(span); }
      else td.textContent = value;
      if (index === 4) td.className = round.delta > 0 ? 'positive' : 'negative';
      tr.append(td);
    }
    fragment.append(tr);
  }
  $('history-body').replaceChildren(fragment);
}

function render() {
  renderScreen();
  const stats = getStats(game);
  const finished = game.status === 'finished';
  $('balance').textContent = number(game.balance);
  $('balance').classList.toggle('compact-number', game.balance >= 100000);
  setProfit($('profit'), stats.profit, game.status === 'ready');
  $('round-count').textContent = number(stats.count);
  $('game-status').textContent = game.status === 'ready' ? '准备就绪' : finished ? '本局已结束' : '挑战进行中';
  $('game-status').className = `status-label ${game.status === 'playing' ? 'playing' : ''}`;
  $('end-button').disabled = game.status !== 'playing' || busy;
  $('flip-label').textContent = busy ? '硬币翻转中…' : game.status === 'ready' ? '开始游戏' : finished ? '查看本局结果' : '扔硬币';
  $('play-caption').textContent = game.status === 'ready' ? '准备好，试试你的策略' : finished ? '这一局，留下了你的选择' : `准备第 ${number(stats.count + 1)} 次投掷`;
  $('play-footnote').textContent = game.status === 'ready' ? '点击开始后计时 · 猜中赚取等额金币' : finished ? '每一次选择，都是下一次的经验' : '每次独立随机 · 猜中赚取等额金币';
  $('chart-caption').textContent = stats.count ? `${number(stats.count)} 次选择` : '从 100 开始';
  $('bet-input').disabled = busy || finished;
  for (const button of document.querySelectorAll('[data-side]')) button.disabled = busy || finished;
  $('more-history').disabled = busy;
  for (const button of document.querySelectorAll('[data-side]')) {
    button.classList.toggle('selected', button.dataset.side === selectedSide);
    button.setAttribute('aria-pressed', String(button.dataset.side === selectedSide));
  }
  renderTimer();
  updateBet(false);
  renderChart($('main-chart'), finished);
  $('main-legend').innerHTML = finished ? '<span><i class="legend-player"></i>你的余额</span><span><i class="legend-ten"></i>固定 10%</span><span><i class="legend-twenty"></i>固定 20%</span>' : '<span><i class="legend-player"></i>你的余额</span><span class="baseline-label">虚线为初始余额</span>';
  renderHistory();
}

function setCoin(face) {
  rotation = face === 'heads' ? 0 : 180;
  $('coin').classList.remove('spinning');
  $('coin').style.transform = `rotateY(${rotation}deg) rotateZ(-10deg)`;
}

function closeModal(id) { if ($(id).open) $(id).close(); }

function openResults() {
  if (!entered) return;
  closeModal('confirm-dialog');
  closeModal('rules-dialog');
  const stats = getStats(game);
  const series = getSeries(game);
  $('result-player').textContent = `${playerName}的本次战绩`;
  $('end-reason').textContent = { time: `${game.durationMs / 60000} 分钟，挑战完成`, bankrupt: '金币用完了，这次挑战结束', manual: '你完成了本次挑战' }[game.reason] || '挑战完成';
  $('result-title').textContent = stats.profit > 0 ? '不错，让好运有了回报。' : stats.profit === 0 ? '回到起点，也收获了经验。' : '每一次尝试，都有收获。';
  $('final-balance').textContent = number(game.balance);
  setProfit($('final-profit'), stats.profit);
  $('final-count').textContent = number(stats.count);
  $('final-win-rate').textContent = stats.count ? `${Math.round(stats.wins * 100 / stats.count)}%` : '—';
  $('final-heads-rate').textContent = stats.count ? `${Math.round(stats.heads * 100 / stats.count)}%` : '—';
  for (const [name, values] of Object.entries(series)) $(name === 'player' ? 'strategy-player' : `strategy-${name}`).textContent = number(values.at(-1));
  $('result-download').disabled = stats.count === 0;
  renderChart($('result-chart'), true);
  if (imageGame !== game || !resultImage) prepareResultImage();
  if (!$('result-dialog').open) $('result-dialog').showModal();
}

function clearResultImage() {
  imageGeneration++;
  if (resultImage) URL.revokeObjectURL(resultImage.url);
  resultImage = null; imageGame = null;
  $('result-preview-image').removeAttribute('src');
  $('preview-image-download').removeAttribute('href');
  $('preview-image-button').hidden = true;
}

function prepareResultImage() {
  clearResultImage();
  const generation = imageGeneration;
  const snapshot = game;
  $('save-result-button').disabled = true;
  $('save-result-label').textContent = '正在生成图片…';
  $('image-save-message').textContent = '';
  const fail = () => {
    if (generation !== imageGeneration) return;
    $('save-result-button').disabled = false;
    $('save-result-label').textContent = '重新生成结果图片';
    $('image-save-message').textContent = '图片暂时无法生成，请点击重试。';
  };
  try {
    const canvas = document.createElement('canvas');
    canvas.width = RESULT_IMAGE.width * RESULT_IMAGE.scale;
    canvas.height = RESULT_IMAGE.height * RESULT_IMAGE.scale;
    const context = canvas.getContext('2d');
    if (!context) { fail(); return; }
    drawResultImage(context, { playerName, title: $('result-title').textContent,
      reason: $('end-reason').textContent, stats: getStats(snapshot),
      series: getSeries(snapshot), finishedAt: snapshot.finishedAt, durationMinutes: snapshot.durationMs / 60000 });
    canvas.toBlob(blob => {
      if (generation !== imageGeneration) return;
      if (!blob) { fail(); return; }
      const url = URL.createObjectURL(blob);
      const filename = `硬币实验室-结果-${new Date(snapshot.finishedAt).toISOString().slice(0, 10)}.png`;
      resultImage = { url, filename }; imageGame = snapshot;
      $('result-preview-image').src = url;
      $('preview-image-download').href = url;
      $('preview-image-download').download = filename;
      $('preview-image-button').hidden = false;
      $('save-result-button').disabled = false;
      $('save-result-label').textContent = '保存结果';
    }, 'image/png');
  } catch { fail(); }
}

function saveResultImage() {
  if (!resultImage) { prepareResultImage(); return; }
  const link = document.createElement('a');
  link.href = resultImage.url; link.download = resultImage.filename;
  document.body.append(link); link.click(); link.remove();
  $('image-save-message').textContent = '已发起图片下载。手机也可点“查看图片”后长按保存。';
}

function completeFlip() {
  if (!busy) return;
  clearTimeout(animationTimeout);
  // 返回前台不会提前揭晓；即使降低动态效果，仍等待完整的 3.5 秒。
  const remaining = revealAt - Date.now();
  if (remaining > 0) { animationTimeout = setTimeout(completeFlip, remaining); return; }
  busy = false;
  closeModal('flip-dialog');
  document.body.classList.remove('is-revealing');
  $('coin-home').append($('coin-stage'));
  $('coin-wrap').classList.remove('flipping');
  $('coin-stage').classList.remove('is-flipping');
  const last = game.rounds.at(-1);
  if (last) {
    setCoin(last.face);
    setMessage(`${sideName(last.face)}！${last.delta > 0 ? '猜中了' : '下次再试'}，${signed(last.delta)} 枚`, last.delta > 0 ? 'win' : 'loss');
  }
  const checked = checkTime(game);
  if (checked !== game) game = checked;
  save();
  if (game.balance > 0 && amountValue() > game.balance) $('bet-input').value = String(game.balance);
  render();
  if (game.status === 'finished') openResults();
}

function tick() {
  if (!entered || game.status !== 'playing') return;
  const checked = checkTime(game);
  if (checked !== game) {
    game = checked;
    save();
    if (!busy) { render(); openResults(); }
  }
  renderTimer();
}

function flip() {
  if (busy) return;
  if (game.status === 'finished') { openResults(); return; }
  if (game.status === 'ready') {
    if (inputError()) { updateBet(); $('bet-input').focus(); return; }
    game = startGame(game);
    save(); render(); setMessage('挑战开始！选好金额，扔出第一枚硬币。');
    return;
  }
  tick();
  if (game.status === 'finished') return;
  if (inputError()) { updateBet(); return; }
  try {
    const beforeCount = game.rounds.length;
    game = placeBet(game, { side: selectedSide, amount: amountValue() });
    if (game.rounds.length === beforeCount) { save(); render(); openResults(); return; }
    busy = true;
    // 先保存结算结果与揭晓时间；刷新后也需等待，不重复抽样。
    revealAt = Date.now() + FLIP_DELAY_MS;
    save();
    showFlipEffect();
  } catch (error) { $('bet-error').textContent = error.message; }
}

function showFlipEffect() {
  const remaining = Math.max(0, revealAt - Date.now());
  const last = game.rounds.at(-1);
  $('coin-stage').style.setProperty('--flip-duration', `${remaining}ms`);
  $('coin-stage').classList.add('is-flipping');
  $('coin').classList.add('spinning');
  $('coin-wrap').classList.add('flipping');
  $('flip-round').textContent = `第 ${number(game.rounds.length)} 次投掷`;
  $('flip-caption').textContent = `押${sideName(last.side)} · ${number(last.amount)} 枚金币`;
  $('flip-stage-host').append($('coin-stage'));
  document.body.classList.add('is-revealing');
  $('flip-dialog').showModal();
  $('flip-label').textContent = '硬币翻转中…';
  $('flip-button').disabled = true;
  $('end-button').disabled = true;
  $('bet-input').disabled = true;
  for (const button of document.querySelectorAll('[data-side], #minus-button, #plus-button, #bet-range, #download-button, #more-history')) button.disabled = true;
  setMessage('硬币正在空中，好运即将落地…');
  animationTimeout = setTimeout(completeFlip, remaining);
}

function downloadResults() {
  const series = getSeries(game);
  const rows = [['玩家', '轮次', '你的选择', '下注金额', '硬币结果', '盈亏', '余额', '固定10%余额', '固定20%余额'],
    [playerName, 0, '', '', '', '', INITIAL_BALANCE, INITIAL_BALANCE, INITIAL_BALANCE]];
  game.rounds.forEach((round, i) => rows.push([playerName, i + 1, sideName(round.side), round.amount, sideName(round.face), round.delta, round.balance, series.ten[i + 1], series.twenty[i + 1]]));
  // 昵称作为纯文本导出，避免以公式字符开头的名字被表格软件执行。
  const csvCell = value => {
    if (typeof value === 'number') return String(value);
    const text = /^[\s]*[=+\-@\t\r\n]/.test(value) ? `'${value}` : String(value);
    return `"${text.replaceAll('"', '""')}"`;
  };
  const blob = new Blob(['\uFEFF', rows.map(row => row.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `硬币实验室-${new Date(game.startedAt || Date.now()).toISOString().slice(0, 10)}.csv`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$('welcome-form').addEventListener('submit', event => {
  event.preventDefault();
  const name = $('player-input').value.trim().replace(/\s+/g, ' ');
  if (!name || name.length > 20 || /[\u0000-\u001f\u007f]/.test(name)) {
    $('name-error').textContent = '请输入 1–20 个字的昵称，方便记录你的成绩。';
    $('player-input').setAttribute('aria-invalid', 'true');
    $('player-input').focus();
    return;
  }
  if (entered) return;
  playerName = name;
  game = startGame(createGame(Number($('duration-range').value)));
  entered = true;
  selectedSide = 'heads'; busy = false; showAllHistory = false;
  $('bet-input').value = '20';
  setCoin('heads');
  save(); render();
  setMessage('挑战开始！选好金额，扔出第一枚硬币。');
  window.scrollTo({ top: 0, behavior: 'instant' });
  $('flip-button').focus({ preventScroll: true });
});
$('player-input').addEventListener('input', () => {
  $('name-error').textContent = '';
  $('player-input').removeAttribute('aria-invalid');
});
$('duration-range').addEventListener('input', updateDuration);

$('flip-button').addEventListener('click', flip);
$('bet-input').addEventListener('input', () => updateBet());
$('bet-range').addEventListener('input', () => {
  if (busy || game.status === 'finished') return;
  $('bet-input').value = $('bet-range').value;
  updateBet();
});
$('bet-input').addEventListener('focus', () => { lastInput = $('bet-input').value; });
$('bet-input').addEventListener('keydown', event => {
  if (event.key === 'Enter') { event.preventDefault(); $('bet-input').blur(); }
  if (event.key === 'Escape') { $('bet-input').value = lastInput; $('bet-input').blur(); updateBet(); }
});
for (const [id, step] of [['minus-button', -1], ['plus-button', 1]]) {
  $(id).addEventListener('click', () => {
    if (busy || game.status === 'finished') return;
    $('bet-input').value = String(Math.max(1, Math.min(game.balance, (Number.isFinite(amountValue()) ? amountValue() : 1) + step)));
    updateBet();
  });
}
for (const button of document.querySelectorAll('[data-side]')) button.addEventListener('click', () => {
  if (busy || game.status === 'finished') return;
  selectedSide = button.dataset.side;
  for (const option of document.querySelectorAll('[data-side]')) {
    option.classList.toggle('selected', option === button);
    option.setAttribute('aria-pressed', String(option === button));
  }
});
$('rules-button').addEventListener('click', () => $('rules-dialog').showModal());
$('flip-dialog').addEventListener('cancel', event => {
  if (busy) event.preventDefault();
});
for (const button of document.querySelectorAll('[data-close]')) button.addEventListener('click', () => closeModal(button.dataset.close));
for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('click', event => {
  if (dialog.id === 'flip-dialog') return;
  const rect = dialog.getBoundingClientRect();
  if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
});
$('end-button').addEventListener('click', () => { tick(); if (game.status === 'playing' && !busy) $('confirm-dialog').showModal(); });
$('confirm-end').addEventListener('click', () => {
  tick();
  if (game.status === 'playing') game = finishGame(game);
  save(); render(); openResults();
});
$('restart-button').addEventListener('click', () => {
  closeModal('result-image-dialog');
  closeModal('result-dialog');
  clearResultImage();
  game = createGame(Number($('duration-range').value)); selectedSide = 'heads'; busy = false; showAllHistory = false; entered = false;
  $('player-input').value = playerName;
  $('name-error').textContent = '';
  $('player-input').removeAttribute('aria-invalid');
  $('bet-input').value = '20'; setCoin('heads');
  setMessage('新的机会，从这枚硬币开始。');
  save(); render();
  $('player-input').focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: 'smooth' });
});
$('download-button').addEventListener('click', downloadResults);
$('result-download').addEventListener('click', downloadResults);
$('save-result-button').addEventListener('click', saveResultImage);
$('preview-image-button').addEventListener('click', () => {
  if (resultImage) $('result-image-dialog').showModal();
});
$('more-history').addEventListener('click', () => { showAllHistory = !showAllHistory; renderHistory(); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { if (busy) completeFlip(); tick(); }
});
window.addEventListener('pageshow', () => { tick(); });
setInterval(tick, 250);

if (!storageWorks) storageNotice('当前浏览器不支持保存进度。可以正常游戏，但刷新页面会重新开始。');
$('player-input').value = playerName;
$('duration-range').value = String(game.durationMs / 60000);
if (game.rounds.length) {
  const last = game.rounds.at(-1);
  selectedSide = last.side;
  $('bet-input').value = String(Math.max(1, Math.min(last.amount, game.balance)));
  setCoin(last.face);
  setMessage(game.status === 'finished' ? '本局已结束，看看你的策略表现。' : '已恢复本局进度，继续你的挑战。');
} else if (game.status === 'playing') setMessage('已恢复本局进度，倒计时继续。');
render();
if (busy) showFlipEffect();
else if (game.status === 'finished') openResults();
