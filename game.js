// カドツギの遊びの中身（盤・ブロック・置ける判定・パス・終わり・得点・CPU）。
// DOM には触らない。ブラウザでは main.js から、テストでは node test.mjs から読む。

export const SIZE = 13;
export const STARTS = [[3, 9], [9, 3]];   // はじまりのマス。0 = あなた、1 = CPU
const CENTER = (SIZE - 1) / 2;

// 1〜5 マスの形すべて 21 種。[x, y]、x が右、y が下
export const PIECES = [
  [[0, 0]],
  [[0, 0], [1, 0]],
  [[0, 0], [1, 0], [2, 0]],
  [[0, 0], [1, 0], [1, 1]],
  [[0, 0], [1, 0], [2, 0], [3, 0]],
  [[0, 0], [1, 0], [2, 0], [2, 1]],
  [[0, 0], [1, 0], [2, 0], [1, 1]],
  [[0, 0], [1, 0], [1, 1], [2, 1]],
  [[0, 0], [1, 0], [0, 1], [1, 1]],
  [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]],
  [[0, 0], [1, 0], [2, 0], [3, 0], [3, 1]],
  [[0, 0], [1, 0], [2, 0], [3, 0], [1, 1]],
  [[0, 0], [1, 0], [2, 0], [2, 1], [3, 1]],
  [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1]],
  [[0, 0], [0, 1], [1, 1], [2, 1], [2, 0]],
  [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]],
  [[0, 0], [1, 0], [1, 1], [2, 1], [2, 2]],
  [[0, 0], [1, 0], [2, 0], [1, 1], [1, 2]],
  [[0, 0], [0, 1], [1, 1], [2, 1], [2, 2]],
  [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]],
  [[1, 0], [1, 1], [0, 1], [0, 2], [2, 1]],
];

// 最小の x・y を 0 にずらし、並べ替える（同じ形なら同じ並びになる）
export function normalize(cells) {
  const mx = Math.min(...cells.map((c) => c[0]));
  const my = Math.min(...cells.map((c) => c[1]));
  return cells.map(([x, y]) => [x - mx, y - my]).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}
export const rotate = (cells) => normalize(cells.map(([x, y]) => [y, -x]));
export const flip = (cells) => normalize(cells.map(([x, y]) => [-x, y]));

// 1 つの形の向き（回転・裏返しで最大 8 通り、同じものは 1 つに）
export function variants(cells) {
  const out = new Map();
  let c = normalize(cells);
  for (let f = 0; f < 2; f++) {
    for (let r = 0; r < 4; r++) { out.set(JSON.stringify(c), c); c = rotate(c); }
    c = flip(c);
  }
  return [...out.values()];
}
export const VARIANTS = PIECES.map(variants);

export function newGame() {
  const all = PIECES.map((_, i) => i);
  return {
    board: new Array(SIZE * SIZE).fill(-1),   // -1 = 空き、0 / 1 = その人のマス
    hands: [[...all], [...all]],              // 残りのブロックの番号
    placed: [0, 0],                           // 盤に置いたマスの数（= 得点）
    moves: [0, 0],                            // 置いたブロックの数
    turn: 0,
    out: [false, false],                      // もう置けない（以後は飛ばす）
    over: false,
  };
}

const own = (s, p, x, y) => x >= 0 && y >= 0 && x < SIZE && y < SIZE && s.board[y * SIZE + x] === p;

// cells を (ox, oy) にずらして p が置けるか
export function canPlace(s, p, cells, ox, oy) {
  const first = s.moves[p] === 0;
  let touch = false;
  for (const [cx, cy] of cells) {
    const x = ox + cx, y = oy + cy;
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE || s.board[y * SIZE + x] !== -1) return false;
    if (own(s, p, x - 1, y) || own(s, p, x + 1, y) || own(s, p, x, y - 1) || own(s, p, x, y + 1)) return false;
    if (first) touch ||= x === STARTS[p][0] && y === STARTS[p][1];
    else touch ||= own(s, p, x - 1, y - 1) || own(s, p, x + 1, y - 1) || own(s, p, x - 1, y + 1) || own(s, p, x + 1, y + 1);
  }
  return touch;
}

// 置けるすべての手（ブロック × 向き × 位置）
export function* moves(s, p, pieces = s.hands[p]) {
  for (const piece of pieces) {
    for (const cells of VARIANTS[piece]) {
      for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) if (canPlace(s, p, cells, x, y)) yield { piece, cells, x, y };
      }
    }
  }
}
export const hasMove = (s, p, pieces) => !moves(s, p, pieces).next().done;

export function place(s, p, piece, cells, x, y) {
  if (!s.hands[p].includes(piece) || !canPlace(s, p, cells, x, y)) throw new Error('置けない手');
  for (const [cx, cy] of cells) s.board[(y + cy) * SIZE + x + cx] = p;
  s.hands[p] = s.hands[p].filter((i) => i !== piece);
  s.placed[p] += cells.length;
  s.moves[p]++;
}

// 置いたあとに次の番を決める。相手が置けなければパス、ふたりとも置けなければ終わり
export function advance(s) {
  const o = 1 - s.turn;
  if (hasMove(s, o)) s.turn = o;
  else if (hasMove(s, s.turn)) s.out[o] = true;
  else { s.out = [true, true]; s.over = true; }
  return s;
}

// 使える角 = 空きマスで、p のマスと斜めに隣り合い、上下左右には隣り合わないマス（最初の 1 手の前ははじまりのマス）
export function corners(s, p) {
  if (s.moves[p] === 0) {
    const [x, y] = STARTS[p];
    return s.board[y * SIZE + x] === -1 ? [[x, y]] : [];
  }
  const out = [];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (s.board[y * SIZE + x] !== -1) continue;
      if (own(s, p, x - 1, y) || own(s, p, x + 1, y) || own(s, p, x, y - 1) || own(s, p, x, y + 1)) continue;
      if (own(s, p, x - 1, y - 1) || own(s, p, x + 1, y - 1) || own(s, p, x - 1, y + 1) || own(s, p, x + 1, y + 1)) out.push([x, y]);
    }
  }
  return out;
}

// 結果（あなたから見て）
export const result = (s) => (s.placed[0] > s.placed[1] ? 'win' : s.placed[0] < s.placed[1] ? 'lose' : 'draw');

// CPU「ふつう」の調整つまみ。強すぎ・弱すぎならここを変える
export const CPU = {
  size: 100,        // 大きさ × これ
  myCorner: 4,      // 置いたあと自分が使える角の数 × これ
  oppCorner: 4,     // 置いたあと相手が使える角の数 × これ（引く）
  center: 1,        // 盤の中心からの距離の合計 × これ（引く）
  centerMoves: 3,   // 中心に寄せるのは最初のこの手数だけ
  noise: 2,         // 同点の並びを変える乱数の幅
};

// 1 手先だけを見て、点が一番高い手を返す。置けなければ null
export function cpuMove(s, p, rand = Math.random) {
  let best = null, bestScore = -Infinity;
  const early = s.moves[p] < CPU.centerMoves;
  for (const m of moves(s, p)) {
    const idx = m.cells.map(([cx, cy]) => (m.y + cy) * SIZE + m.x + cx);
    for (const i of idx) s.board[i] = p;
    s.moves[p]++;
    let score = m.cells.length * CPU.size + CPU.myCorner * corners(s, p).length - CPU.oppCorner * corners(s, 1 - p).length;
    s.moves[p]--;
    for (const i of idx) s.board[i] = -1;
    if (early) {
      for (const [cx, cy] of m.cells) score -= CPU.center * (Math.abs(m.x + cx - CENTER) + Math.abs(m.y + cy - CENTER));
    }
    score += rand() * CPU.noise;
    if (score > bestScore) { bestScore = score; best = m; }
  }
  return best;
}
