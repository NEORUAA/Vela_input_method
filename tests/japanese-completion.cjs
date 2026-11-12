const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadModule } = require('./helpers/load-module.cjs');
const root = path.resolve(__dirname, '..');
const engine = loadModule(path.join(root, 'components/InputMethod/assets/dicUtil.js'));

// Literal lexical fixtures pin whole-word conversion, not just kana generation.
const words = {
  gakkou: ['学校'], "kan'i": ['簡易'], "kan'you": ['寛容'], kanyuu: ['加入'], maccha: ['抹茶'], ni: ['荷'], nihon: ['日本'],
  nihongo: ['日本語'], nihonjin: ['日本人'], shashin: ['写真'], shigoto: ['仕事'],
  shin: ['芯'], shina: ['品'], shinbun: ['新聞'], "shin'you": ['信用']
};
const forward = { ga: ['gakkou'], ka: ["kan'i", "kan'you", 'kanyuu'], ma: ['maccha'],
  ni: ['ni', 'nihon', 'nihongo', 'nihonjin'], sh: ['shashin', 'shigoto', 'shin', 'shina', 'shinbun', "shin'you"] };
const shard = { words, forward };
const search = input => engine.getJapaneseCandidates(input, {}, shard);
const candidate = (input, text) => search(input).candidates.find(item => item.text === text);

assert.ok(candidate('nihongo', '日本語'), 'Whole-word conversion must offer 日本語, not individual 日/本/語 only');
assert.equal(search('').chars.length, 0, 'An empty composition must not show unrelated completions');
assert.equal(candidate('nihongo', '日本語').offset, 7);
assert.ok(candidate('gakkou', '学校'), 'Keep doubled-consonant conversion when looking up words');
assert.ok(candidate('gakk', '学校'), 'An unfinished doubled consonant keeps the same word completion');
assert.ok(candidate('macc', '抹茶') && candidate('macch', '抹茶') && candidate('match', '抹茶'),
  'Unfinished doubled/alternate consonants preserve the following syllable context');
for (const input of ["shin'", 'shinn']) {
  assert.ok(candidate(input, '新聞'), 'Explicit nasal allows words starting with しん');
  assert.ok(!candidate(input, '品'), 'Explicit nasal must not complete the different reading しな');
}
assert.ok(candidate("kan'y", '寛容') && !candidate("kan'y", '加入'),
  'Explicit nasal remains separate from contracted ny after an unfinished y');
assert.equal(candidate("shin'y", '信用').offset, 6, 'Nasal-plus-y completion consumes the complete typed prefix');
assert.ok(candidate('sigoto', '仕事'), 'si and shi spellings must reach the same word');
assert.ok(candidate("kan'i", '簡易'), 'Nasal separators must preserve the actual reading');
assert.ok(!candidate('kani', '簡易'), 'かに must not be confused with かんい');
for (const text of ['日本', '日本語', '日本人', 'にほんご']) {
  assert.ok(candidate('niho', text), 'Prefix completion: niho → ' + text);
  assert.equal(candidate('niho', text).offset, 4, 'Completing a word consumes the typed prefix');
}
assert.ok(candidate('nihong', '日本語'), 'Unfinished g is part of the completion query');
assert.ok(search('niho').chars.indexOf('日本語') < search('niho').chars.indexOf('荷'),
  'Completions of the full typed prefix precede shorter consumed-word fallbacks');
assert.ok(candidate('sh', '写真'), 'An unfinished digraph can still complete a word');
assert.equal(candidate('nihongow', '日本語').offset, 7, 'Selecting a word preserves the following unfinished tail');
const exact = search('nihon').candidates.map(item => item.text);
assert.ok(exact.indexOf('日本') < exact.indexOf('日本語'), 'Exact reading precedes longer completions');
assert.equal(new Set(exact).size, exact.length, 'Do not duplicate equal surface candidates');
const realTShard = JSON.parse(fs.readFileSync(path.join(root, 'components/InputMethod/assets/dictionary/jp-words-t.txt')));
const apostropheCandidates = engine.getJapaneseCandidates("tan'i", {}, realTShard).candidates.map(item => item.text);
assert.ok(apostropheCandidates.includes('単位'), 'An apostrophe must preserve the tan\'i reading');
assert.ok(!apostropheCandidates.includes('谷'), 'An apostrophe must not fall back to the tani reading');
const singleLetterShard = { words: { g: '字' }, forward: {} };
Object.defineProperty(singleLetterShard, 'wordKeys', {
  get() { throw new Error('single-letter lookup must not scan wordKeys'); }
});
assert.ok(engine.getJapaneseCandidates('g', {}, singleLetterShard).candidates.some(item => item.text === '字'),
  'Single-letter lookup must stop after its exact word');
const stable = JSON.stringify(search('niho'));
search('sh'); search('gakkou');
assert.equal(JSON.stringify(search('niho')), stable, 'Candidate order must not learn from earlier queries');
const many = { words: { na: Array.from({ length: 200 }, (_, i) => '候補' + i) }, forward: {} };
assert.ok(engine.getJapaneseCandidates('na', {}, many).candidates.length <= 16,
  'A common prefix must not expand an unbounded word list into reactive candidates');
console.log('Passed: Japanese whole words, prefix completion, spelling aliases, exact priority and consumption offsets.');
