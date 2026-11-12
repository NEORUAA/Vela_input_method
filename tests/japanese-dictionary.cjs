const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadModule } = require('./helpers/load-module.cjs');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'tools/dictionaries/dic_jp.js'), 'utf8');
const original = vm.runInNewContext(source.replace(/export\s*\{[^}]+\};?/g, '') + '\ngetDictJp()');
const { createJapaneseDictionary } = loadModule(path.join(root, 'components/InputMethod/assets/dictionaryLoader.js'), {
  '@system.file': { default: {} }
});
const { getJapaneseCandidates } = loadModule(path.join(root, 'components/InputMethod/assets/dicUtil.js'));
const text = fs.readFileSync(path.join(root, 'components/InputMethod/assets/dictionary/jp.txt'), 'utf8');
const base = JSON.parse(text);
assert.deepEqual(Object.keys(base), ['chars', 'syllables']);
assert.ok(Buffer.byteLength(text) <= 64 * 1024);
const reader = createJapaneseDictionary(text);
const legacy = createJapaneseDictionary(JSON.stringify(original));
assert.equal(reader.entryCount, 1203);
const queries = new Set(['', 'shi', 'si', 'nn', 'n', "kan'i", 'konnichiha', 'nihongo', 'kyak', 'q']);
for (const [key, value] of Object.entries(original)) {
  assert.equal(reader.get(key), [...new Set(value)].join(''), key + ': preserve all character candidates and their order');
  assert.equal(legacy.get(key), value, key + ': preserve custom JSON compatibility');
  for (let length = 1; length <= key.length; length++) queries.add(key.slice(0, length));
  queries.add(key + 'x');
}
for (const query of queries) {
  assert.deepEqual(JSON.parse(JSON.stringify(getJapaneseCandidates(query, reader))),
    JSON.parse(JSON.stringify(getJapaneseCandidates(query, original))), query + ': preserve character candidate/display/offset behavior');
}
for (const invalid of ['', '{broken', 'VIMJP2\na\tあ\n', 'VIMJP1\na\t\n',
  'VIMJP1\nb\tび\na\tあ\n', 'VIMJP1\na\tあ\na\tあ\n', 'VIMJP1\na あ\n']) {
  assert.throws(() => createJapaneseDictionary(invalid));
}
const compact = createJapaneseDictionary('VIMJP1\na\tあ\nb\tび\n');
assert.equal(compact.get('a'), 'あ');
assert.equal(compact.get('b'), 'び');
assert.equal(compact.get('aa'), '');
const large = createJapaneseDictionary('VIMJP1\na\t' + 'あ'.repeat(66000) + '\nz\t図\n');
assert.equal(large.get('z'), '図', 'Legacy compact dictionaries retain 32-bit offsets above 64 KiB');
console.log('Passed: 1,203 character readings, ' + queries.size + ' parity queries and legacy dictionary formats.');
