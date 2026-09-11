import file from '@system.file'
import { createInputMethod } from './dicUtil.js'

const DEFAULT_ROOT = '/components/InputMethod/assets/dictionary/'

// One reader per component: at most one file in flight and one latest request.
// Keep this object outside reactive data to avoid observing dictionary entries.
function createDictionaryLoader(root = DEFAULT_ROOT, readText = options => file.readText(options)) {
  let engine = createInputMethod()
  let pending = null
  let reading = false
  let generation = 0
  let language = ''
  let disposed = false

  function pump() {
    if (reading || !pending || disposed) return
    const request = pending
    if (language !== request.lang) {
      engine = createInputMethod()
      language = request.lang
    }
    if (!request.word || (language !== 'cn' && language !== 'jp')) {
      pending = null
      request.callback({ chars: [], matched: '', multi: null }, request.word)
      return
    }
    let resource = ''
    if (language === 'jp') {
      if (!engine.dict.romaji2kanji) resource = 'jp'
    } else if (!engine.dict.syllableSet) {
      resource = 'cn'
    } else {
      const letters = engine.requiredShards(request.word)
      // Drop irrelevant shards before reading the next one, including on backspace.
      for (const key in engine.dict.shards) {
        if (letters.indexOf(key) === -1) delete engine.dict.shards[key]
      }
      for (const letter of letters) {
        if (!engine.dict.shards[letter]) { resource = 'words-' + letter; break }
      }
    }
    if (!resource) {
      pending = null
      request.callback(engine.getHanzi(request.word, language),
        language === 'cn' ? engine.getSegmentedDisplay(request.word) : request.word)
      return
    }
    reading = true
    const token = generation
    const requestedLanguage = language
    function finish(data, error) {
      reading = false
      if (disposed) return
      if (token !== generation || !pending || pending.lang !== requestedLanguage) {
        pump()
        return
      }
      if (!error) {
        try {
          const parsed = JSON.parse(data.text)
          if (resource === 'cn') engine.initDict(parsed)
          else if (resource === 'jp') engine.dict.romaji2kanji = parsed
          else engine.installShard(resource.slice(-1), parsed)
        } catch (failure) { error = failure }
      }
      if (error) {
        const failed = pending
        pending = null
        // Release partial loads; the next input can retry without a stuck latch.
        engine = createInputMethod()
        console.warn('InputMethod dictionary read failed: ' + resource)
        failed.callback({ chars: [], matched: '', multi: null }, failed.word)
        return
      }
      pump()
    }
    try {
      readText({
        uri: root + resource + '.json',
        success: data => finish(data, null),
        fail: () => finish(null, true)
      })
    } catch (error) { finish(null, error) }
  }

  function release() {
    generation++
    pending = null
    engine = createInputMethod()
    language = ''
  }

  return {
    search(word, lang, callback) {
      if (disposed) return
      pending = { word, lang, callback }
      pump()
    },
    release,
    destroy() { release(); disposed = true }
  }
}

export { createDictionaryLoader }
