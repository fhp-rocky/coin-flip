import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as engine from '../engine.js';

// 无浏览器的控制器测试：模拟 DOM 与时钟，验证事件、等待揭晓和结算边界。
// 不用于声称已完成浏览器渲染或真机兼容性验证。
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8')
  .replace(/^import[\s\S]*?from '[^']+';\n/gm, '');

function setup({ saved = null, reducedMotion = false, initialTime = 1_800_000_000_000, face = 'heads' } = {}) {
  let now = initialTime;
  let nextTimer = 0;
  const timers = new Map();
  const storage = new Map(saved ? [['coin-lab:test:game:v1', JSON.stringify(saved)], ['coin-lab:test:player:v1', '测试玩家']] : []);
  class Element {
    constructor(tag = 'div', attrs = {}) {
      this.tag = tag; this.attrs = attrs; this.id = attrs.id;
      this.value = attrs.value || ''; this.max = attrs.max; this.min = attrs.min;
      this.disabled = 'disabled' in attrs; this.hidden = 'hidden' in attrs;
      this.open = false; this.textContent = ''; this.children = []; this.listeners = {};
      this.dataset = Object.fromEntries(Object.entries(attrs).filter(([k]) => k.startsWith('data-')).map(([k, v]) => [k.slice(5), v]));
      const classes = new Set((attrs.class || '').split(' '));
      this.classList = { add: v => classes.add(v), remove: v => classes.delete(v), contains: v => classes.has(v),
        toggle: (v, flag = !classes.has(v)) => flag ? classes.add(v) : classes.delete(v) };
      this.style = { setProperty(k, v) { this[k] = v; } };
    }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    removeAttribute(k) { delete this.attrs[k]; }
    addEventListener(k, fn) { (this.listeners[k] ||= []).push(fn); }
    fire(type) {
      const event = { prevented: false, preventDefault() { this.prevented = true; }, target: this };
      for (const fn of this.listeners[type] || []) fn(event);
      return event;
    }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    showModal() { this.open = true; }
    close() { this.open = false; }
    focus() {}
    blur() {}
    remove() {}
    getContext() { return null; }
  }
  const elements = [...html.matchAll(/<([a-z][\w-]*)(\s[^>]*|)>/g)].map(([, tag, raw]) => {
    const attrs = Object.fromEntries([...raw.matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(([, key, value]) => [key, value || '']));
    return new Element(tag, attrs);
  });
  const byId = id => elements.find(e => e.id === id);
  const matches = (e, selector) => selector.startsWith('#') ? e.id === selector.slice(1)
    : selector.startsWith('.') ? e.classList.contains(selector.slice(1))
      : selector.startsWith('[') ? selector.slice(1, -1) in e.attrs : e.tag === selector;
  const document = Object.assign(new Element(), { body: new Element(), visibilityState: 'visible',
    getElementById: byId,
    querySelectorAll: selectors => elements.filter(e => selectors.split(',').some(s => matches(e, s.trim()))),
    querySelector: selector => elements.find(e => matches(e, selector)),
    createElement: tag => new Element(tag), createDocumentFragment: () => new Element() });
  const schedule = (fn, delay, repeat = false) => { const id = ++nextTimer; timers.set(id, { fn, at: now + delay, delay, repeat }); return id; };
  const context = vm.createContext({ ...engine, document, window: Object.assign(new Element(), { scrollTo() {} }),
    Date: class extends Date { static now() { return now; } },
    sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    setTimeout: (fn, delay) => schedule(fn, delay), clearTimeout: id => timers.delete(id),
    setInterval: (fn, delay) => schedule(fn, delay, true),
    matchMedia: () => ({ matches: reducedMotion }),
    // 确定结果，确保测试不受随机输赢影响。
    placeBet: (game, options) => engine.placeBet(game, { ...options, now, draw: () => face }),
    startGame: (game, at = now) => engine.startGame(game, at),
    finishGame: (game, reason, at = now) => engine.finishGame(game, reason, at),
    checkTime: (game, at = now) => engine.checkTime(game, at),
    restoreGame: (raw, at = now) => engine.restoreGame(raw, at),
    RESULT_IMAGE: { width: 600, height: 980, scale: 2 }, URL, Blob });
  vm.runInContext(source, context);
  const advance = ms => {
    const end = now + ms;
    for (;;) {
      const first = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!first) break;
      const [id, timer] = first; now = timer.at;
      if (timer.repeat) timer.at += timer.delay; else timers.delete(id);
      timer.fn();
    }
    now = end;
  };
  const start = (minutes = 5) => {
    byId('player-input').value = '测试玩家';
    byId('duration-range').value = String(minutes); byId('duration-range').fire('input');
    byId('welcome-form').fire('submit');
  };
  return { el: byId, start, advance, document, time: () => now, game: () => JSON.parse(storage.get('coin-lab:test:game:v1')) };
}

test('开始页默认五分钟，拖动时长同步文案并按所选七分钟开始', () => {
  const app = setup();
  assert.equal(app.el('duration-range').value, '5');
  assert.equal(app.el('bet-input').value, '1');
  assert.equal(app.el('bet-range').value, '1');
  app.start(7);
  assert.equal(app.el('duration-value').textContent, '7 分钟');
  assert.equal(app.el('timer').textContent, '07:00');
  assert.equal(app.game().durationMs, 420000);
  assert.equal(app.el('bet-input').value, '1');
  assert.equal(app.el('bet-range').value, '1');
});
test('下注滑条、输入框、加减按钮双向同步，输赢后上限跟随余额', () => {
  const app = setup(); app.start();
  app.el('bet-range').value = '1'; app.el('bet-range').fire('input');
  assert.equal(app.el('bet-input').value, '1');
  app.el('plus-button').fire('click'); assert.equal(app.el('bet-range').value, '2');
  app.el('bet-input').value = '100'; app.el('bet-input').fire('input');
  assert.equal(app.el('bet-range').value, '100');
  app.el('flip-button').fire('click'); app.advance(3500);
  assert.equal(app.el('bet-range').max, '200');
  assert.equal(app.el('bet-maximum').textContent, '最多 200 枚');
  app.el('flip-continue').fire('click');
  app.el('bet-input').value = '150'; app.el('bet-input').fire('input');
  app.document.querySelectorAll('[data-side]').find(e => e.dataset.side === 'tails').fire('click');
  app.el('flip-button').fire('click'); app.advance(3500);
  assert.equal(app.el('bet-range').max, '50');
  assert.equal(app.el('bet-range').value, '50');
  assert.equal(app.el('bet-input').value, '50');
});
test('3.5 秒内不揭晓、不重复下注，返回前台和减少动态效果均不缩短等待', () => {
  for (const reducedMotion of [false, true]) {
    const app = setup({ reducedMotion }); app.start();
    app.el('flip-button').fire('click');
    assert.equal(app.game().rounds.length, 1);
    assert.equal(app.el('flip-dialog').open, true);
    assert.equal(app.el('flip-dialog').fire('cancel').prevented, true);
    app.el('flip-dialog').fire('click');
    assert.equal(app.el('flip-dialog').open, true);
    assert.equal(app.el('balance').textContent, '100');
    assert.ok(app.el('bet-range').disabled && app.el('end-button').disabled && app.el('download-button').disabled);
    app.el('flip-button').fire('click'); assert.equal(app.game().rounds.length, 1);
    app.advance(1200); app.document.fire('visibilitychange');
    app.advance(2299); assert.equal(app.el('balance').textContent, '100');
    app.advance(1);
    assert.equal(app.el('flip-dialog').open, true);
    assert.equal(app.el('flip-dialog').classList.contains('is-win'), true);
    assert.equal(app.el('flip-delta').textContent, '+1 枚金币');
    assert.equal(app.el('balance').textContent, '101');
    assert.equal(app.el('flip-button').disabled, true);
    app.el('flip-button').fire('click'); assert.equal(app.game().rounds.length, 1);
    assert.match(app.el('result-message').textContent, /猜中了/);
    app.el('flip-continue').fire('click');
    assert.equal(app.el('flip-dialog').open, false);
    assert.equal(app.el('flip-button').disabled, false);
  }
});
test('截止前最后一投等待揭晓再展示结果，截止后不能再投', () => {
  const app = setup(); app.start(); app.advance(299000);
  app.el('flip-button').fire('click'); app.advance(1000);
  assert.equal(app.el('timer').textContent, '00:00');
  assert.equal(app.el('result-dialog').open, false);
  app.advance(2500);
  assert.equal(app.el('flip-dialog').open, true);
  assert.equal(app.el('flip-continue').textContent, '查看本局结果');
  assert.equal(app.el('result-dialog').open, false);
  app.el('flip-continue').fire('click');
  assert.equal(app.el('result-dialog').open, true);
  assert.equal(app.el('final-balance').textContent, '101');
  assert.equal(app.el('end-reason').textContent, '5 分钟，挑战完成');
  app.el('flip-button').fire('click'); assert.equal(app.game().rounds.length, 1);
});
test('刷新仍须等待本次揭晓，不重新抽样或接受下一笔下注', () => {
  const first = setup(); first.start(); first.el('flip-button').fire('click'); first.advance(1200);
  const restored = setup({ saved: first.game(), initialTime: first.time() });
  assert.equal(restored.el('flip-dialog').open, true);
  restored.el('flip-button').fire('click');
  assert.equal(restored.game().rounds.length, 1);
  restored.advance(2299); assert.equal(restored.el('flip-dialog').open, true);
  restored.advance(1); assert.equal(restored.el('flip-dialog').open, true);
  assert.equal(restored.el('flip-title').textContent, '猜中了！');
  assert.equal(restored.game().rounds.length, 1);
  const resultReload = setup({ saved: restored.game(), initialTime: restored.time() });
  assert.equal(resultReload.el('flip-dialog').open, true);
  assert.equal(resultReload.el('flip-title').textContent, '猜中了！');
  assert.equal(resultReload.el('flip-delta').textContent, '+1 枚金币');
  resultReload.el('flip-continue').fire('click');
  assert.equal(resultReload.el('flip-dialog').open, false);
  assert.equal(resultReload.game().revealAt, null);
  assert.equal(resultReload.game().flipPending, false);
});
test('正反两面按实际输赢呈现不同结果效果，未揭晓时不能提前继续', () => {
  for (const face of ['heads', 'tails']) for (const side of ['heads', 'tails']) {
    const app = setup({ face }); app.start();
    app.document.querySelectorAll('[data-side]').find(e => e.dataset.side === side).fire('click');
    app.el('flip-button').fire('click');
    app.el('flip-continue').fire('click');
    assert.equal(app.el('flip-dialog').open, true);
    assert.equal(app.el('flip-result').hidden, true);
    app.advance(3500);
    const won = face === side;
    assert.equal(app.el('flip-dialog').classList.contains('is-win'), won);
    assert.equal(app.el('flip-dialog').classList.contains('is-loss'), !won);
    assert.equal(app.el('flip-title').textContent, won ? '猜中了！' : '这次没猜中');
    assert.equal(app.el('flip-delta').textContent, won ? '+1 枚金币' : '−1 枚金币');
    assert.equal(app.el('flip-balance').textContent, `当前余额 ${won ? 101 : 99} 枚`);
    assert.match(app.el('coin').style.transform, face === 'heads' ? /rotateY\(0deg\)/ : /rotateY\(180deg\)/);
    assert.equal(app.el('flip-result').hidden, false);
  }
});
test('破产先显示本次失败效果，再查看本局结果；重新开始默认下注一枚', () => {
  const app = setup({ face: 'tails' }); app.start();
  app.el('bet-input').value = '100'; app.el('bet-input').fire('input');
  app.el('flip-button').fire('click'); app.advance(3500);
  assert.equal(app.el('flip-title').textContent, '这次没猜中');
  assert.equal(app.el('flip-delta').textContent, '−100 枚金币');
  assert.equal(app.el('flip-continue').textContent, '查看本局结果');
  assert.equal(app.el('result-dialog').open, false);
  app.el('flip-continue').fire('click');
  assert.equal(app.el('result-dialog').open, true);
  assert.equal(app.el('final-balance').textContent, '0');
  app.el('restart-button').fire('click'); app.start();
  assert.equal(app.el('bet-input').value, '1');
  assert.equal(app.el('bet-range').value, '1');
});
test('结果停留期间倒计时继续，时间到后继续按钮转为查看本局结果', () => {
  const app = setup(); app.start();
  app.el('flip-button').fire('click'); app.advance(3500);
  assert.equal(app.el('flip-continue').textContent, '继续挑战');
  app.advance(296500);
  assert.equal(app.el('flip-dialog').open, true);
  assert.equal(app.el('result-dialog').open, false);
  assert.equal(app.el('flip-continue').textContent, '查看本局结果');
  app.el('flip-continue').fire('click');
  assert.equal(app.el('result-dialog').open, true);
  assert.equal(app.game().rounds.length, 1);
});
test('余额为一时仍可下注一枚，余额减少后输入和滑条同步收窄', () => {
  const startedAt = 1_800_000_000_000;
  const saved = engine.placeBet(engine.startGame(engine.createGame(), startedAt), { side: 'tails', amount: 99, now: startedAt, draw: () => 'heads' });
  const app = setup({ saved });
  assert.equal(app.el('bet-range').max, '1');
  assert.equal(app.el('bet-input').value, '1');
  assert.equal(app.el('flip-button').disabled, false);
});
