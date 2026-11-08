const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadModule } = require('./helpers/load-module.cjs');
const root = path.resolve(__dirname, '..');
const { createDictionaryLoader } = loadModule(path.join(root, 'components/InputMethod/assets/dictionaryLoader.js'), {
  '@system.file': { default: {} }
});
// The CN resource contract permits string singletons and arrays of alternatives.
// It must load as words, rather than interpreting a singleton as separate kanji.
const cnFormatReads = [];
const cnFormat = createDictionaryLoader('/fixture/', request => {
  cnFormatReads.push(path.basename(request.uri));
  const resource = request.uri.endsWith('/jp.txt')
    ? { chars: { neko: '猫', ni: '二' }, syllables: ['ne', 'ko', 'ni'] }
    : { words: { nihon: '日本', nihongo: ['日本語', 'にほんご'] }, initials: {}, forward: { ni: [0, 1] } };
  request.success({ text: JSON.stringify(resource) });
});
let cnFormatResult;
cnFormat.search('niho', 'jp', data => { cnFormatResult = data; });
assert.ok(cnFormatResult.chars.includes('日本'), 'A CN-format singleton must remain a complete word');
assert.ok(cnFormatResult.chars.includes('日本語'), 'A CN-format alternative array must retain its words');
assert.equal(cnFormatResult.candidates.find(item => item.text === '日本語').offset, 4);
assert.deepEqual(cnFormatReads, ['jp.txt', 'jp-words-n.txt'], 'CN layout reads one base and one word shard');
cnFormat.destroy();
const requests = [], reads = [], results = [];
let active = 0, maxActive = 0;
const loader = createDictionaryLoader(undefined, request => {
  active++; maxActive = Math.max(maxActive, active);
  requests.push(request); reads.push(path.basename(request.uri));
});
function query(word) { loader.search(word, 'jp', data => results.push({ word, data })); }
function complete(text) {
  const request = requests.shift();
  assert.ok(request, 'A resource read is pending');
  active--;
  request.success({ text: text === undefined ? fs.readFileSync(path.join(root, request.uri), 'utf8') : text });
}
function flush() { let remaining = 10; while (requests.length && remaining--) complete(); assert.ok(remaining > 0); }

query('nihongo'); flush();
assert.ok(results.at(-1).data.chars.includes('日本語'), 'The real packaged word shard must reach the Japanese query');
assert.ok(reads.includes('jp-words-n.txt'));
query('niho'); flush();
assert.ok(results.at(-1).data.chars.includes('日本語'), 'Real JLPT words support prefix completion');
const warm = reads.length;
query('nihon'); flush();
assert.equal(reads.length, warm, 'Same-letter typing reuses the loaded word shard');
query('gakkou'); flush();
assert.ok(results.at(-1).data.chars.includes('学校'));
query('nihongo'); flush();
assert.equal(reads.filter(name => name === 'jp-words-n.txt').length, 2, 'Changing letters evicts the old word shard');
query('sigoto'); flush();
assert.ok(results.at(-1).data.chars.includes('仕事'), 'Alternate si spelling routes to the canonical word shard');
query('tisiki'); flush();
assert.ok(results.at(-1).data.chars.includes('知識'), 'ti spelling routes from legacy t to canonical c');

loader.release();
query('nihongo');
query('gakkou');
complete(); flush();
assert.equal(results.at(-1).word, 'gakkou', 'Only the latest composition is delivered');
loader.release();
query('nihongo'); complete();
query('gakkou');
complete('{broken'); flush();
assert.equal(results.at(-1).word, 'gakkou', 'An obsolete corrupt shard does not poison the current query');

loader.release(); query('tisiki');
while (requests.length && !requests[0].uri.includes('/jp-words-')) complete();
query('gakkou'); complete('{broken'); flush();
assert.equal(results.at(-1).word, 'gakkou', 'Obsolete canonical word-shard reads are also discarded before parsing');

loader.release();
query('nihongo');
while (requests.length && !requests[0].uri.includes('/jp-words-')) complete();
complete('{broken');
assert.equal(results.at(-1).data.chars.length, 0, 'A corrupt word shard returns a recoverable failure');
query('nihongo'); flush();
assert.ok(results.at(-1).data.chars.includes('日本語'), 'The next query can retry after a corrupt resource');
loader.release(); query('nihongo');
const before = results.length;
loader.destroy(); complete();
assert.equal(results.length, before, 'Destroy suppresses old callbacks');
assert.equal(maxActive, 1, 'Word and legacy resources share the existing single-flight reader');
const legacyReads = [];
const legacy = createDictionaryLoader('/custom/', request => {
  legacyReads.push(request.uri);
  request.success({ text: JSON.stringify({ neko: '猫' }) });
});
let legacyResult;
legacy.search('neko', 'jp', data => { legacyResult = data; });
assert.ok(legacyResult.chars.includes('猫'));
assert.deepEqual(legacyReads, ['/custom/jp.txt'], 'Old custom JSON dictionaries do not require new word resources');
legacy.destroy();
const compactReads = [];
const compact = createDictionaryLoader('/compact/', request => {
  compactReads.push(path.basename(request.uri));
  request.success({ text: request.uri.endsWith('/jp.txt')
    ? JSON.stringify({ format: 'VIMJP-SHARDS1', letters: 'n' }) : 'VIMJP1\nneko\t猫\n' });
});
let compactResult;
compact.search('neko', 'jp', data => { compactResult = data; });
assert.ok(compactResult.chars.includes('猫'), 'Older compact dictionaries remain readable');
assert.deepEqual(compactReads, ['jp.txt', 'jp-n.txt']);
compact.destroy();
console.log('Passed: packaged Japanese words, canonical routing, bounded cache, races, error retry and destroy.');
