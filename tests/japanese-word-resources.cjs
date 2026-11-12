const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadModule } = require('./helpers/load-module.cjs');
const assets = path.resolve(__dirname, '..', 'components/InputMethod/assets');
const { createInputMethod, getJapaneseCandidates } = loadModule(path.join(assets, 'dicUtil.js'));
const base = JSON.parse(fs.readFileSync(path.join(assets, 'dictionary/jp.txt'), 'utf8'));
const chineseBase = JSON.parse(fs.readFileSync(path.join(assets, 'dictionary/cn.txt'), 'utf8'));
assert.deepEqual(Object.keys(base), Object.keys(chineseBase), 'Japanese base uses the same fields as CN');
assert.equal(base.chars.neko, '猫', 'The base preserves original single-character candidates');
const vm = require('node:vm');
const original = vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../tools/dictionaries/dic_jp.js'), 'utf8').replace(/export\s*\{[^}]+\};?/g, '') + '\ngetDictJp()');
const sourceChars = Object.fromEntries(Object.entries(original).map(([key, value]) => [key, [...new Set(value)].join('')]));
assert.equal(Object.keys(base.chars).length, 1203, 'Preserve all original character readings');
assert.deepEqual(base.chars, sourceChars, 'The generated base preserves every character candidate and its order');
assert.ok(Array.isArray(base.syllables) && base.syllables.includes('shi'));
const letters = 'abcdefghijklmnopqrstuvwxyz';
let readings = 0, forms = 0, bytes = 0, maxBytes = 0;
for (const letter of letters) {
  const text = fs.readFileSync(path.join(assets, 'dictionary/jp-words-' + letter + '.txt'), 'utf8');
  const shard = JSON.parse(text);
  const chineseShard = JSON.parse(fs.readFileSync(path.join(assets, 'dictionary/words-' + letter + '.txt'), 'utf8'));
  assert.deepEqual(Object.keys(shard), Object.keys(chineseShard), 'Japanese word shards use the same fields as CN');
  assert.deepEqual(shard.initials, {}, 'Japanese has no newly introduced initials abbreviation mode');
  const keys = Object.keys(shard.words);
  assert.deepEqual(keys, keys.slice().sort(), 'Fixed reading order must survive generation');
  for (const key of keys) {
    assert.equal(key[0], letter, 'A word must belong to its current-letter shard');
    const values = typeof shard.words[key] === 'string' ? [shard.words[key]] : shard.words[key];
    assert.ok(values.length > 0);
    assert.equal(new Set(values).size, values.length, 'Equal words are deduplicated per reading');
    assert.ok(values.every(value => !value.includes('・')), key + ': alternative forms must be separate candidates');
    assert.equal(typeof shard.words[key] === 'string', values.length === 1, 'Like CN, singleton words are stored as strings');
    if (key.length >= 2) {
      assert.ok(shard.forward[key.slice(0, 2)].includes(keys.indexOf(key)), 'The forward index covers the word');
    }
    readings++; forms += values.length;
  }
  for (const prefix of Object.keys(shard.forward)) {
    for (const id of shard.forward[prefix]) {
      assert.ok(Number.isInteger(id) && id >= 0 && id < keys.length, 'Use valid shard-local numeric IDs');
      assert.equal(keys[id].slice(0, 2), prefix);
    }
  }
  const engine = createInputMethod();
  engine.installJapaneseWordShard(letter, shard);
  for (const key of keys) {
    const first = typeof shard.words[key] === 'string' ? shard.words[key] : shard.words[key][0];
    assert.ok(getJapaneseCandidates(key, {}, engine.dict.jpWordShard).chars.includes(first),
      'The first fixed-order word remains reachable: ' + key);
  }
  const size = Buffer.byteLength(text);
  assert.ok(size <= 64 * 1024, 'A Japanese word read must stay below the 64 KiB resource budget');
  bytes += size; maxBytes = Math.max(maxBytes, size);
}
const abura = JSON.parse(fs.readFileSync(path.join(assets, 'dictionary/jp-words-a.txt'), 'utf8'));
assert.deepEqual(abura.words.abura, ['脂', '油', 'あぶら'], 'Split middle-dot alternatives into individual surfaces');
assert.ok(readings >= 9000 && forms >= 10000, 'The generated input vocabulary must retain the JLPT dataset coverage');
assert.equal(fs.readdirSync(path.join(assets, 'dictionary')).filter(name => /^jp-[a-z]\.txt$/.test(name)).length, 0,
  'The CN-style package must not retain obsolete compact character shards');
console.log(JSON.stringify({ readings, forms, shards: letters.length, bytes, maxBytes }));
