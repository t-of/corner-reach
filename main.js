// 画面と操作。遊びの中身は game.js にある。
import { SIZE, STARTS, PIECES, VARIANTS, newGame, canPlace, place, advance, moves, hasMove, corners, cpuMove, result, rotate, flip } from './game.js';

// localStorage はほかのアプリと共有される（同じ t-of.github.io のため）。
// キーは必ず 'kadotsugi.' で始める。
const STORE = 'kadotsugi.';

function load(key, fallback) {
  try {
    const v = localStorage.getItem(STORE + key);
    return v == null ? fallback : { ...fallback, ...JSON.parse(v) };
  } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(STORE + key, JSON.stringify(value)); } catch { /* 保存できなくても遊べる */ }
}

WebAppKit.init({ title: 'カドツギ', text: 'ブロックを角と角だけでつないで広げていく、CPU とのふたり陣取り。相手より多くのマスを盤に置けたら勝ち。' });

// localhost でも動かす（audit のオフライン確認のため）。自分のファイルは network-first なので開発の邪魔にならない
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js');
}

// ---- ここからアプリ本体 ----

const $ = (id) => document.getElementById(id);
let stats = load('stats', { v: 1, played: 0, win: 0, lose: 0, draw: 0, best: 0 });
let settings = load('settings', { v: 1, seenHelp: false, sound: true });

// ---- 効果音（Web Audio で作る。音声ファイルは使わない） ----
// iPhone のマナーモードでも鳴らす（Safari 16.4 以降）。
// 'playback' にすると音楽アプリの曲が止まるので、アプリの音がオンのときだけにする。
function setAudioSession(soundOn) {
  try { if (navigator.audioSession) navigator.audioSession.type = soundOn ? 'playback' : 'auto'; } catch { /* 対応していない */ }
}
const Sound = {
  ctx: null, out: null, lastAt: {},
  // 最初に触ったときに呼ぶ（ブラウザは触る前の音を止める）
  ensure() {
    if (!settings.sound) return null;
    if (!this.ctx || this.ctx.state === 'suspended') setAudioSession(true);
    if (!this.ctx) {
      try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; }
      this.out = this.ctx.createGain();
      this.out.gain.value = 0.6;   // 全体を控えめに
      this.out.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  },
  // 同じ音が 60ms 以内に続いたら鳴らさない（連打で重ならない）
  go(name) {
    const c = this.ensure();
    if (!c) return null;
    if (c.currentTime - (this.lastAt[name] ?? -1) < 0.06) return null;
    this.lastAt[name] = c.currentTime;
    return c;
  },
  tone(c, freq, dur, { type = 'sine', gain = 0.1, at = 0, bend = 1 } = {}) {
    const t = c.currentTime + at;
    const o = c.createOscillator(), v = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (bend !== 1) o.frequency.exponentialRampToValueAtTime(freq * bend, t + dur);
    v.gain.setValueAtTime(0.0001, t);
    v.gain.exponentialRampToValueAtTime(gain, t + 0.006);
    v.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(v).connect(this.out);
    o.start(t); o.stop(t + dur + 0.05);
  },
  // ブロックを盤に置く「コトッ」。短いノイズ + 低い音
  thock(c, pitch, gain) {
    const len = (0.04 * c.sampleRate) | 0;
    const buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 5;
    const src = c.createBufferSource(), f = c.createBiquadFilter(), v = c.createGain();
    src.buffer = buf; f.type = 'bandpass'; f.frequency.value = pitch * 9; f.Q.value = 0.9; v.gain.value = gain;
    src.connect(f).connect(v).connect(this.out); src.start();
    this.tone(c, pitch, 0.12, { gain: gain * 0.5, bend: 0.6 });
  },
  select() { const c = this.go('select'); if (c) this.tone(c, 880, 0.05, { gain: 0.05 }); },
  turn() { const c = this.go('turn'); if (c) this.tone(c, 660, 0.05, { type: 'triangle', gain: 0.06, bend: 1.25 }); },
  place() { const c = this.go('place'); if (c) this.thock(c, 190, 0.5); },
  cpu() { const c = this.go('cpu'); if (c) this.thock(c, 150, 0.35); },
  pass() { const c = this.go('pass'); if (c) { this.tone(c, 392, 0.16, { gain: 0.06 }); this.tone(c, 294, 0.24, { gain: 0.06, at: 0.13 }); } },
  start() { const c = this.go('start'); if (c) { this.tone(c, 523, 0.12, { type: 'triangle', gain: 0.06 }); this.tone(c, 784, 0.18, { type: 'triangle', gain: 0.06, at: 0.08 }); } },
  end(r, best) {
    const c = this.go('end'); if (!c) return;
    const notes = { win: [523, 659, 784, 1047], lose: [392, 330, 262], draw: [523, 523] }[r];
    notes.forEach((f, i) => this.tone(c, f, 0.35, { type: 'triangle', gain: 0.07, at: i * 0.12 }));
    // 最高記録を更新したら、きらっと 2 音
    if (best) [1319, 1760].forEach((f, i) => this.tone(c, f, 0.3, { gain: 0.04, at: notes.length * 0.12 + 0.1 + i * 0.08 }));
  },
};
setAudioSession(settings.sound);
document.addEventListener('pointerdown', () => Sound.ensure(), { capture: true });

// 音のオン・オフ（タイトルと対局の両方に置く）
const soundButtons = document.querySelectorAll('[data-sound]');
function renderSound() {
  soundButtons.forEach((b) => {
    b.setAttribute('aria-pressed', settings.sound);
    b.setAttribute('aria-label', settings.sound ? '音をオフにする' : '音をオンにする');
    if (b.classList.contains('pill')) b.querySelector('span').textContent = settings.sound ? '音 オン' : '音 オフ';
  });
}
soundButtons.forEach((b) => b.addEventListener('click', () => {
  settings = { ...settings, sound: !settings.sound };
  save('settings', settings);
  setAudioSession(settings.sound);
  renderSound();
  Sound.select();
}));
renderSound();

let g = null;          // 対局
let sel = null;        // 選んでいるブロックの影 { piece, cells, x, y }
let busy = false;      // CPU の番・パスの表示中
let last = new Set();  // CPU が今置いたマス（枠を付ける）
let told = [false, false];   // パスの知らせを出したか

// ---- 盤と手持ちを作る ----
const cells = [];
for (let i = 0; i < SIZE * SIZE; i++) {
  const c = document.createElement('div');
  c.className = 'cell';
  $('board').append(c);
  cells.push(c);
}
const handButtons = PIECES.map((shape, piece) => {
  const b = document.createElement('button');
  b.className = 'piece';
  b.setAttribute('aria-label', `${shape.length} マスのブロック`);
  // 5×5 の中央に描く
  const w = Math.max(...shape.map((c) => c[0])) + 1, h = Math.max(...shape.map((c) => c[1])) + 1;
  const d = shape.map(([x, y]) => `M${x + (5 - w) / 2} ${y + (5 - h) / 2}h1v1h-1z`).join('');
  b.innerHTML = `<svg viewBox="0 0 5 5" aria-hidden="true"><path d="${d}"/></svg>`;
  b.addEventListener('click', () => { Sound.select(); choose(piece); });
  $('hand').append(b);
  return b;
});

// ---- 影 ----
const size = (c) => [Math.max(...c.map((p) => p[0])) + 1, Math.max(...c.map((p) => p[1])) + 1];
const pivot = (c) => size(c).map((n) => Math.floor((n - 1) / 2));   // 影の中心のマス
const centerDist = (m) => { const [px, py] = pivot(m.cells); return Math.abs(m.x + px - 6) + Math.abs(m.y + py - 6); };

function clamp() {
  const [w, h] = size(sel.cells);
  sel.x = Math.min(Math.max(sel.x, 0), SIZE - w);
  sel.y = Math.min(Math.max(sel.y, 0), SIZE - h);
}
function moveCenterTo(x, y) {
  const [px, py] = pivot(sel.cells);
  sel.x = x - px; sel.y = y - py;
  clamp();
}

function choose(piece) {
  if (!myTurn() || !g.hands[0].includes(piece)) return;
  // 最初の位置は、置ける位置のうち盤の中心に近いところ。今の向きを先に探し、だめならほかの向き
  const all = [...moves(g, 0, [piece])];
  const same = all.filter((m) => m.cells === VARIANTS[piece][0]);
  const pick = (list) => list.reduce((a, m) => (!a || centerDist(m) < centerDist(a) ? m : a), null);
  const m = pick(same) || pick(all);
  if (m) sel = { piece, cells: m.cells, x: m.x, y: m.y };
  else { sel = { piece, cells: VARIANTS[piece][0], x: 0, y: 0 }; moveCenterTo(6, 6); }
  render();
}
function turnShadow(fn) {
  if (!sel || !myTurn()) return;
  const [px, py] = pivot(sel.cells);
  const cx = sel.x + px, cy = sel.y + py;
  Sound.turn();
  sel.cells = fn(sel.cells);
  moveCenterTo(cx, cy);
  render();
}
const canPut = () => !!sel && myTurn() && canPlace(g, 0, sel.cells, sel.x, sel.y);
const myTurn = () => !!g && !g.over && g.turn === 0 && !busy;

// ---- 盤をなぞる・タップする ----
let drag = null;
$('board').addEventListener('pointerdown', (e) => {
  if (!sel || !myTurn()) return;
  try { $('board').setPointerCapture(e.pointerId); } catch { /* 指がもう離れている */ }
  drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: sel.x, oy: sel.y, moved: false };
});
$('board').addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id || !sel) return;
  const cell = $('board').getBoundingClientRect().width / SIZE;
  const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
  if (Math.hypot(dx, dy) > 8) drag.moved = true;
  if (!drag.moved) return;
  const x = sel.x, y = sel.y;
  sel.x = drag.ox + Math.round(dx / cell);
  sel.y = drag.oy + Math.round(dy / cell);
  clamp();
  if (x !== sel.x || y !== sel.y) render();
});
$('board').addEventListener('pointerup', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const moved = drag.moved;
  drag = null;
  if (moved || !sel) return;
  const r = $('board').getBoundingClientRect();
  const x = Math.floor((e.clientX - r.left) / r.width * SIZE), y = Math.floor((e.clientY - r.top) / r.height * SIZE);
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  moveCenterTo(x, y);
  render();
});
$('board').addEventListener('pointercancel', () => { drag = null; });

// ---- 手番 ----
function put() {
  if (!canPut()) return;
  place(g, 0, sel.piece, sel.cells, sel.x, sel.y);
  Sound.place();
  sel = null;
  last = new Set();
  next();
}

// 時間をおいて呼ぶ。そのあいだに対局をやめていたら何もしない
function later(fn, ms) {
  const game = g;
  setTimeout(() => { if (g === game) fn(); }, ms);
}

function next() {
  advance(g);
  if (g.over) { busy = true; render(); later(finish, 700); return; }
  // パスになった人を 1 回だけ知らせる
  let wait = 0;
  if ((g.out[0] && !told[0]) || (g.out[1] && !told[1])) Sound.pass();
  if (g.out[0] && !told[0]) { told[0] = true; notice('置けるブロックがありません。\nパスします'); wait = 1500; }
  if (g.out[1] && !told[1]) { told[1] = true; notice('CPU は置けるブロックがありません。\nパスします'); }
  busy = g.turn === 1;
  render();
  if (g.turn === 1) later(cpuTurn, wait || (g.out[0] ? 250 : 400 + Math.random() * 200));
}

function cpuTurn() {
  const m = cpuMove(g, 1);   // advance で置ける手があるのを確かめてある
  place(g, 1, m.piece, m.cells, m.x, m.y);
  Sound.cpu();
  last = new Set(m.cells.map(([cx, cy]) => (m.y + cy) * SIZE + m.x + cx));
  next();
}

let noticeTimer = 0;
function notice(text) {
  $('notice').textContent = text;
  $('notice').hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { $('notice').hidden = true; }, 1500);
}

// ---- 描く ----
function render() {
  const mine = myTurn() ? new Set(corners(g, 0).map(([x, y]) => y * SIZE + x)) : new Set();
  const ghost = new Map();
  if (sel && myTurn()) {
    const ok = canPlace(g, 0, sel.cells, sel.x, sel.y);
    for (const [cx, cy] of sel.cells) ghost.set((sel.y + cy) * SIZE + sel.x + cx, ok ? 'ok' : 'ng');
  }
  const starts = STARTS.map(([x, y]) => y * SIZE + x);
  cells.forEach((c, i) => {
    const v = g.board[i];
    let cls = 'cell';
    if (v >= 0) cls += ` p${v}`;
    else if (starts[0] === i && g.moves[0] === 0) cls += ' start0';
    else if (starts[1] === i && g.moves[1] === 0) cls += ' start1';
    else if (mine.has(i)) cls += ' hint';
    if (ghost.has(i)) cls += ` ${ghost.get(i)}`;
    c.className = cls;
    c.style.boxShadow = last.has(i) && !ghost.has(i) ? frame(i) : '';
  });

  for (const p of [0, 1]) {
    $(`score${p}`).querySelector('b').textContent = g.placed[p];
    $(`score${p}`).classList.toggle('is-turn', !g.over && g.turn === p);
  }
  $('turn').textContent = g.over ? 'おしまい' : g.turn === 1 ? 'CPU が考えています…' : sel ? '盤をなぞって動かし、［置く］で決める' : '手持ちからブロックを選ぶ';

  const turn = myTurn();
  const blocked = blockedPieces();
  handButtons.forEach((b, piece) => {
    const has = g.hands[0].includes(piece);
    b.classList.toggle('is-used', !has);
    b.classList.toggle('is-on', !!sel && sel.piece === piece);
    b.classList.toggle('is-blocked', has && blocked.has(piece));
    b.disabled = !has || !turn;
  });
  $('game').classList.toggle('is-over', g.over);
  $('rotate').disabled = $('flip').disabled = !sel || !turn;
  $('place').disabled = !canPut();
}

// どこにも置けない手持ち（盤が変わったときだけ調べ直す）
let blockedMemo = { key: '', set: new Set() };
function blockedPieces() {
  const key = `${g.moves[0]},${g.moves[1]}`;
  if (blockedMemo.key !== key) blockedMemo = { key, set: new Set(g.hands[0].filter((p) => !hasMove(g, 0, [p]))) };
  return blockedMemo.set;
}

// CPU が今置いたブロックの外側に枠
function frame(i) {
  const x = i % SIZE, y = Math.floor(i / SIZE);
  const has = (dx, dy) => last.has((y + dy) * SIZE + x + dx) && x + dx >= 0 && x + dx < SIZE;
  const w = '3px', c = '#fff';
  return [
    !has(0, -1) && `inset 0 ${w} ${c}`,
    !has(0, 1) && `inset 0 -${w} ${c}`,
    !has(-1, 0) && `inset ${w} 0 ${c}`,
    !has(1, 0) && `inset -${w} 0 ${c}`,
  ].filter(Boolean).join(',');
}

// ---- 画面 ----
function show(screen) {
  $('title').hidden = screen !== 'title';
  $('game').hidden = screen !== 'game';
  $('result').hidden = true;
}

function renderStats() {
  $('stats').textContent = stats.played
    ? `勝ち ${stats.win} ・ 負け ${stats.lose} ・ 引き分け ${stats.draw} ・ 最高 ${stats.best} マス`
    : 'はじめての対局に挑もう';
}

function start() {
  g = newGame();
  Sound.start();
  sel = null; busy = false; last = new Set(); told = [false, false];
  $('notice').hidden = true;
  show('game');
  render();
}

function finish() {
  clearTimeout(noticeTimer);
  $('notice').hidden = true;
  const r = result(g);
  const [me, cpu] = g.placed;
  Sound.end(r, me > stats.best && stats.played > 0);
  stats = { ...stats, played: stats.played + 1, [r]: stats[r] + 1, best: Math.max(stats.best, me) };
  save('stats', stats);
  $('result-head').textContent = { win: '勝ち', lose: '負け', draw: '引き分け' }[r];
  $('result-head').className = `result__head ${r}`;
  $('result-score').textContent = `あなた ${me} マス ／ CPU ${cpu} マス`;
  $('result-left').textContent = `残ったブロック あなた ${g.hands[0].length} 個 ／ CPU ${g.hands[1].length} 個`;
  $('result').hidden = false;
}

function shareText() {
  const [me, cpu] = g.placed;
  return {
    win: `カドツギで CPU に ${me} 対 ${cpu} で勝ち！`,
    lose: `カドツギで CPU に ${me} 対 ${cpu} で負けた…次は勝つ！`,
    draw: `カドツギで CPU と ${me} 対 ${cpu} で引き分け！`,
  }[result(g)];
}

const help = $('help');
let afterHelp = null;
function openHelp(then = null) { afterHelp = then; help.showModal(); }
help.addEventListener('close', () => { const f = afterHelp; afterHelp = null; if (f) f(); });
$('help-close').addEventListener('click', () => help.close());

$('play').addEventListener('click', () => {
  if (settings.seenHelp) return start();
  settings = { ...settings, seenHelp: true };
  save('settings', settings);
  openHelp(start);
});
$('howto').addEventListener('click', () => openHelp());
$('quit').addEventListener('click', () => {
  if (g.over || confirm('対局をやめて、タイトルへ戻りますか？')) { g = null; renderStats(); show('title'); }
});
$('rotate').addEventListener('click', () => turnShadow(rotate));
$('flip').addEventListener('click', () => turnShadow(flip));
$('place').addEventListener('click', put);
$('again').addEventListener('click', start);
$('share-result').addEventListener('click', () => WebAppKit.share({ text: shareText() }));
$('to-title').addEventListener('click', () => { g = null; renderStats(); show('title'); });

// PC 用: R 回す / F 裏返す / Enter 置く / 矢印で動かす
document.addEventListener('keydown', (e) => {
  if (!g || help.open) return;
  const k = e.key;
  if (k === 'r' || k === 'R') turnShadow(rotate);
  else if (k === 'f' || k === 'F') turnShadow(flip);
  else if (k === 'Enter' && canPut()) { e.preventDefault(); put(); }
  else if (sel && myTurn() && k.startsWith('Arrow')) {
    e.preventDefault();
    sel.x += { ArrowLeft: -1, ArrowRight: 1 }[k] || 0;
    sel.y += { ArrowUp: -1, ArrowDown: 1 }[k] || 0;
    clamp();
    render();
  }
});

renderStats();
