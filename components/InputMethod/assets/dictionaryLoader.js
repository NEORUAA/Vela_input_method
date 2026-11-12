import file from '@system.file'
import { createInputMethod, getJapaneseCandidates, getJapaneseWordKey } from './dicUtil.js'

const DEFAULT_ROOT = '/components/InputMethod/assets/dictionary/'

const HEADER = 'VIMJP1\n'

// Readers live outside reactive component data and are released with the loader.
// Keep support for older compact and custom resources when dictionarypath changes.
function createJapaneseDictionary(source) {
  if (typeof source !== 'string') {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      throw new Error('Invalid Japanese dictionary text')
    }
    // Older/custom dictionarypath resources can still use the original JSON format.
    const values = source.chars && Array.isArray(source.syllables) ? source.chars : source
    const keys = Object.keys(values)
    for (const key of keys) {
      if (!/^[a-z]+$/.test(key) || typeof values[key] !== 'string' || !values[key]) {
        throw new Error('Invalid Japanese dictionary entry')
      }
    }
    return { get: key => values[key] || '', entryCount: keys.length, indexBytes: 0 }
  }
  const text = source
  if (/^\s*\{/.test(text)) return createJapaneseDictionary(JSON.parse(text))
  if (text.indexOf(HEADER) !== 0 || text[text.length - 1] !== '\n') {
    throw new Error('Invalid Japanese dictionary format')
  }
  let count = 0
  for (let i = HEADER.length; i < text.length; i++) if (text.charCodeAt(i) === 10) count++
  const offsets = text.length <= 0xffff ? new Uint16Array(count) : new Uint32Array(count)
  let start = HEADER.length
  let previous = ''
  for (let i = 0; i < count; i++) {
    const end = text.indexOf('\n', start)
    const tab = text.indexOf('\t', start)
    const key = tab < 0 ? '' : text.slice(start, tab)
    if (tab < start || tab >= end - 1 || !/^[a-z]+$/.test(key) || key <= previous ||
      text.slice(tab + 1, end).indexOf('\t') !== -1 || text[end - 1] === '\r') {
      throw new Error('Invalid or unsorted Japanese dictionary entry')
    }
    offsets[i] = start
    previous = key
    start = end + 1
  }
  return {
    entryCount: count,
    indexBytes: offsets.byteLength,
    get(key) {
      let low = 0
      let high = count - 1
      while (low <= high) {
        const mid = (low + high) >>> 1
        const begin = offsets[mid]
        const tab = text.indexOf('\t', begin)
        const length = tab - begin
        let order = 0
        for (let i = 0; i < Math.min(key.length, length); i++) {
          order = key.charCodeAt(i) - text.charCodeAt(begin + i)
          if (order) break
        }
        if (!order) order = key.length - length
        if (!order) return text.slice(tab + 1, text.indexOf('\n', tab))
        if (order < 0) high = mid - 1
        else low = mid + 1
      }
      return ''
    }
  }
}

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
    let japaneseWordKey = ''
    if (language === 'jp') {
      japaneseWordKey = getJapaneseWordKey(request.word)
      if (!engine.dict.romaji2kanji && typeof engine.dict.jpShardLetters !== 'string') resource = 'jp'
      else {
        if (typeof engine.dict.jpShardLetters === 'string') {
          const letter = request.word[0].toLowerCase()
          if (engine.dict.jpShardLetter !== letter) {
            // Older compact dictionaries keep character candidates in letter shards.
            delete engine.dict.romaji2kanji
            engine.dict.jpShardLetter = letter
          }
          if (engine.dict.jpShardLetters.indexOf(letter) !== -1 && !engine.dict.romaji2kanji) resource = 'jp-' + letter
        }
        if (!resource && typeof engine.dict.jpWordLetters === 'string') {
          const wordLetter = japaneseWordKey[0] || ''
          if (engine.dict.jpWordShardLetter !== wordLetter) {
            delete engine.dict.jpWordShard
            engine.dict.jpWordShardLetter = wordLetter
          }
          if (engine.dict.jpWordLetters.indexOf(wordLetter) !== -1 && wordLetter && !engine.dict.jpWordShard) {
            resource = 'jp-words-' + wordLetter
          }
        }
      }
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
      if (language === 'jp') {
        const data = getJapaneseCandidates(request.word, engine.dict.romaji2kanji || {}, engine.dict.jpWordShard, japaneseWordKey)
        request.callback(data, data.display)
      } else request.callback(engine.getHanzi(request.word, language), engine.getSegmentedDisplay(request.word))
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
      const currentLetter = resource.indexOf('jp-words-') === 0
        ? getJapaneseWordKey(pending.word)[0] : (pending.word[0] || '').toLowerCase()
      if (resource.indexOf('jp-') === 0 && resource.slice(-1) !== currentLetter) {
        // A new first letter superseded this read; do not allocate its obsolete index.
        pump()
        return
      }
      if (!error) {
        try {
          if (resource === 'jp') {
            const metadata = /^\s*\{/.test(data.text) ? JSON.parse(data.text) : null
            if (metadata && metadata.format === 'VIMJP-SHARDS1') {
              const letters = metadata.letters
              if (typeof letters !== 'string' || !/^[a-z]*$/.test(letters) ||
                letters.split('').sort().filter((letter, index, all) => all.indexOf(letter) === index).join('') !== letters) {
                throw new Error('Invalid Japanese shard metadata')
              }
              engine.dict.jpShardLetters = letters
              if (metadata.words !== undefined) {
                const wordLetters = metadata.words
                if (typeof wordLetters !== 'string' || !/^[a-z]*$/.test(wordLetters) ||
                  wordLetters.split('').sort().filter((letter, index, all) => all.indexOf(letter) === index).join('') !== wordLetters) {
                  throw new Error('Invalid Japanese word shard metadata')
                }
                engine.dict.jpWordLetters = wordLetters
              }
            } else {
              engine.dict.romaji2kanji = createJapaneseDictionary(metadata || data.text)
              if (metadata && metadata.chars && Array.isArray(metadata.syllables)) {
                // Same base + 26 word-shard layout as CN; no separate metadata.
                engine.dict.jpWordLetters = 'abcdefghijklmnopqrstuvwxyz'
              }
            }
          }
          else if (resource.indexOf('jp-words-') === 0) engine.installJapaneseWordShard(resource.slice(-1), JSON.parse(data.text))
          else if (resource.indexOf('jp-') === 0) engine.dict.romaji2kanji = createJapaneseDictionary(data.text)
          else {
            const parsed = JSON.parse(data.text)
            if (resource === 'cn') engine.initDict(parsed)
            else engine.installShard(resource.slice(-1), parsed)
          }
        } catch (failure) { error = failure }
      }
      if (error) {
        const failed = pending
        pending = null
        // Release partial loads; the next input can retry without a stuck latch.
        engine = createInputMethod()
        console.warn('InputMethod dictionary read failed: ' + resource + ': ' + (error.message || error))
        failed.callback({ chars: [], matched: '', multi: null }, failed.word)
        return
      }
      pump()
    }
    try {
      readText({
        // Older Vela file APIs reject packaged .json resources.
        uri: root + resource + '.txt',
        success: data => finish(data, null),
        fail: (message, code) => finish(null, new Error(code + ': ' + message))
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

export { createDictionaryLoader, createJapaneseDictionary }
