import express from 'express'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
app.use(express.json({ limit: '50kb' }))
app.use(express.static(path.join(__dirname, 'dist')))

app.get('/health', (_, res) => res.json({ ok: true }))

app.post('/api/review', async (req, res) => {
  const { content, weekKey } = req.body
  if (!content?.trim()) return res.status(400).json({ error: 'no content' })

  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'GROQ_API_KEY not set on server' })

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
    const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 1200,
        temperature: 0.7,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    const data = await resp.json()
    if (data.error) return res.status(502).json({ error: data.error.message })
    res.json({ text: data.choices?.[0]?.message?.content || '' })
  } catch (e) {
    res.status(502).json({ error: e.message })
  }
})

// SPA fallback
app.get('*', (_, res) => res.sendFile(path.join(__dirname, 'dist', 'index.html')))

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`[intelligence-journal] port ${PORT}`))
