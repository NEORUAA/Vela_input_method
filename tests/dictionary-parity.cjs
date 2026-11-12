const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
process.chdir(require('node:path').resolve(__dirname, '..'));

const strip = source => source.replace(/export\s*\{[^}]+\};?/g, '');
const names = {
  'dic.js': 'getDict',
  'dic_jp.js': 'getDictJp',
  'dic_words.js': 'getWords',
  'dic_words_initials.js': 'getInitialsIndex',
  'pinyin_syllables.js': 'syllables'
};
const source = {};
for (const [file, name] of Object.entries(names)) {
  source[name] = vm.runInNewContext(strip(fs.readFileSync('tools/dictionaries/' + file, 'utf8')) + '\n' + name);
}
const createEngine = vm.runInNewContext(strip(fs.readFileSync('components/InputMethod/assets/dicUtil.js', 'utf8')) + '\ncreateInputMethod');
const { loadModule } = require('./helpers/load-module.cjs');
const { createJapaneseDictionary } = loadModule(require('node:path').resolve('components/InputMethod/assets/dictionaryLoader.js'), {
  '@system.file': { default: {} }
});
const engine = createEngine();
const base = 'components/InputMethod/assets/dictionary/';
engine.initDict(JSON.parse(fs.readFileSync(base + 'cn.txt')));
engine.dict.romaji2kanji = createJapaneseDictionary(fs.readFileSync(base + 'jp.txt', 'utf8'));
const words = source.getWords();
const chars = source.getDict();
const initials = source.getInitialsIndex();
const japanese = source.getDictJp();
const shards = {};
for (const letter of 'abcdefghijklmnopqrstuvwxyz') {
  engine.installShard(letter, JSON.parse(fs.readFileSync(base + 'words-' + letter + '.txt')));
  shards[letter] = engine.dict.shards[letter];
}

// Check every generated value and index; the golden results also check ordering.
const normalized = value => JSON.parse(JSON.stringify(value));
assert.deepEqual(normalized(engine.dict.py2hz), normalized(chars));
assert.equal(engine.dict.romaji2kanji.entryCount, Object.keys(japanese).length);
for (const [key, value] of Object.entries(japanese)) {
  const unique = [...new Set(value)].join('');
  assert.equal(engine.dict.romaji2kanji.get(key), unique);
  assert.deepEqual(normalized(engine.getHanzi(key, 'jp').chars), unique.split(''));
}
assert.deepEqual([...engine.dict.syllableSet], [...new Set([...source.syllables, ...Object.keys(chars)])]);
for (const letter of 'abcdefghijklmnopqrstuvwxyz') {
  const entries = object => Object.fromEntries(Object.entries(object).filter(([key]) => key[0] === letter));
  assert.deepEqual(shards[letter].words, normalized(entries(words)));
  assert.deepEqual(shards[letter].initials, normalized(entries(initials)));
  const forward = {};
  for (const key of Object.keys(words)) {
    if (key[0] === letter && key.length >= 2) (forward[key.slice(0, 2)] ||= []).push(key);
  }
  assert.deepEqual(shards[letter].forward, forward);
}

const queries = new Set(['', 'i', 'shei', 'shishei', 'nihao', 'nihaox', 'nbi', 'niub', 'nb', 'woaizhongguo', 'zhonghuarenmingongheguo']);
for (const key of [...Object.keys(words), ...Object.keys(chars), ...Object.keys(initials)]) {
  for (let length = 1; length <= key.length; length++) queries.add(key.slice(0, length));
  queries.add(key + 'x');
  queries.add(key + 'shi');
}
for (const keys of Object.values(initials)) {
  for (const key of keys) {
    const segmented = engine.segmentPinyin(key);
    if (!segmented) continue;
    queries.add(segmented.segs.map((syllable, index) => index % 2 ? syllable[0] : syllable).join(''));
    queries.add(segmented.segs.map((syllable, index) => index % 2 ? syllable : syllable[0]).join(''));
  }
}
let seed = 17;
for (let index = 0; index < 2000; index++) {
  let query = '';
  for (let offset = 0; offset < 1 + index % 24; offset++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    query += 'abcdefghijklmnopqrstuvwxyz'[seed % 26];
  }
  queries.add(query);
}
const hash = crypto.createHash('sha256');
let count = 0;
for (const language of ['cn']) {
  for (const query of language === 'cn' ? queries : Object.keys(japanese)) {
    engine.dict.shards = {};
    if (language === 'cn') {
      for (const letter of engine.requiredShards(query)) engine.dict.shards[letter] = shards[letter];
    }
    const actual = JSON.stringify([engine.getHanzi(query, language), engine.getSegmentedDisplay(query)]);
    hash.update(language + '\n' + query + '\n' + actual + '\n');
    count++;
  }
}
// Captured from the original synchronous engine with its forward index fully built.
// Chinese-only fingerprint captured before changing Japanese storage; Japanese
// candidate/display/offset parity is checked separately in japanese-dictionary.cjs.
assert.equal(count, 22924);
assert.equal(hash.digest('hex'), '5436fa441d1ed6900c5c10800bfa3c601b45bb5863cc9b7aaded68f642af7982');
console.log('Passed: 22,924 original Chinese-engine results and all Chinese/Japanese dictionary entries.');
