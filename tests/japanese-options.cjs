const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadModule } = require('./helpers/load-module.cjs');
const root = path.resolve(__dirname, '..');
const definition = loadModule(path.join(root, 'components/InputMethod/InputMethod.ux'), {
  '@system.file': { default: { readText(request) {
    request.success({ text: fs.readFileSync(path.join(root, request.uri), 'utf8') });
  } } },
  '@system.device': { default: { getInfo({ success }) { success({ screenWidth: 336 }); } } },
  '@system.vibrator': { default: { vibrate() {} } }
}).default;
for (const screentype of ['circle', 'rect', 'pill-shaped']) {
  const events = [];
  const defaults = Object.fromEntries(Object.entries(definition.props).map(([name, spec]) => [name, spec.default]));
  const component = Object.assign({}, definition, defaults, JSON.parse(JSON.stringify(definition.data)), {
    hide: false, screentype, langlock: 'jp', jpkanaonly: true,
    $watch() {}, $emit(name, data) { if (name === 'complete') events.push(data.content); }
  });
  component.onInit();
  assert.equal(component.lang, 'jp');
  component.onBtnClick('lang');
  assert.equal(component.lang, 'jp', 'A locked keyboard cannot change its language');
  const type = text => { for (const letter of text) component.onSelect(letter); };
  type('niho');
  assert.ok(Array.from(component.resultList).includes('にほんご'));
  assert.ok(!Array.from(component.resultList).includes('日本語'));
  component.onRsSelect('にほんご');
  assert.equal(events.at(-1), 'にほんご');
  assert.equal(component.cval, '', 'Filtered candidates retain the typed-prefix consumption offset');
  type('k'); component.onBtnClick('switchNum_jp'); component.onSelect('。');
  assert.deepEqual(events.slice(-2), ['k', '。'], 'Kana-only punctuation cannot silently select a word completion');
  component.onBtnClick('switchCn');
  component.jpkanaonly = false;
  type('nihongo'); component.onRsSelect('日本語');
  assert.equal(events.at(-1), '日本語');
  assert.equal(component.cval, '');
  type('gakkouni'); component.onRsSelect('学校');
  assert.equal(component.cval, 'ni', 'A whole-word selection retains the following composition');
  component.onDestroy();
}
console.log('Passed: Japanese language lock, kana filtering and whole-word selection on all layouts.');
