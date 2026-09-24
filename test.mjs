// 遊びの中身のテスト。node test.mjs で走る（フレームワークなし）。
import assert from 'node:assert/strict';
import {
  SIZE, STARTS, PIECES, VARIANTS, newGame, canPlace, place, advance, hasMove, moves, corners, cpuMove, result, rotate, flip,
} from './game.js';

const test = (name, fn) => { fn(); console.log('✓', name); };
const key = (c) => JSON.stringify(c);

// 決まった並びの乱数（毎回同じ対局になる）
function seeded(n) {
  return () => { n = (n + 0x6d2b79f5) | 0; let t = Math.imul(n ^ (n >>> 15), 1 | n); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32; };
}

test('ブロックは 21 種・89 マス・向きは全部で 91 通り、どれも違う形', () => {
  assert.equal(PIECES.length, 21);
  assert.equal(PIECES.flat().length, 89);
  assert.equal(VARIANTS.flat().length, 91);
  const all = VARIANTS.flat().map(key);
  assert.equal(new Set(all).size, all.length);
});

test('4 回回す・2 回裏返すと元に戻る', () => {
  for (const v of VARIANTS) {
    const c = v[0];
    assert.equal(key(rotate(rotate(rotate(rotate(c))))), key(c));
    assert.equal(key(flip(flip(c))), key(c));
  }
});

test('最初の 1 手ははじまりのマスを覆う', () => {
  const s = newGame();
  const [x, y] = STARTS[0];
  assert.ok(canPlace(s, 0, [[0, 0]], x, y));
  assert.ok(!canPlace(s, 0, [[0, 0]], x + 1, y));
  assert.ok(!canPlace(s, 0, [[0, 0]], ...STARTS[1]));   // 相手のはじまりのマスではだめ
});

test('2 手目からは自分と角だけで触れる（辺はだめ、相手とは触れてよい）', () => {
  const s = newGame();
  place(s, 0, 0, [[0, 0]], 3, 9);
  assert.ok(canPlace(s, 0, [[0, 0]], 4, 8));            // 角
  assert.ok(!canPlace(s, 0, [[0, 0]], 4, 9));           // 辺
  assert.ok(!canPlace(s, 0, [[0, 0]], 5, 5));           // 離れている
  assert.ok(!canPlace(s, 0, [[0, 0]], 3, 9));           // 埋まっている
  assert.ok(!canPlace(s, 0, [[0, 0], [1, 0]], 3, 8));   // 角でも辺でも触れる → だめ
  place(s, 1, 0, [[0, 0]], 9, 3);
  s.board[8 * SIZE + 5] = 1;                            // 相手のマスを横に置いておく
  assert.ok(canPlace(s, 0, [[0, 0]], 4, 8));            // 相手と辺で触れても角でつながっていればよい
});

test('盤の外にははみ出せない', () => {
  const s = newGame();
  assert.ok(!canPlace(s, 0, PIECES[9], 10, 9));         // I5 が右にはみ出す
  assert.ok(canPlace(s, 0, PIECES[9], 3, 9));
  assert.throws(() => place(s, 0, 9, PIECES[9], 10, 9));
});

test('相手が置けなければパス、ふたりとも置けなければ終わり', () => {
  const s = newGame();
  place(s, 0, 0, [[0, 0]], 3, 9);
  s.hands[1] = [];                                      // CPU の手持ちをなくす
  advance(s);
  assert.equal(s.turn, 0);
  assert.deepEqual(s.out, [false, true]);
  assert.ok(!s.over);
  s.hands[0] = [];
  advance(s);
  assert.ok(s.over);
});

test('使える角', () => {
  const s = newGame();
  assert.deepEqual(corners(s, 0), [STARTS[0]]);
  place(s, 0, 0, [[0, 0]], 3, 9);
  assert.deepEqual(corners(s, 0).map(key).sort(), [[2, 8], [4, 8], [2, 10], [4, 10]].map(key).sort());
});

test('CPU は置ける手を返し、最初は大きいブロックを選ぶ', () => {
  const s = newGame();
  place(s, 0, 0, [[0, 0]], 3, 9);
  const m = cpuMove(s, 1, seeded(1));
  assert.ok(canPlace(s, 1, m.cells, m.x, m.y));
  assert.equal(m.cells.length, 5);
  s.hands[1] = [];
  assert.equal(cpuMove(s, 1), null);
});

test('CPU 同士で最後まで打つと、ちゃんと終わり、得点は置いたマスの数', () => {
  for (let seed = 1; seed <= 3; seed++) {
    const rand = seeded(seed);
    const s = newGame();
    let n = 0;
    while (!s.over) {
      const m = cpuMove(s, s.turn, rand);
      assert.ok(m, '置ける手があるはずの番');
      place(s, s.turn, m.piece, m.cells, m.x, m.y);
      advance(s);
      assert.ok(++n <= 42);
    }
    assert.ok(!hasMove(s, 0) && !hasMove(s, 1));
    for (const p of [0, 1]) {
      assert.equal(s.placed[p], s.board.filter((c) => c === p).length);
      assert.equal(s.placed[p] + s.hands[p].reduce((a, i) => a + PIECES[i].length, 0), 89);
    }
    assert.ok(['win', 'lose', 'draw'].includes(result(s)));
    assert.equal([...moves(s, 0)].length, 0);
  }
});
