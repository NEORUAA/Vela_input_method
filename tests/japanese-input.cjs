const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadModule } = require('./helpers/load-module.cjs');
const root = path.resolve(__dirname, '..');
const { createDictionaryLoader } = loadModule(path.join(root, 'components/InputMethod/assets/dictionaryLoader.js'), {
  '@system.file': { default: {} }
});
const reads = [];
const loader = createDictionaryLoader(undefined, options => {
  reads.push(options.uri);
  options.success({ text: fs.readFileSync(path.join(root, options.uri), 'utf8') });
});
function search(word) {
  let result;
  loader.search(word, 'jp', data => { result = data; });
  assert.ok(result, 'Dictionary query should finish');
  return result;
}

// Whole compositions, alternate spellings, small kana, nasal and doubled consonants.
const cases = [
  ['konnichiha', 'こんにちは', 'コンニチハ'],
  ['konnichiwa', 'こんにちわ', 'コンニチワ'],
  ['arigatou', 'ありがとう', 'アリガトウ'],
  ['nihongo', 'にほんご', 'ニホンゴ'],
  ['gakkou', 'がっこう', 'ガッコウ'],
  ['kitte', 'きって', 'キッテ'],
  ['matcha', 'まっちゃ', 'マッチャ'],
  ['kyashuchonyu', 'きゃしゅちょにゅ', 'キャシュチョニュ'],
  ['sitihutu', 'しちふつ', 'シチフツ'],
  ['didu', 'ぢづ', 'ヂヅ'],
  ['pepobe', 'ぺぽべ', 'ペポベ'],
  ['fatseje', 'ふぁつぇじぇ', 'ファツェジェ'],
  ['xyaxiyuxexoltsu', 'ゃぃゆぇぉっ', 'ャィユェォッ'],
  ['kann', 'かん', 'カン'],
  ['kanna', 'かんな', 'カンナ'],
  ['kanpai', 'かんぱい', 'カンパイ'],
  ["kan'i", 'かんい', 'カンイ'],
  ['kani', 'かに', 'カニ'],
  ['na', 'な', 'ナ'],
  ['n', 'ん', 'ン'],
  ['nn', 'ん', 'ン'],
  ['nya', 'にゃ', 'ニャ'],
  ['ko-hi-', 'こーひー', 'コーヒー'],
  ['va', 'ゔぁ', 'ヴァ'],
  ['SHINBUN', 'しんぶん', 'シンブン']
];
for (const [input, hiragana, katakana] of cases) {
  const data = search(input);
  assert.equal(data.chars[0], hiragana, input + ': complete hiragana candidate');
  assert.equal(data.chars[1], katakana, input + ': complete katakana candidate');
  assert.equal(data.candidates[0].offset, input.length, input + ': consume raw romaji');
  assert.equal(new Set(data.chars).size, data.chars.length, input + ': no duplicates');
}
assert.equal(reads.filter(uri => uri.endsWith('/jp.txt')).length, 1, 'Read the base only once per language session');
assert.ok(reads.every(uri => /\/jp(?:-words-[a-z])?\.txt$/.test(uri)), 'Japanese typing loads only Japanese resources');
assert.ok(search('neko').chars.includes('猫'), 'Keep existing kanji candidates');
assert.ok(search('kya').chars.includes('脚'), 'Keep kanji alongside multi-character kana');
assert.equal(search('konnichiw').chars[0], 'こんにち');
assert.equal(search('konnichiw').candidates[0].offset, 8, 'Leave unfinished w in composition');
assert.deepEqual(Array.from(search('q').chars), [], 'Unknown input must not become a false kana candidate');

// Real component handlers: selection, incomplete tails, space, symbols and layouts.
const ux = fs.readFileSync(path.join(root, 'components/InputMethod/InputMethod.ux'), 'utf8');
const script = ux.split('<script>')[1].split('</script>')[0];
function defineComponent(readText) {
  return vm.runInNewContext(script.replace(/^import .+$/gm, '').replace('export default', 'const component =') + '\ncomponent', {
    createDictionaryLoader: () => createDictionaryLoader(undefined, readText),
    vibrator: { vibrate() {} }, device: { getInfo({ success }) { success({ screenWidth: 336 }); } }
  });
}
const definition = defineComponent(options => {
  options.success({ text: fs.readFileSync(path.join(root, options.uri), 'utf8') });
});
for (const screentype of ['circle', 'rect', 'pill-shaped']) {
  const events = [];
  const component = Object.assign({}, definition, JSON.parse(JSON.stringify(definition.data)), {
    hide: false, maxlength: 5, screentype, keyboardtype: 'QWERTY', vibratemode: '',
    dictionarypath: definition.props.dictionarypath.default,
    $watch() {}, $emit(name, payload) { events.push({ name, payload }); }
  });
  component.onInit();
  component.onBtnClick('lang'); component.onBtnClick('lang');
  assert.equal(component.lang, 'jp');
  const type = word => { for (const letter of word) component.onSelect(letter); };
  const output = () => events.filter(event => event.name === 'complete').map(event => event.payload.content);
  type('konnichiha');
  assert.equal(component.resultRow0[0], 'こんにちは');
  component.onRsSelect('コンニチハ');
  assert.equal(component.cval, '');
  assert.equal(output().at(-1), 'コンニチハ');

  type('kyak'); component.onRsSelect('きゃ');
  assert.equal(component.cval, 'k', 'Two-character kana must consume only kya');
  type('a'); component.onBtnClick('space');
  assert.equal(output().at(-1), 'か', 'Space commits the first candidate');
  assert.equal(component.cval, '');
  component.onBtnClick('space');
  assert.equal(output().at(-1), ' ');

  type('kanji'); component.onRsSelect('漢');
  assert.equal(component.cval, 'ji', 'Kanji prefix leaves remaining romaji');
  component.onBtnClick('D');
  assert.equal(component.cval, 'j');
  component.onBtnClick('AC');

  type('ko'); component.onBtnClick('switchNum_jp');
  assert.equal(component.cval, 'ko', 'Symbols must not erase Japanese composition');
  component.onSelect('-'); component.onBtnClick('switchCn'); type('hi');
  assert.equal(component.resultRow0[0], 'こーひ');
  component.onBtnClick('switchNum_jp'); component.onSelect('-'); component.onSelect('。');
  assert.deepEqual(output().slice(-2), ['こーひー', '。'], 'Commit composition before punctuation');
  assert.equal(component.cval, '');
  component.onBtnClick('switchCn');

  type('kan'); component.onBtnClick('switchNum_jp'); component.onSelect("'");
  component.onBtnClick('switchCn'); type('i');
  assert.equal(component.resultRow0[0], 'かんい');
  component.onBtnClick('D');
  assert.equal(component.cval, "kan'");
  component.onBtnClick('AC');
  type('k'); component.onBtnClick('switchNum_jp'); component.onSelect('。');
  assert.deepEqual(output().slice(-2), ['k', '。'], 'Unknown tail remains recoverable when committing');
  component.onBtnClick('switchCn');

  type('neko'); component.hide = true; component.watchHidePropsChange(true, false);
  assert.equal(component.resultRow0.length, 0);
  component.hide = false; component.watchHidePropsChange(false, true);
  assert.equal(component.resultRow0[0], 'ねこ');
  component.onBtnClick('lang');
  assert.equal(component.lang, 'cn');
  assert.equal(component.cval, '');
  assert.equal(component.resultList2.length, 0);
  component.lang = 'jp'; component.keyboardtype = 'T9'; component.watchKeyboardTypePropsChange('T9', 'QWERTY');
  assert.equal(component.lang, 'cn', 'Japanese remains QWERTY-only');
  component.onDestroy();
}
loader.destroy();

const queue = [], asyncEvents = [];
const asyncDefinition = defineComponent(options => queue.push(options));
const asyncComponent = Object.assign({}, asyncDefinition, JSON.parse(JSON.stringify(asyncDefinition.data)), {
  hide: false, maxlength: 5, screentype: 'circle', keyboardtype: 'QWERTY', vibratemode: '',
  dictionarypath: definition.props.dictionarypath.default,
  $watch() {}, $emit(name, payload) { if (name === 'complete') asyncEvents.push(payload.content); }
});
asyncComponent.onInit(); asyncComponent.lang = 'jp';
for (const letter of 'neko') asyncComponent.onSelect(letter);
asyncComponent.onBtnClick('space');
assert.equal(asyncEvents.length, 0, 'Cold dictionary read must not commit raw romaji on space');
assert.equal(asyncComponent.cval, 'neko');
asyncComponent.onBtnClick('switchNum_jp'); asyncComponent.onSelect('。');
assert.equal(asyncEvents.length, 0, 'Punctuation must wait until candidates are available');
const request = queue.shift();
request.success({ text: fs.readFileSync(path.join(root, request.uri), 'utf8') });
while (queue.length) {
  const shard = queue.shift();
  shard.success({ text: fs.readFileSync(path.join(root, shard.uri), 'utf8') });
}
assert.equal(asyncComponent.resultRow0[0], 'ねこ');
asyncComponent.onSelect('。');
assert.deepEqual(asyncEvents, ['ねこ', '。']);
asyncComponent.onDestroy();
console.log('Passed: ' + cases.length + ' Japanese conversion cases, kanji preservation and component flows on 3 layouts.');
