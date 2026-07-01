import express from 'express'
import { fileURLToPath } from 'url'
import path from 'path'
import { readFileSync } from 'fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()

// TEMP DIAG (2026-07-01): identify the external keepalive pinger hitting this
// service 24/7. Logs UA + forwarded IP for non-asset requests. Remove after capture.
app.use((req, _res, next) => {
  if (!req.path.startsWith('/assets') && req.path !== '/favicon.ico') {
    console.log(`[probe] ${req.method} ${req.path} ua="${req.headers['user-agent'] || '-'}" xff="${req.headers['x-forwarded-for'] || '-'}"`)
  }
  next()
})

app.use(express.json({ limit: '50kb' }))
app.use(express.static(path.join(__dirname, 'dist')))

const ICHING = JSON.parse(readFileSync(path.join(__dirname, 'src/data/iching.json'), 'utf8'))
const TAROT  = JSON.parse(readFileSync(path.join(__dirname, 'src/data/tarot.json'), 'utf8'))

app.get('/health', (_, res) => res.json({ ok: true }))

// ── Per-IP rate limit: max 8 reviews/min; cleanup every hour ─────────────────
const rateMap = new Map()
setInterval(() => {
  const cutoff = Date.now() - 60_000
  for (const [ip, times] of rateMap) {
    const fresh = times.filter(t => t > cutoff)
    fresh.length ? rateMap.set(ip, fresh) : rateMap.delete(ip)
  }
}, 60 * 60 * 1000)

function rateLimit(req, res, next) {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown'
  const now = Date.now()
  const prev = (rateMap.get(ip) || []).filter(t => now - t < 60_000)
  prev.push(now)
  rateMap.set(ip, prev)
  if (prev.length > 8) return res.status(429).json({ error: '請求過於頻繁，請稍後再試。' })
  next()
}

// Providers tried in order; first successful response streams to client
const REVIEW_PROVIDERS = [
  { name: 'Groq',     url: 'https://api.groq.com/openai/v1/chat/completions',          key: () => process.env.GROQ_API_KEY,     model: 'meta-llama/llama-4-scout-17b-16e-instruct' },
  { name: 'Cerebras', url: 'https://api.cerebras.ai/v1/chat/completions',               key: () => process.env.CEREBRAS_API_KEY, model: 'gpt-oss-120b' },
  { name: 'NVIDIA',   url: 'https://integrate.api.nvidia.com/v1/chat/completions',      key: () => process.env.NVIDIA_API_KEY,   model: 'meta/llama-3.3-70b-instruct' },
  { name: 'Mistral',  url: 'https://api.mistral.ai/v1/chat/completions',                key: () => process.env.MISTRAL_API_KEY,  model: 'mistral-large-latest' },
]

// ── /api/review — SSE streaming ───────────────────────────────────────────────
app.post('/api/review', rateLimit, async (req, res) => {
  const { content, weekKey } = req.body
  if (!content?.trim()) return res.status(400).json({ error: 'no content' })

  const prompt =
`你是 Boss Tung 的人生合夥人。以下是本週（${weekKey || ''}）三個情報 Routine 的報告。

執行【週六優化複盤】：

1. 找出跨 Routine 關聯的「TOP 3 趨勢信號」（強調三者的交叉點）
2. 每個信號：強度（🔴高/🟡中/🟢低）、交叉來源、具體行動
3. 盲點警告：Boss Tung 沒注意到但值得深思的角度
4. 下週 One Thing：一個最優先執行的具體行動

繁體中文，500字以內，格式嚴格遵守。

─────────
${content}
─────────

輸出格式：

## 🎯 TOP 3 趨勢信號

**#1 [標題]** 🔴/🟡/🟢
交叉：[來源Routine]
洞察：[1-2句]
行動：[具體步驟]

**#2 [標題]** 🔴/🟡/🟢
交叉：…
洞察：…
行動：…

**#3 [標題]** 🔴/🟡/🟢
交叉：…
洞察：…
行動：…

## ⚠️ 盲點警告

[2-3句]

## 🚀 下週 One Thing

[動詞 + 具體目標 + 截止時間]`

  try {
    let upstream, providerName
    for (const p of REVIEW_PROVIDERS) {
      if (!p.key()) continue
      try {
        const r = await fetch(p.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.key()}` },
          body: JSON.stringify({ model: p.model, max_tokens: 1200, temperature: 0.7, stream: true, messages: [{ role: 'user', content: prompt }] }),
        })
        if (r.ok) { upstream = r; providerName = p.name; break }
      } catch { /* try next */ }
    }

    if (!upstream) return res.status(502).json({ error: 'All AI providers unavailable' })
    console.log(`[review] streaming via ${providerName}`)

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')

    let closed = false
    res.on('close', () => { closed = true })

    // SSE keepalive: prevent proxy/Render from closing idle connection during slow providers
    const keepAlive = setInterval(() => { if (!closed) res.write(': ping\n\n') }, 15_000)

    const reader = upstream.body.getReader()
    const dec = new TextDecoder()
    let buf = ''

    try {
      while (!closed) {
        const { value, done } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop()

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6)
          if (data === '[DONE]') { res.write('data: [DONE]\n\n'); res.end(); return }
          try {
            const parsed = JSON.parse(data)
            const text = parsed.choices?.[0]?.delta?.content
            if (text) res.write(`data: ${JSON.stringify({ text })}\n\n`)
          } catch {}
        }
      }
      res.write('data: [DONE]\n\n')
      res.end()
    } finally {
      clearInterval(keepAlive)
    }
  } catch (e) {
    if (!res.headersSent) res.status(502).json({ error: e.message })
    else { res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`); res.end() }
  }
})

// ── /api/oracle — 4-Agent sequential pipeline ─────────────────────────────────
async function callAI(provider, messages, maxTokens) {
  if (!provider.key()) throw new Error(`No key: ${provider.name}`)
  const r = await fetch(provider.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.key()}` },
    body: JSON.stringify({ model: provider.model, max_tokens: maxTokens, temperature: 0.7, stream: false, messages }),
  })
  if (!r.ok) throw new Error(`${provider.name} ${r.status}: ${await r.text().catch(() => '')}`)
  const data = await r.json()
  const msg = data.choices?.[0]?.message
  // Cerebras gpt-oss-120b returns reasoning separately; content may be null
  return ((msg?.content ?? msg?.reasoning) || '').trim()
}

function parseJSON(text) {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || text.match(/(\{[\s\S]*\})/)
  try { return JSON.parse(m ? m[1] : text) } catch { return null }
}

app.post('/api/oracle', rateLimit, async (req, res) => {
  const { question } = req.body
  if (!question?.trim()) return res.status(400).json({ error: 'no question' })

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  let closed = false
  res.on('close', () => { closed = true })
  const send = obj => { if (!closed) res.write(`data: ${JSON.stringify(obj)}\n\n`) }
  const keepAlive = setInterval(() => { if (!closed) res.write(': ping\n\n') }, 15_000)

  try {
    // ── Stage 1: Scout (Groq llama-4-scout) ──────────────────────────────────
    send({ stage: 'scout' })
    const ichingList = ICHING.map(h => `${h.hex}.${h.zh}(${h.en})`).join(' ')
    const majorList  = TAROT.filter(c => c.suit === 'major').map(c => `${c.rank}.${c.name}`).join(' ')

    const scoutRaw = await callAI(REVIEW_PROVIDERS[0], [{
      role: 'user',
      content:
`Business decision question: "${question}"

I Ching hexagrams (id.Chinese(English)):
${ichingList}

Tarot Major Arcana (rank.Name):
${majorList}

Select 1-2 hexagrams and 1-2 Major Arcana cards that best resonate with this specific business situation.
Output JSON only — no text outside the JSON block:
{"hexagrams":[{"id":1,"zh":"乾","en":"Initiating","reason":"..."}],"tarot":[{"rank":0,"name":"The Fool","reason":"..."}]}`
    }], 500)

    if (closed) return
    const scout = parseJSON(scoutRaw)
    if (!scout?.hexagrams?.length) throw new Error('Scout returned invalid JSON')
    send({ stage: 'scout', ok: true, scout })

    // ── Stage 2: Analyst (Cerebras gpt-oss-120b) ─────────────────────────────
    send({ stage: 'analyst' })
    const hexDetail = (scout.hexagrams || []).map(h => {
      const f = ICHING.find(i => +i.hex === +h.id) || {}
      return `${f.font || ''} 卦${h.id} ${f.zh}「${f.en}」— ${h.reason}`
    }).join('\n')
    const tarotDetail = (scout.tarot || []).map(t => {
      const c = TAROT.find(x => x.name === t.name) || {}
      return `${t.name}: 關鍵詞[${(c.keywords||[]).join(',')}] 光[${(c.light||[]).slice(0,2).join(';')}] 影[${(c.shadow||[]).slice(0,2).join(';')}]`
    }).join('\n')

    const analystRaw = await callAI(REVIEW_PROVIDERS[1], [{
      role: 'user',
      content:
`Business question: "${question}"

I Ching selected:
${hexDetail}

Tarot selected:
${tarotDetail}

Analyze how these systems illuminate this business decision. Find convergence points.
Output JSON only:
{"iching_analysis":"...","tarot_analysis":"...","convergence":["point1","point2","point3"]}`
    }], 1500)

    if (closed) return
    const analyst = parseJSON(analystRaw)
    if (!analyst?.iching_analysis) throw new Error('Analyst returned invalid JSON')
    send({ stage: 'analyst', ok: true })

    // ── Stage 3: Synth (NVIDIA llama-3.3-70b) ────────────────────────────────
    send({ stage: 'synth' })
    const synthRaw = await callAI(REVIEW_PROVIDERS[2], [{
      role: 'user',
      content:
`Decision question: "${question}"

Cross-system analysis:
易經洞察: ${analyst.iching_analysis || ''}
塔羅洞察: ${analyst.tarot_analysis || ''}
共振點: ${(Array.isArray(analyst.convergence) ? analyst.convergence : []).join(' / ')}

Synthesize into actionable business intelligence in 繁體中文.
Output JSON only:
{"insight":"...","action":"...","timing":"...","risks":["...","..."]}`
    }], 900)

    if (closed) return
    const synth = parseJSON(synthRaw)
    if (!synth?.insight) throw new Error('Synth returned invalid JSON')
    send({ stage: 'synth', ok: true })

    // ── Stage 4: Validator (Mistral mistral-large-latest) ────────────────────
    send({ stage: 'validator' })
    const hexSymbol  = (scout.hexagrams || []).map(h => { const f = ICHING.find(i => +i.hex === +h.id); return f ? `${f.font}${f.zh}` : '' }).join(' ')
    const tarotSymbol = (scout.tarot || []).map(t => t.name).join(' + ')

    const result = await callAI(REVIEW_PROVIDERS[3], [{
      role: 'user',
      content:
`Decision question: "${question}"

Oracle insight to validate and finalize:
核心洞察: ${synth.insight}
建議行動: ${synth.action || ''}
時機: ${synth.timing || ''}
風險: ${(Array.isArray(synth.risks) ? synth.risks : []).join('; ')}

Ensure the guidance is specific to THIS question (not generic platitudes), actionable within 1-2 weeks.
Output the final Oracle reading in markdown, 繁體中文, under 350 words:

## ${hexSymbol} × ${tarotSymbol}
[1-2句卦象與牌義的交叉共振]

## 💡 決策指引
[針對「${question}」的具體行動建議]

## ⚡ 時機與風險
[時機判斷 + 2個關鍵風險警示]`
    }], 800)

    if (closed) return
    send({ stage: 'validator', ok: true, result })
    send({ done: true })
    res.end()
  } catch (e) {
    console.error('[oracle]', e.message)
    if (!closed) { send({ error: e.message }); res.end() }
  } finally {
    clearInterval(keepAlive)
  }
})

// SPA fallback
app.get('*', (_, res) => res.sendFile(path.join(__dirname, 'dist', 'index.html')))

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`[intelligence-journal] port ${PORT}`)
})
