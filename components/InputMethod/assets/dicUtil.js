// 辅助：从词库取值（支持单值和数组），去重推入 wordHits
function pushWordHits(val, arr) {
  if (!val) return
  if (Array.isArray(val)) {
    for (var i = 0; i < val.length; i++) {
      if (val[i] && arr.indexOf(val[i]) === -1) arr.push(val[i])
    }
  } else if (arr.indexOf(val) === -1) {
    arr.push(val)
  }
}

let SimpleInputMethod = {
  dict: {}
}

// Each component owns its dictionary state; large data stays outside the JS bundle.
function createInputMethod() {
  const engine = Object.create(SimpleInputMethod)
  engine.dict = { shards: {} }
  return engine
}

SimpleInputMethod.initDict = function(data) {
  this.dict.py2hz = data.chars
  this.dict.py2hz2 = { i: 'i' }
  this.dict.syllableSet = new Set(data.syllables)
  for (const key in data.chars) {
    const first = key[0]
    if (!this.dict.py2hz2[first]) this.dict.py2hz2[first] = data.chars[key]
    this.dict.syllableSet.add(key)
  }
}

function getWord(dict, key) {
  const shard = dict.shards[key[0]]
  return shard && shard.words[key]
}

SimpleInputMethod.installShard = function(letter, shard) {
  const keys = Object.keys(shard.words)
  // Reuse word-key strings instead of parsing a duplicate string per index entry.
  for (const index of [shard.initials, shard.forward]) {
    for (const key in index) {
      const references = index[key]
      for (let i = 0; i < references.length; i++) references[i] = keys[references[i]]
    }
  }
  this.dict.shards[letter] = shard
}

// Composition only looks up words beginning with these syllables.
SimpleInputMethod.requiredShards = function(pinyin) {
  const letters = []
  const add = key => {
    const first = key && key[0]
    if (first && /^[a-z]$/.test(first) && letters.indexOf(first) === -1) letters.push(first)
  }
  add(pinyin)
  // Mixed input can continue past an incomplete syllable; include its tokens too.
  let offset = 0
  while (offset < pinyin.length) {
    let token = pinyin[offset]
    for (let length = Math.min(6, pinyin.length - offset); length >= 1; length--) {
      const part = pinyin.substr(offset, length)
      if (this.dict.syllableSet.has(part)) { token = part; break }
    }
    add(token)
    offset += token.length
  }
  const raw = this.segmentPinyin(pinyin)
  const stitched = raw && this.tryStitchTrailing(raw)
  for (const result of [raw, stitched]) {
    if (!result) continue
    for (const syl of result.segs) add(syl)
    add(result.rest)
  }
  return letters
}

SimpleInputMethod.getSingleHanzi = function(pinyin, lang = 'cn') {
  // 根据 lang 决定走哪张表
  if (lang === 'cn') {
    return (this.dict.py2hz2 || {})[pinyin]
    || (this.dict.py2hz || {})[pinyin]
    || ''
  }
  else if (lang === 'jp') {
    return (this.dict.romaji2kanji || {})[pinyin]
    || ''
  }
  // en 模式不查候选
  return ''
}

// 取音节首字：单字表 py2hz 优先，词库单音节兜底。
// 部分音节（如 shei）只在词库 dic_words 中（"shei":"谁"），单字表无对应键，
// 若不兜底会丢逐字候选（如 shishei 缺「谁」），且整词组合也因此失败。
function getSylTopChar(dict, syl) {
  const c = dict.py2hz[syl] || ''
  if (c) return c[0]
  const w = getWord(dict, syl)
  if (w) {
    const f = Array.isArray(w) ? w[0] : w
    return f ? f[0] : ''
  }
  return ''
}

// 把连续拼音串切成合法音节数组。
// 返回 { segs, rest, pos } 其中 pos[i] 为 segs[0..i] 在原串中的累计长度
// 若整段全合法且仅 1 个音节，返回 null（单字流程）。
SimpleInputMethod.segmentPinyin = function(pinyin) {
  if (!pinyin) return null
  const set = this.dict.syllableSet
  const result = []
  const pos = []
  let i = 0
  const maxLen = 24
  while (i < pinyin.length && i < maxLen) {
    let matched = ''
    for (let len = Math.min(6, pinyin.length - i); len >= 1; len--) {
      const s = pinyin.substr(i, len)
      if (set.has(s)) { matched = s; break }
    }
    if (!matched) break
    result.push(matched)
    i += matched.length
    pos.push(i)
  }
  let rest = pinyin.substr(i)
  // 末段若是叹词单字音，且前面有 ≥2 音节 → 视为不完整前缀移到 rest
  const DUMMY_ENDING = { m: 1, n: 1, ng: 1, hm: 1, hng: 1 }
  if (!rest && result.length >= 2) {
    const lastSeg = result[result.length - 1]
    if (DUMMY_ENDING[lastSeg]) {
      rest = result.pop()
      pos.pop()
    }
  }
  if (!rest && result.length === 1) return null
  if (result.length === 0) return null
  return { segs: result, rest: rest, pos: pos }
}

// 将不完整音节前缀补全为最可能的完整音节：
// 1) 优先选能和 prevSyl 拼成词库词的音节
// 2) 常用字母前缀映射兜底
// 3) 再不行取字母序第一个
SimpleInputMethod.completeSyllable = function(prefix, prevSyl) {
  if (!prefix) return ''
  const COMMON = {
    'z': 'zai', 'm': 'ma', 'b': 'bu', 'd': 'de', 'g': 'ge',
    'h': 'he', 'j': 'ji', 'k': 'ke', 'l': 'le', 'n': 'ne',
    'q': 'qi', 'r': 'ren', 's': 'shi', 't': 'ta', 'w': 'wo',
    'x': 'xi', 'y': 'yi',
    'zh': 'zhe', 'ch': 'chi', 'sh': 'shi',
    'p': 'ping', 'f': 'fa', 'c': 'ci', 'a': 'ai', 'o': 'ou',
  }
  const set = this.dict.syllableSet
  const candidates = []
  for (const syl of set) {
    if (syl.indexOf(prefix) === 0 && syl.length > prefix.length) {
      candidates.push(syl)
    }
  }
  if (candidates.length === 0) return ''
  // 优先：能和前一个音节拼成词库词的
  if (prevSyl) {
    for (const c of candidates) {
      if (getWord(this.dict, prevSyl + c)) return c
    }
  }
  // 常用补全映射
  if (COMMON[prefix]) return COMMON[prefix]
  // 字母序第一个
  return candidates[0]
}

// 对分词结果做尾随拼接修复：若末段是单字音尝试与 rest 拼合。
// 拼合后成合法音节 → 替换末段；否则去掉末段占位。
SimpleInputMethod.tryStitchTrailing = function(segResult) {
  if (!segResult || !segResult.rest) return segResult
  const { segs, rest, pos } = segResult
  if (!rest) return segResult
  const last = segs[segs.length - 1]
  if (last.length > 2) return segResult
  const combined = last + rest
  if (this.dict.syllableSet.has(combined)) {
    const newSegs = segs.slice(0, -1).concat([combined])
    const newPos = pos.slice()
    newPos[newPos.length - 1] = (newPos[newPos.length - 1] || 0) + rest.length
    return { segs: newSegs, rest: '', pos: newPos }
  }
  if (last.length <= 2) {
    const cleanSegs = segs.slice(0, -1)
    const cleanPos = pos.slice(0, -1)
    if (cleanSegs.length >= 2) {
      return { segs: cleanSegs, rest: '', pos: cleanPos }
    }
  }
  return segResult
}

// 混合匹配：全拼音节 + 简拼首字母混合输入（如 nbi→牛逼, niub→牛逼）
// 从 initialsIndex 反向展开简拼部分命中词，过滤词音节数与 token 数不一质的
// 相比全表遍历，最多验证几十条，对 → 3000 词无压力
SimpleInputMethod.matchMixedWords = function(pinyin) {
  if (!pinyin) return null
  const set = this.dict.syllableSet
  // 贪心切分：完整音节优先，否则单字母当作简拼
  const tokens = []
  const offsets = []
  let i = 0
  while (i < pinyin.length) {
    let matched = ''
    for (let len = Math.min(6, pinyin.length - i); len >= 1; len--) {
      const s = pinyin.substr(i, len)
      if (set.has(s)) { matched = s; break }
    }
    if (matched) { tokens.push(matched); i += matched.length }
    else { tokens.push(pinyin[i]); i += 1 }
    offsets.push(i)
  }
  if (tokens.length < 2) return null

  // 收集简拼 token 对应的首字母
  let mixedAbbr = ''
  for (var ti = 0; ti < tokens.length; ti++) mixedAbbr += tokens[ti][0]

  const idx = (this.dict.shards[pinyin[0]] || {}).initials || {}
  const matchedKeys = idx[mixedAbbr] || []
  if (matchedKeys.length === 0) return null

  const hits = []
  for (var ki = 0; ki < matchedKeys.length && hits.length < 8; ki++) {
    const key = matchedKeys[ki]
    // 按需切分候选词（init 不再缓存 wordSyllables；混合输入命中候选极少）
    const keySegs = this.segmentPinyin(key)
    if (!keySegs || !keySegs.segs || keySegs.segs.length !== tokens.length) continue
    var syls = keySegs.segs
    var ok = true
    for (var j = 0; j < tokens.length; j++) {
      var t = tokens[j]
      var s = syls[j]
      if (t.length > 1) {
        if (t !== s) { ok = false; break }
      } else if (t !== s[0]) {
        ok = false; break
      }
    }
    if (ok) hits.push({ key: key, syls: syls, offsets: offsets })
  }
  return hits.length > 0 ? hits : null
}

// 生成拼音分词显示串：如 "nihao" → "ni'hao"，"nb" → "n'b"，"niub" → "niu'b"
// 全拼输入：segmentPinyin 贪心切分
// 纯简拼/混合：单字母视为独立音节
SimpleInputMethod.getSegmentedDisplay = function(pinyin) {
  if (!pinyin) return ''
  if (!this.dict.syllableSet) return pinyin
  var len = pinyin.length
  // 快速路径：单音节或非音节 → 原样
  if (len === 1 || this.dict.syllableSet.has(pinyin)) return pinyin

  // 贪心切分（从 segmentPinyin 内联以节省函数调用）
  const set = this.dict.syllableSet
  const tokens = []
  let ii = 0
  while (ii < len) {
    let mtch = ''
    for (let l = Math.min(6, len - ii); l >= 1; l--) {
      if (set.has(pinyin.substr(ii, l))) { mtch = pinyin.substr(ii, l); break }
    }
    if (mtch) { tokens.push(mtch); ii += mtch.length }
    else { tokens.push(pinyin[ii]); ii += 1 }
  }
  if (tokens.length >= 2) return tokens.join("'")
  return pinyin
}

// 多拼查字：词库优先，未命中再分词逐字组合。返回 { words, composed, segs }
SimpleInputMethod.getMultiHanzi = function(pinyin, lang = 'cn') {
  const empty = { words: [], composed: '', segs: null }
  if (lang !== 'cn') return empty
  if (!this.dict.syllableSet) return empty

  const wordHits = []
  var matchSource = '' // 'exact','prefix','forward','initials','composed'

  // 1) 词库整串精确命中
  if (getWord(this.dict, pinyin)) { pushWordHits(getWord(this.dict, pinyin), wordHits); matchSource = 'exact' }
  // 输入进行中：前缀命中（如输入到 nihaox 时命中 nihao）
  if (wordHits.length === 0) {
    const max = Math.min(pinyin.length, 12)
    for (let len = max; len >= 2; len--) {
      const head = pinyin.substr(0, len)
      if (getWord(this.dict, head)) { pushWordHits(getWord(this.dict, head), wordHits); matchSource = 'prefix'; break }
    }
  }
  // 前向前缀匹配（首2字母索引，避免全表遍历；限流前6条防止海量候选）
  if (wordHits.length === 0 && pinyin.length >= 2 && !this.dict.syllableSet.has(pinyin)) {
    const pref = pinyin.substr(0, 2)
    const fwdIdx = (this.dict.shards[pinyin[0]] || {}).forward || {}
    const candidates = fwdIdx[pref] || []
    let fwdCount = 0
    for (let ki = 0; ki < candidates.length && fwdCount < 6; ki++) {
      if (candidates[ki].indexOf(pinyin) === 0) {
        pushWordHits(getWord(this.dict, candidates[ki]), wordHits); matchSource = 'forward'
        fwdCount++
      }
    }
  }
  // 首字母简拼匹配（限流前6条）
  if (wordHits.length === 0 && pinyin.length >= 2 && pinyin.length <= 8 && !this.dict.syllableSet.has(pinyin)) {
    const idx = (this.dict.shards[pinyin[0]] || {}).initials || {}
    const keys = idx[pinyin] || []
    for (let k = 0; k < keys.length && k < 6; k++) {
      pushWordHits(getWord(this.dict, keys[k]), wordHits); matchSource = 'initials'
    }
  }

  // 混合匹配：全拼音节与简拼首字母混合（如 nbi → 牛逼，niub → 牛逼）
  var mixedInfo = null
  if (wordHits.length === 0 && pinyin.length >= 2 && pinyin.length <= 8 && !this.dict.syllableSet.has(pinyin)) {
    const mixed = this.matchMixedWords(pinyin)
    if (mixed && mixed.length > 0) {
      for (let mi = 0; mi < mixed.length; mi++) {
        pushWordHits(getWord(this.dict, mixed[mi].key), wordHits)
      }
      matchSource = 'mixed'
      mixedInfo = mixed[0]
    }
  }

  // 2) 分词逐字组合候选（贪心查词库长词 + 尾部不完整音节补全）
  const rawSeg = this.segmentPinyin(pinyin)
  const segResult = rawSeg ? this.tryStitchTrailing(rawSeg) : null
  let segs = segResult ? segResult.segs : null
  let pos = segResult ? segResult.pos : null
  const rest = segResult ? segResult.rest : ''
  // 滤掉无字叹词单音，pos 同步删对应索引
  if (segs) {
    const DUMMY = { m: 1, n: 1, ng: 1, hm: 1, hng: 1 }
    const keep = []
    const keepPos = []
    for (let j = 0; j < segs.length; j++) {
      if (DUMMY[segs[j]]) {
        if ((this.dict.py2hz[segs[j]] || '')[0]) { keep.push(segs[j]); keepPos.push(pos[j]) }
      } else {
        keep.push(segs[j]); keepPos.push(pos[j])
      }
    }
    segs = keep.length > 0 ? keep : segs
    pos = keep.length > 0 ? keepPos : pos
  }
  // 每音节的首字 + 对应在原拼音中的累计偏移（供逐字递进选择用）
  let sylTopChars = []
  if (segs) {
    for (let j = 0; j < segs.length; j++) {
      const ch = getSylTopChar(this.dict, segs[j])
      if (ch) {
        sylTopChars.push({ char: ch, offset: pos[j] })
      }
    }
  }
  // 补全尾部不完整前缀（如 "z"→"zai", "m"→"ma"）追加到 segs 末尾
  if (segs && rest) {
    const prevSyl = segs.length >= 1 ? segs[segs.length - 1] : ''
    const completed = this.completeSyllable(rest, prevSyl)
    if (completed) {
      segs = segs.concat([completed])
      const rawOffset = (pos.length > 0 ? pos[pos.length - 1] : 0) + completed.length
      const lastOffset = Math.min(rawOffset, pinyin.length)  // 补全偏移不能超过输入长度
      const ch = getSylTopChar(this.dict, completed)
      if (ch) sylTopChars.push({ char: ch, offset: lastOffset })
    }
  }
  let composed = ''
  if (segs) {
    const result = []
    let i = 0
    while (i < segs.length) {
      let matched = false
      for (let len = Math.min(4, segs.length - i); len >= 2; len--) {
        const key = segs.slice(i, i + len).join('')
        const hit = getWord(this.dict, key)
        if (hit) {
          // 同音词数组取首个（最常见）
          result.push(Array.isArray(hit) ? hit[0] : hit)
          i += len
          matched = true
          break
        }
      }
      if (!matched) {
        const ch = getSylTopChar(this.dict, segs[i])
        result.push(ch)
        i++
      }
    }
    composed = result.join('')
    if (composed.length !== segs.length) composed = ''
  }

  // 整词去重保序
  const wout = []
  for (const w of wordHits) {
    if (w && wout.indexOf(w) === -1) wout.push(w)
  }

  // 非全拼模式（简拼命中）：用词中字位偏移替代 音节拆分偏移
  // 注意：仅当真正走 initials 简拼路径时才成立（每字对应一个首字母，偏移 = 字位 + 1）。
  // 单音节整串命中（segs 为 null，如 dic_words 的 "shei":"谁"）不能走这里——否则偏移被算成 1，
  // 点选候选只消费 1 个字母导致残留（如点"谁"剩"hei"）；此时候选对应整串音节，偏移应为输入全长。
  if (matchSource === 'initials' && pinyin.length >= 2) {
    const abbrChars = []
    for (var wi = 0; wi < wout.length && abbrChars.length < 12; wi++) {
      var word = wout[wi]
      for (var ci = 0; ci < word.length && abbrChars.length < 12; ci++) {
        var ch = word[ci]
        var offset = ci + 1  // 简拼每字对应一个首字母，偏移 = 字位 + 1
        var found = false
        for (var ai = 0; ai < abbrChars.length; ai++) {
          if (abbrChars[ai].char === ch && abbrChars[ai].offset === offset) { found = true; break }
        }
        if (!found) abbrChars.push({ char: ch, offset: offset })
      }
    }
    if (abbrChars.length > 0) sylTopChars = abbrChars
  } else if (!segs && wout.length > 0) {
    // 单音节整串命中（segs=null，如 "shei":"谁"）：候选整词对应整串输入，
    // 逐字候选 offset = 输入全长，点选一次消费整个音节，不残留。
    const fullChars = []
    for (var fi = 0; fi < wout.length && fullChars.length < 8; fi++) {
      const fch = wout[fi].charAt(0) || ''
      let fdup = false
      for (let di = 0; di < fullChars.length; di++) {
        if (fullChars[di].char === fch) { fdup = true; break }
      }
      if (fch && !fdup) fullChars.push({ char: fch, offset: pinyin.length })
    }
    if (fullChars.length > 0) sylTopChars = fullChars
  }

  // 混合模式：用命中词的真实音节首字 + 输入偏移覆盖 sylTopChars
  if (matchSource === 'mixed' && mixedInfo && mixedInfo.syls) {
    var miSyls = mixedInfo.syls
    var mchars = []
    for (var mj = 0; mj < miSyls.length; mj++) {
      var mch = getSylTopChar(this.dict, miSyls[mj])
      if (mch) mchars.push({ char: mch, offset: mixedInfo.offsets[mj] })
    }
    if (mchars.length > 0) sylTopChars = mchars
  }

  return { words: wout, composed: composed, segs: segs, sylTopChars: sylTopChars }
}

SimpleInputMethod.getHanzi = function(pinyin, lang = 'cn') {
  // Chinese candidates require the base resource; Japanese has its own table.
  if (lang === 'cn' && !this.dict.syllableSet) return { chars: [], matched: '', multi: null }
  // 原单字逻辑（首音节同音字串）
  let chars = []
  let matched = ''
  let result = this.getSingleHanzi(pinyin, lang)
  if (result) {
    chars = result.split('')
    matched = pinyin
  } else {
    let max = Math.min(pinyin.length, 6)
    for (let len = max; len >= 1; len--) {
      let head = pinyin.substr(0, len)
      let rs = this.getSingleHanzi(head, lang)
      if (rs) {
        chars = rs.split('')
        matched = head
        break
      }
    }
  }

  // 多拼候选（仅 cn）
  let multi = null
  if (lang === 'cn') {
    multi = this.getMultiHanzi(pinyin, lang)
  }

  return { chars, matched, multi }
}

export { createInputMethod }
