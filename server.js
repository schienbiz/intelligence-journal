import express from 'express'
import { fileURLToPath } from 'url'
import path from 'path'
import { readFileSync } from 'fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()

// Render terminates TLS at its own proxy, so without this every request arrives
// from the same upstream socket: `req.ip` was identical for all visitors and the
// 8/min rate limit below was a single GLOBAL bucket, not a per-visitor one. The
// hop count is 1 (Render's proxy) rather than `true`, so the client-controlled
// leftmost X-Forwarded-For entry cannot be spoofed to escape the limit.
app.set('trust proxy', 1)

// Access log for external requests (has x-forwarded-for). This is a free-tier
// service that should spin down when idle; a hidden 24/7 pinger silently burns the
// shared Render workspace pool and can suspend sibling services. Logging UA + origin
// IP of every external hit means any keepalive source is identifiable from the logs
// with zero guesswork. Skips static assets/health to keep volume near-zero.
app.use((req, _res, next) => {
  const xff = req.headers['x-forwarded-for']
  if (xff && !req.path.startsWith('/assets') && req.path !== '/favicon.ico' && req.path !== '/health') {
    // `req.ip` (with trust proxy = 1) is the address Render itself recorded. The
    // leftmost X-Forwarded-For entry is whatever the caller sent, so a keepalive
    // pinger could have hidden behind a forged one — which defeats the only
    // reason this log exists.
    console.log(`[access] ${req.method} ${req.path} ua="${req.headers['user-agent'] || '-'}" ip="${req.ip}"`)
  }
  next()
})

app.use(express.json({ limit: '50kb' }))
app.use(express.static(path.join(__dirname, 'dist')))

const ICHING = JSON.parse(readFileSync(path.join(__dirname, 'src/data/iching.json'), 'utf8'))
const TAROT  = JSON.parse(readFileSync(path.join(__dirname, 'src/data/tarot.json'), 'utf8'))

// `ok: true` regardless of whether a single provider still answers is how four
// dead providers stayed green for weeks. The provider view costs no API calls:
// it replays what the last real request already learned.
app.get('/health', (_, res) => {
  const providers = Object.fromEntries(
    Object.values(PROVIDERS).map(p => [p.name, providerHealth.get(p.name) || { ok: null, kind: null, model: p.model, why: 'not called yet' }])
  )
  const seen = Object.values(providers).filter(v => v.ok !== null)
  // The one line worth alerting on: a provider whose last failure was structural
  // is a retired model or a dead key, and it will not recover by itself.
  const structural = Object.entries(providers)
    .filter(([, v]) => v.ok === false && v.kind === 'structural')
    .map(([name, v]) => `${name}: ${v.why}`)
  res.json({
    ok: true,
    aiReady: seen.length === 0 ? null : seen.some(v => v.ok),
    structuralFailures: structural,
    providers,
  })
})

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

// ── Providers ────────────────────────────────────────────────────────────────
// Model IDs and per-provider parameter support were checked against the live
// APIs on 2026-09-01. Two things that previously broke silently are now encoded
// here instead of assumed:
//   * `reasoningEffort` — Groq and NVIDIA accept `reasoning_effort`; Mistral
//     answers 400 to it, and Mistral is the last hop, so sending it blindly
//     would take out the fallback that survives everything else.
//   * Stages name providers by KEY (see STAGES below), never by array position.
//     The old code reached into REVIEW_PROVIDERS[0..3] from /api/oracle, so
//     deleting one dead provider would have silently re-pointed every later
//     stage at a different model and run stage 4 against `undefined`.
//
// Cerebras is deliberately absent: every key on the account answers 402
// payment_required, so keeping it in a chain only bought a wasted round-trip.
const PROVIDERS = {
  groq: {
    name: 'Groq',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    key: () => process.env.GROQ_API_KEY,
    model: 'openai/gpt-oss-120b',
    reasoningEffort: true,
  },
  nvidia: {
    name: 'NVIDIA',
    url: 'https://integrate.api.nvidia.com/v1/chat/completions',
    key: () => process.env.NVIDIA_API_KEY,
    model: 'openai/gpt-oss-120b',
    reasoningEffort: true,
  },
  mistral: {
    name: 'Mistral',
    url: 'https://api.mistral.ai/v1/chat/completions',
    key: () => process.env.MISTRAL_API_KEY,
    model: 'mistral-small-latest',
    reasoningEffort: false,
  },
}

// Every stage gets a full chain. /api/oracle previously had none: one dead
// provider anywhere in the four stages killed the whole reading.
//
// `maxTokens` is sized for a REASONING model. gpt-oss emits its chain of thought
// against the same budget as the answer, so the old scout ceiling of 500 was
// measured at 0/6 — reasoning ate 344-498 tokens and the JSON came back truncated
// with finish_reason=length. `effort: 'low'` cuts reasoning to ~30-70 tokens,
// which is what makes these ceilings comfortable rather than merely adequate.
const STAGES = {
  review:    { chain: ['groq', 'nvidia', 'mistral'], maxTokens: 1200, effort: 'low', stream: true },
  scout:     { chain: ['groq', 'nvidia', 'mistral'], maxTokens: 1500, effort: 'low', json: true },
  analyst:   { chain: ['groq', 'nvidia', 'mistral'], maxTokens: 2000, effort: 'low', json: true },
  synth:     { chain: ['groq', 'nvidia', 'mistral'], maxTokens: 1500, effort: 'low', json: true },
  validator: { chain: ['groq', 'nvidia', 'mistral'], maxTokens: 1200, effort: 'low' },
}

const REQUEST_TIMEOUT_MS = 45_000

// Last outcome per provider, updated from traffic we already make. /health reads
// this instead of probing: an audit probe would itself be a keepalive source and
// wake a service that is supposed to spin down when idle.
const providerHealth = new Map()

// A 429 or a timeout means "busy, try again in a minute". A 401/402/404/410
// means the chain itself is wrong and no amount of waiting will fix it. Folding
// both into a bare ok:false is precisely what made a total outage look like an
// ordinary busy afternoon — so the two are kept apart and only the structural
// kind is worth waking someone for.
function classify(status) {
  if (status === 408 || status === 429 || status >= 500) return 'transient'
  return 'structural'
}
function note(provider, ok, why, kind) {
  providerHealth.set(provider.name, { ok, why, kind: ok ? null : (kind || 'structural'), model: provider.model, at: new Date().toISOString() })
}

function buildBody(provider, messages, opts) {
  const body = {
    model: provider.model,
    max_tokens: opts.maxTokens,
    temperature: opts.temperature ?? 0.7,
    stream: !!opts.stream,
    messages,
  }
  if (opts.effort && provider.reasoningEffort) body.reasoning_effort = opts.effort
  if (opts.json) body.response_format = { type: 'json_object' }
  return body
}

async function attempt(provider, messages, opts) {
  if (!provider.key()) {
    // Recorded, not just returned. A provider skipped for a missing key would
    // otherwise sit at "not called yet" on /health forever — the same shape as a
    // provider that is simply idle, when in fact it can never serve anything.
    const why = 'no API key configured'
    note(provider, false, why, 'structural')
    return { ok: false, why }
  }
  let r
  try {
    r = await fetch(provider.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.key()}` },
      body: JSON.stringify(buildBody(provider, messages, opts)),
      // Without this a hung provider hangs the whole chain: four stages in series
      // with no deadline has no upper bound at all.
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (e) {
    const why = e.name === 'TimeoutError' ? `timeout after ${REQUEST_TIMEOUT_MS}ms` : (e.message || String(e))
    note(provider, false, why, 'transient')
    return { ok: false, why }
  }
  if (!r.ok) {
    // Read the error body even though we discard the response: it carries the
    // only description of WHY (404 retired model vs 402 unpaid vs 410 EOL), and
    // an unread body keeps the socket checked out of the connection pool.
    const detail = (await r.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 180)
    const why = `HTTP ${r.status} ${detail}`
    note(provider, false, why, classify(r.status))
    return { ok: false, why }
  }
  note(provider, true, null)
  return { ok: true, res: r }
}

// Walks a stage's chain and — the part that was missing — says out loud which
// providers failed and why. The last outage was four dead providers behind a
// single generic 502; nothing in the logs named a model or a status code.
async function callChain(stageName, messages) {
  const opts = STAGES[stageName]
  if (!opts) throw new Error(`unknown stage: ${stageName}`)
  const failures = []
  for (const id of opts.chain) {
    const provider = PROVIDERS[id]
    if (!provider) { failures.push(`${id}: not in registry`); continue }
    const a = await attempt(provider, messages, opts)
    if (a.ok) {
      if (failures.length) console.warn(`[${stageName}] fell through — ${failures.join(' | ')}`)
      console.log(`[${stageName}] served by ${provider.name} (${provider.model})`)
      return { res: a.res, provider }
    }
    failures.push(`${provider.name}(${provider.model}): ${a.why}`)
  }
  console.error(`[${stageName}] ALL PROVIDERS FAILED — ${failures.join(' | ')}`)
  const err = new Error('All AI providers unavailable')
  err.failures = failures
  throw err
}

// Non-streaming call used by the oracle pipeline.
async function callText(stageName, messages) {
  // Guard against the mismatch this refactor actually introduced once: a stage
  // whose config says `stream: true` returns SSE, and every downstream reader
  // silently finds zero content instead of failing where the mistake is.
  if (STAGES[stageName]?.stream) throw new Error(`stage ${stageName} is configured streaming; callText needs a non-streaming stage`)
  const { res, provider } = await callChain(stageName, messages)
  const data = await res.json()
  const choice = data.choices?.[0]
  const msg = choice?.message
  const finish = choice?.finish_reason
  // A reasoning model that spends its budget thinking returns content as an
  // EMPTY STRING, not null, so `content ?? reasoning` hands back "" and the
  // caller reports a misleading "invalid JSON". Fall through on empty, not just
  // on null, and name the real cause.
  const content = (msg?.content || '').trim() || (msg?.reasoning || '').trim()
  if (!content) {
    throw new Error(`${provider.name} returned empty content (finish_reason=${finish}) — likely max_tokens exhausted by reasoning`)
  }
  if (finish === 'length') console.warn(`[${stageName}] ${provider.name} hit max_tokens — output may be truncated`)
  return content
}

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

  let upstream, servedBy
  try {
    ({ res: upstream, provider: servedBy } = await callChain('review', [{ role: 'user', content: prompt }]))
  } catch (e) {
    return res.status(502).json({ error: e.message, providers: e.failures || [] })
  }

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
  let emitted = 0

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
        if (data === '[DONE]') { finish(); return }
        try {
          const parsed = JSON.parse(data)
          const delta = parsed.choices?.[0]?.delta
          const text = delta?.content
          if (text) { emitted += text.length; res.write(`data: ${JSON.stringify({ text })}\n\n`) }
          // A reasoning model sends dozens of `reasoning` deltas before the first
          // `content` one (measured: first content at chunk 46 of 95 at default
          // effort). Forwarding a contentless progress tick keeps the client from
          // rendering a blank panel while the model is still thinking.
          else if (delta?.reasoning) res.write(`data: ${JSON.stringify({ thinking: true })}\n\n`)
        } catch {}
      }
    }
    finish()
  } catch (e) {
    if (!closed) { res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`); res.end() }
  } finally {
    clearInterval(keepAlive)
    // The stream is abandoned when the client leaves; without cancelling, the
    // upstream connection stays open until GC gets to it.
    reader.cancel().catch(() => {})
  }

  // A stream that ends having emitted zero characters used to reach the browser
  // as a clean [DONE]. The client then saved "" over the week's cached review and
  // showed an empty panel with no error — the failure looked like a blank page.
  function finish() {
    if (closed) return
    if (emitted === 0) {
      console.error(`[review] ${servedBy.name} streamed zero content — treating as failure`)
      // r.ok only proves the response HEADERS were fine; a stream can still come
      // back empty. Without this, /health would keep calling the provider healthy
      // on exactly the failure mode that started this whole investigation.
      note(servedBy, false, 'streamed zero content', 'structural')
      res.write(`data: ${JSON.stringify({ error: '模型回傳空內容（可能是 max_tokens 被推理耗盡）' })}\n\n`)
    }
    res.write('data: [DONE]\n\n')
    res.end()
  }
})

// ── /api/oracle — 4-Agent sequential pipeline ─────────────────────────────────
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
    // ── Stage 1: Scout — pick resonant hexagrams/cards, JSON out ─────────────
    send({ stage: 'scout' })
    const ichingList = ICHING.map(h => `${h.hex}.${h.zh}(${h.en})`).join(' ')
    const majorList  = TAROT.filter(c => c.suit === 'major').map(c => `${c.rank}.${c.name}`).join(' ')

    const scoutRaw = await callText('scout', [{
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
    }])

    if (closed) return
    const scout = parseJSON(scoutRaw)
    if (!scout?.hexagrams?.length) throw new Error('Scout returned invalid JSON')
    send({ stage: 'scout', ok: true, scout })

    // ── Stage 2: Analyst — cross-system reading, JSON out ────────────────────
    send({ stage: 'analyst' })
    const hexDetail = (scout.hexagrams || []).map(h => {
      const f = ICHING.find(i => +i.hex === +h.id) || {}
      return `${f.font || ''} 卦${h.id} ${f.zh}「${f.en}」— ${h.reason}`
    }).join('\n')
    const tarotDetail = (scout.tarot || []).map(t => {
      const c = TAROT.find(x => x.name === t.name) || {}
      return `${t.name}: 關鍵詞[${(c.keywords||[]).join(',')}] 光[${(c.light||[]).slice(0,2).join(';')}] 影[${(c.shadow||[]).slice(0,2).join(';')}]`
    }).join('\n')

    const analystRaw = await callText('analyst', [{
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
    }])

    if (closed) return
    const analyst = parseJSON(analystRaw)
    if (!analyst?.iching_analysis) throw new Error('Analyst returned invalid JSON')
    send({ stage: 'analyst', ok: true })

    // ── Stage 3: Synth — actionable synthesis, JSON out ──────────────────────
    send({ stage: 'synth' })
    const synthRaw = await callText('synth', [{
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
    }])

    if (closed) return
    const synth = parseJSON(synthRaw)
    if (!synth?.insight) throw new Error('Synth returned invalid JSON')
    send({ stage: 'synth', ok: true })

    // ── Stage 4: Validator — final markdown reading ──────────────────────────
    send({ stage: 'validator' })
    const hexSymbol  = (scout.hexagrams || []).map(h => { const f = ICHING.find(i => +i.hex === +h.id); return f ? `${f.font}${f.zh}` : '' }).join(' ')
    const tarotSymbol = (scout.tarot || []).map(t => t.name).join(' + ')

    const result = await callText('validator', [{
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
    }])

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

// An unknown /api path used to fall through to the SPA and answer HTML with a
// 200, so a typo'd or renamed endpoint looked like a JSON parse error on the
// client instead of a 404.
app.all('/api/*', (req, res) => res.status(404).json({ error: `no such endpoint: ${req.method} ${req.path}` }))

// SPA fallback
app.get('*', (_, res) => res.sendFile(path.join(__dirname, 'dist', 'index.html')))

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`[intelligence-journal] port ${PORT}`)
})
