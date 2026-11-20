// 只用原生 Canvas 绘制统计卡片，不依赖网页截图或外部图片。
export const RESULT_IMAGE = { width: 600, height: 980, scale: 2 };

export function drawResultImage(ctx, { playerName, title, reason, stats, series, finishedAt }) {
  const colors = { text: '#edf2f8', muted: '#9aa9bd', gold: '#edc47e', green: '#75dfb6', red: '#ff9a9d', purple: '#b4a4ed' };
  const family = '"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
  const format = value => value.toLocaleString('zh-CN');
  const font = (size, weight = 400) => { ctx.font = `${weight} ${size}px ${family}`; };
  function text(value, x, y, size = 14, color = colors.text, weight = 400, align = 'left') {
    font(size, weight); ctx.textAlign = align; ctx.fillStyle = color; ctx.fillText(String(value), x, y);
  }
  function fitted(value, x, y, width, size, color = colors.text, weight = 500, minimum = 14) {
    value = String(value); font(size, weight);
    while (ctx.measureText(value).width > width && size > minimum) font(--size, weight);
    text(value, x, y, size, color, weight);
  }
  function box(x, y, width, height, radius, fill, border) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y); ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius); ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
    if (border) { ctx.strokeStyle = border; ctx.lineWidth = 1; ctx.stroke(); }
  }
  function line(x1, y1, x2, y2, color, width = 1) {
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
  }
  function dot(x, y, radius, color) {
    ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
  }

  ctx.save();
  ctx.scale(RESULT_IMAGE.scale, RESULT_IMAGE.scale);
  ctx.fillStyle = '#0b1220'; ctx.fillRect(0, 0, RESULT_IMAGE.width, RESULT_IMAGE.height);
  const background = ctx.createLinearGradient(24, 24, 576, 956);
  background.addColorStop(0, '#18273e'); background.addColorStop(1, '#101b2c');
  box(24, 24, 552, 932, 24, background, '#2b384c');

  dot(67, 63, 16, colors.gold); text('正', 67, 69, 17, '#78541e', 600, 'center');
  text('硬币实验室', 96, 70, 23, colors.text, 600);
  text('十分钟挑战 · 结果留念', 548, 68, 12, colors.muted, 400, 'right');
  line(52, 96, 548, 96, '#2b384c');
  fitted(`${playerName}的本次战绩`, 52, 134, 496, 18, colors.gold);
  fitted(title, 52, 176, 496, 27);
  text(reason, 52, 207, 14, colors.muted);

  text('最终余额', 52, 251, 14, colors.muted);
  fitted(format(series.player.at(-1)), 49, 324, 500, 76, colors.text, 500, 30);
  text('枚金币', 52, 354, 14, colors.muted);
  const profit = stats.profit;
  const profitText = profit === 0 ? '与初始余额持平' : `${profit > 0 ? '净赚 +' : '净亏 −'}${format(Math.abs(profit))} 枚`;
  text(profitText, 548, 354, 14, profit > 0 ? colors.green : profit < 0 ? colors.red : colors.muted, 500, 'right');

  const gap = 10, cardWidth = (496 - gap * 2) / 3;
  const metrics = [
    [format(stats.count), '投掷次数'],
    [stats.count ? `${Math.round(stats.winRate * 100)}%` : '—', '猜中比例'],
    [stats.count ? `${Math.round(stats.headsRate * 100)}%` : '—', '正面出现比例'],
  ];
  metrics.forEach(([value, label], index) => {
    const x = 52 + index * (cardWidth + gap);
    box(x, 380, cardWidth, 84, 12, '#1a293e', '#2b384c');
    text(value, x + cardWidth / 2, 418, 28, colors.text, 500, 'center');
    text(label, x + cardWidth / 2, 444, 13, colors.muted, 400, 'center');
  });

  text('余额轨迹与策略对比', 52, 505, 16, colors.text, 500);
  const chart = { x: 96, y: 528, width: 440, height: 166 };
  const curves = [[series.player, colors.green], [series.ten, colors.gold], [series.twenty, colors.purple]];
  const maxValue = Math.max(100, ...curves.map(([values]) => Math.max(...values)));
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(1, maxValue)));
  const ceiling = Math.ceil(maxValue * 1.12 / (magnitude / 2)) * (magnitude / 2);
  const px = index => chart.x + index / Math.max(1, series.player.length - 1) * chart.width;
  const py = value => chart.y + chart.height * (1 - value / ceiling);
  const short = value => value >= 1e16 ? value.toExponential(1) : value >= 1e12 ? `${+(value / 1e12).toFixed(1)}万亿` : value >= 1e8 ? `${+(value / 1e8).toFixed(1)}亿` : value >= 1e4 ? `${+(value / 1e4).toFixed(1)}万` : format(Math.round(value));
  for (const value of [0, ceiling / 2, ceiling]) {
    line(chart.x, py(value), chart.x + chart.width, py(value), '#2a374a');
    text(short(value), chart.x - 10, py(value) + 4, 12, colors.muted, 400, 'right');
  }
  ctx.setLineDash([4, 5]);
  line(chart.x, py(100), chart.x + chart.width, py(100), '#76869c');
  ctx.setLineDash([]);
  curves.slice().reverse().forEach(([values, color]) => {
    ctx.beginPath();
    values.forEach((value, index) => { if (index === 0) ctx.moveTo(px(index), py(value)); else ctx.lineTo(px(index), py(value)); });
    if (values.length === 1) ctx.lineTo(chart.x + chart.width, py(values[0]));
    ctx.strokeStyle = color; ctx.lineWidth = color === colors.green ? 2.8 : 1.8;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();
  });
  dot(series.player.length > 1 ? px(series.player.length - 1) : chart.x, py(series.player.at(-1)), 3.5, colors.green);
  text('开始', chart.x, 721, 12, colors.muted);
  text(`第 ${format(stats.count)} 次`, chart.x + chart.width, 721, 12, colors.muted, 400, 'right');

  ['你的策略', '固定 10%', '固定 20%'].forEach((label, index) => {
    const x = 52 + index * (cardWidth + gap);
    const [values, color] = curves[index];
    box(x, 750, cardWidth, 90, 12, '#1a293e', '#2b384c');
    dot(x + 16, 774, 3.5, color); text(label, x + 27, 779, 13, colors.muted);
    const value = format(values.at(-1)); font(14, 500);
    if (ctx.measureText(value).width > cardWidth - 28) fitted(short(values.at(-1)), x + 14, 817, cardWidth - 28, 25);
    else fitted(value, x + 14, 817, cardWidth - 28, 25);
  });
  text('固定 10% / 20% 始终押正面，采用相同的硬币结果。', 52, 864, 13, colors.muted);
  text('下注按当时余额取整，最低 1 枚；余额归零后停止。', 52, 884, 13, colors.muted);
  line(52, 912, 548, 912, '#2b384c');
  text('初始 100 枚 · 仅使用虚拟金币', 52, 936, 12, colors.muted);
  const date = new Date(finishedAt);
  const stamp = `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  text(stamp, 548, 936, 12, colors.muted, 400, 'right');
  ctx.restore();
}
