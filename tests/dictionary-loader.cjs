const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
process.chdir(path.resolve(__dirname, '..'));
const strip = source => source.replace(/^import .+$/gm, '').replace(/export\s*\{[^}]+\};?/g, '');
const createInputMethod = vm.runInNewContext(strip(fs.readFileSync('components/InputMethod/assets/dicUtil.js', 'utf8')) + '\ncreateInputMethod');
const createLoader = vm.runInNewContext(strip(fs.readFileSync('components/InputMethod/assets/dictionaryLoader.js', 'utf8')) + '\ncreateDictionaryLoader', { createInputMethod, console: { warn() {} } });
const queue = [], reads = [], results = [];
const reader = options => { queue.push(options); reads.push(options.uri); assert.equal(queue.length, 1); };
const loader = createLoader(undefined, reader);
const search = (word, lang = 'cn') => loader.search(word, lang, (data, display) => results.push({ word, lang, data, display }));
function finish(fail = false) {
  const request = queue.shift();
  assert.ok(request);
  if (fail) request.fail();
  // Match Vela's packaged-resource restriction instead of Node's permissive reads.
  else if (request.uri.endsWith('.json')) request.fail('invalid file type', 202);
  else request.success({ text: fs.readFileSync('.' + request.uri, 'utf8') });
}
function flush() { let limit = 30; while (queue.length && limit--) finish(); assert.ok(limit > 0); }

assert.equal(reads.length, 0);
search('n'); search('ni'); search('nihao');
assert.equal(reads.length, 1);
flush();
assert.deepEqual(results.map(r => r.word), ['nihao']);
assert.equal(results[0].display, "ni'hao");
assert.ok(results[0].data.multi.words.includes('你好'));
assert.ok(reads.every(uri => !uri.endsWith('/jp.txt')));
assert.equal(reads.filter(uri => uri.includes('words-')).length, 2);
const warm = reads.length;
search('niha'); flush();
assert.equal(reads.length, warm);
search('shijie'); flush();
assert.equal(results.at(-1).word, 'shijie');
search('nihao'); flush();
assert.ok(reads.length > warm + 2, 'Evicted word shards are read again');

search('a', 'jp');
search('nihao');
flush();
assert.equal(results.at(-1).lang, 'cn');
search('a', 'jp'); flush();
assert.ok(results.at(-1).data.chars.length > 0);
loader.release();
search('hello', 'en');
assert.equal(results.at(-1).data.chars.length, 0);

loader.release(); search('nihao');
loader.release(); search('shijie');
flush();
assert.equal(results.at(-1).word, 'shijie');
loader.release(); search('nihao'); finish(true);
assert.equal(results.at(-1).data.chars.length, 0);
search('nihao'); flush();
assert.ok(results.at(-1).data.multi.words.includes('你好'));
loader.release(); search('nihao');
queue.shift().success({ text: '{broken' });
search('nihao'); flush();
assert.ok(results.at(-1).data.multi.words.includes('你好'));

// A destroyed component cannot be retained by a pending UI callback.
loader.release(); search('nihao');
const beforeDestroy = results.length;
loader.destroy(); finish();
search('shijie');
assert.equal(results.length, beforeDestroy);
assert.equal(queue.length, 0);

// Exercise the actual component handlers, including T9 waiting input and hiding.
const ux = fs.readFileSync('components/InputMethod/InputMethod.ux', 'utf8').split('<script>')[1].split('</script>')[0];
const definition = vm.runInNewContext(ux.replace(/^import .+$/gm, '').replace('export default', 'const component =') + '\ncomponent', {
  createDictionaryLoader: root => createLoader(root, reader),
  vibrator: { vibrate() {} }, device: { getInfo() {} }
});
const component = Object.assign({}, definition, JSON.parse(JSON.stringify(definition.data)), {
  hide: true, maxlength: 5, screentype: 'circle', keyboardtype: 'QWERTY', vibratemode: '',
  dictionarypath: definition.props.dictionarypath.default,
  $watch() {}, $emit() {}
});
component.onInit();
assert.equal(queue.length, 0);
component.hide = false; component.watchHidePropsChange(false, true);
assert.equal(queue.length, 0, 'Opening an empty keyboard must not load dictionaries');
component.onSelect('N'); component.onSelect('I'); component.onSelect('H'); component.onSelect('A'); component.onSelect('O');
assert.equal(component.resultRow0.length, 0, 'Old candidates must not remain selectable');
flush();
assert.ok(component.resultWordList.includes('你好'));
component.onRsSelect('你'); flush();
assert.equal(component.cval, 'hao');
component.hide = true; component.watchHidePropsChange(true, false);
assert.equal(component.resultRow0.length, 0);
component.hide = false; component.watchHidePropsChange(false, true); flush();
assert.ok(component.resultList.includes('好'));
component.onBtnClick('AC');
component.keyboardtype = 'T9';
component.onBtnClick('mno'); component.onBtnClick('mno'); flush();
assert.equal(component.cvalDisplay, 'n');
component.onBtnClick('lang');
assert.equal(component.lang, 'en');
assert.equal(component.sylTopChars.length, 0);
component.onDestroy();
console.log('Passed: lazy reads, bounded reader, latest input, cache eviction, language changes, release, failure retry, destroy and component handlers.');
