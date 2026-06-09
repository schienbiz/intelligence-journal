import express from 'express'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
app.use(express.json({ limit: '50kb' }))
app.use(express.static(path.join(__dirname, 'dist')))

app.get('/health', (_, res) => res.json({ ok: true }))

// ── Simple per-IP rate limit: max 8 reviews per minute ────────────────────────
const rateMap = new Map()
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
  { name: 'Groq',     url: 'https://api.groq.com/openai/v1/chat/completions',     key: () => process.env.GROQ_API_KEY,     model: 'meta-llama/llama-4-scout-17b-16e-instruct' },
  { name: 'Cerebras', url: 'https://api.cerebras.ai/v1/chat/completions',          key: () => process.env.CEREBRAS_API_KEY, model: 'gpt-oss-120b' },
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

    const reader = upstream.body.getReader()
    const dec = new TextDecoder()
    let buf = ''

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
  } catch (e) {
    if (!res.headersSent) res.status(502).json({ error: e.message })
    else { res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`); res.end() }
  }
})

// SPA fallback
app.get('*', (_, res) => res.sendFile(path.join(__dirname, 'dist', 'index.html')))

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`[intelligence-journal] port ${PORT}`))
