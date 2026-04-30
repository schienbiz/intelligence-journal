import { useState, useEffect, useRef } from "react";

const ROUTES = ["R1_FNB", "R2_DUBAI", "R3_SANGHUANG"];
const RM = {
  R1_FNB:       { icon:"🍜", label:"F&B + AI 情報", full:"每日 F&B + AI 市場情報摘要", color:"#E8A838", freq:"daily",  hint:"貼上 Routine 1 輸出：F&B市場動態、AI工具更新、Superhuman/1440頭條摘要" },
  R2_DUBAI:     { icon:"🏛️", label:"Dubai 法規",   full:"Dubai 商業法規變動監控",     color:"#60A5FA", freq:"weekly", hint:"貼上 Routine 2 輸出：UAE法規動態、IFZA更新、Golden Visa、稅務變更" },
  R3_SANGHUANG: { icon:"🍄", label:"桑黃市場",     full:"桑黃產品市場輿情追蹤",       color:"#6EE7B7", freq:"daily",  hint:"貼上 Routine 3 輸出：桑黃研究動態、競品分析、消費者聲量、定價觀察" },
};
const DAYS_ZH = ["週一","週二","週三","週四","週五","週六","週日"];

const SAMPLE = {
  R1_FNB: `【🤖 AI & TECH TODAY】
• OpenAI 發布語音模式更新，支援即時翻譯——對台灣 F&B 品牌進入中東市場有直接應用價值
• Superhuman AI：餐飲 POS 系統整合 AI 預測庫存，減少 30% 食材浪費案例報告
• 1440 頭條：中東食品科技投資 Q1 2026 達 2.3 億美元，YoY +45%

【🍜 F&B MARKET INTEL】
• Dubai 健康餐飲品牌「Kcal」宣布擴展至沙烏地，顯示海灣健康餐飲需求持續升溫
• 台灣功能性食品出口 Q1 成長 18%，東南亞與中東為主要目標市場
• 植物性蛋白在 UAE Halal 認證取得突破，品牌進入門檻降低

【⚡ TODAY'S ACTION ITEM】
研究 Kcal 的 Dubai 擴張策略，作為台灣品牌進入 UAE 的參考案例`,

  R2_DUBAI: `【🏛️ 法規動態週報】
HIGH PRIORITY：無重大緊急變動

MEDIUM PRIORITY：
• IFZA 2026 Q2 費用調整預告，建議本季完成公司設立手續
• UAE 企業稅（9%）適用範圍擴大討論中，Free Zone 豁免條件可能調整

F&B SPECIFIC：
• Dubai Municipality 強化 Halal 認證審查，申請時間延長至 8-12 週

TAX & CORPORATE：
• 企業稅申報系統（EmaraTax）更新，需確認申報格式

【📌 RECOMMENDED ACTION】
本週確認 IFZA 公司設立所需文件清單，把握費用調整前的視窗期`,

  R3_SANGHUANG: `【🍄 桑黃市場日報】
📊 市場聲量：中等活躍（近期研究論文 3 篇發布）

🔬 科研動態：
• 台大醫院發布桑黃多醣體免疫調節研究，在國際期刊刊登，可作為品牌科學背書素材

🛒 競品動態：
• 日本 Hokkaido 桑黃品牌進入台灣市場，定價策略偏高端（NT$3,800/月份量）
• 中國電商平台桑黃產品聲量下降，品質爭議導致消費者轉向台灣產品

💰 定價觀察：
• 高端桑黃膠囊：NT$2,800–4,500 / 月份量（台灣市場）
• Dubai 健康保健品溢價空間：+40–60% vs 台灣定價

🎯 高端市場機會：
科學背書 + 台灣產地認證 + Dubai 健康消費升級 = 三重定位優勢`,
};

function getWeekKey(offset = 0) {
  const base = new Date();
  const day = base.getDay();
  const mondayDiff = day === 0 ? -6 : 1 - day;
  const mon = new Date(base);
  mon.setDate(base.getDate() + mondayDiff + offset * 7);
  const jan1 = new Date(mon.getFullYear(), 0, 1);
  const weekNum = Math.ceil((((mon - jan1) / 86400000) + jan1.getDay() + 1) / 7);
  return `${mon.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}
function getWeekRange(offset) {
  const base = new Date();
  const day = base.getDay();
  const mondayDiff = day === 0 ? -6 : 1 - day;
  const mon = new Date(base); mon.setDate(base.getDate() + mondayDiff + offset * 7);
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  return `${mon.getMonth()+1}/${mon.getDate()} – ${sun.getMonth()+1}/${sun.getDate()}`;
}
function getTodayIdx() { const d = new Date().getDay(); return d === 0 ? 6 : d - 1; }
const EMPTY_WEEK = () => Array.from({length:7}, (_, i) => ({dayIndex: i, entries: {R1_FNB:"", R2_DUBAI:"", R3_SANGHUANG:""}}));

// FIX 1: replaced window.storage (Claude artifact API) with localStorage
function sSet(k, v) { try { localStorage.setItem(k, v); return true; } catch(e) { return false; } }
function sGet(k)    { try { return localStorage.getItem(k); } catch(e) { return null; } }

const C = {
  bg:"#09090C", surf:"#0F0F12", surf2:"#141418",
  border:"#1E1E24", borderHi:"#2E2E38",
  gold:"#E8A838", goldDim:"#8A6020", goldBg:"#1C1A0A",
  blue:"#60A5FA", green:"#6EE7B7",
  text:"#E0D8CC", textDim:"#7A7880", textMuted:"#3E3C44",
};

export default function App() {
  const [weekOffset, setWeekOffset] = useState(0);
  const [weekData, setWeekData]     = useState(EMPTY_WEEK());
  const [day, setDay]               = useState(getTodayIdx());
  const [route, setRoute]           = useState("R1_FNB");
  const [text, setText]             = useState("");
  const [review, setReview]         = useState("");
  const [revLoading, setRevLoading] = useState(false);
  const [tab, setTab]               = useState("log");
  const [saveState, setSaveState]   = useState("idle");
  const [loaded, setLoaded]         = useState(false);
  const timer = useRef(null);
  const wk = getWeekKey(weekOffset);

  // Load from storage
  useEffect(() => {
    setLoaded(false);
    const jRaw = sGet(`j:${wk}`);
    const rRaw = sGet(`r:${wk}`);
    try { setWeekData(jRaw ? JSON.parse(jRaw) : EMPTY_WEEK()); } catch { setWeekData(EMPTY_WEEK()); }
    setReview(rRaw || "");
    setLoaded(true);
  }, [wk]);

  // Sync textarea
  useEffect(() => { setText(weekData[day]?.entries?.[route] || ""); }, [day, route, weekData]);

  // Auto-save — FIX 2: spread operators were unicode ellipsis (…) not (...)
  useEffect(() => {
    if (!loaded) return;
    setSaveState("saving");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const nd = weekData.map((d, i) => i === day ? {...d, entries: {...d.entries, [route]: text}} : d);
      const ok = sSet(`j:${wk}`, JSON.stringify(nd));
      if (ok) { setWeekData(nd); setSaveState("saved"); setTimeout(() => setSaveState("idle"), 2000); }
      else setSaveState("error");
    }, 700);
    return () => clearTimeout(timer.current);
  }, [text]);

  const filled = weekData.reduce((a, d) => a + ROUTES.filter(r => d.entries[r]?.trim()).length, 0);
  const dayFilled = i => ROUTES.filter(r => weekData[i]?.entries?.[r]?.trim()).length;
  const todayIdx = getTodayIdx();

  const loadSample = () => setText(SAMPLE[route] || "");

  const doReview = async () => {
    const content = weekData.map((d, i) => {
      const f = ROUTES.filter(r => d.entries[r]?.trim());
      if (!f.length) return null;
      return `=== ${DAYS_ZH[i]} ===\n` + f.map(r => `[${RM[r].full}]\n${d.entries[r]}`).join("\n\n");
    }).filter(Boolean).join("\n\n—\n\n");

    if (!content.trim()) {
      setReview("⚠️ 本週尚無資料。\n\n請先至「📝 每日輸入」頁面填入報告內容。\n如需體驗功能，可點擊「📋 載入範例」按鈕。");
      return;
    }

    const apiKey = import.meta.env.VITE_GROQ_API_KEY;
    if (!apiKey) {
      setReview("❌ 未設定 Groq API Key。\n\n請在 Vercel 環境變數中設定：\nVITE_GROQ_API_KEY=gsk_...\n\n免費取得：console.groq.com");
      return;
    }

    setRevLoading(true);
    setReview("");
    try {
      const prompt =
`你是 Boss Tung 的人生合夥人。以下是本週（${wk}）三個情報 Routine 的報告。

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

[動詞 + 具體目標 + 截止時間]`;

      const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          max_tokens: 1200,
          temperature: 0.7,
          messages: [{role: "user", content: prompt}],
        }),
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error.message);
      const t = data.choices?.[0]?.message?.content || "生成失敗，請重試。";
      setReview(t);
      sSet(`r:${wk}`, t);
    } catch(e) {
      setReview(`❌ 連線錯誤：${e.message}`);
    }
    setRevLoading(false);
  };

  // FIX 2 (continued): spread operator in btn helper
  const btn = (primary, extra = {}) => ({
    padding: "9px 20px", borderRadius: 8, border: primary ? "none" : `1px solid ${C.border}`,
    background: primary ? C.gold : C.surf2, color: primary ? "#09090C" : C.textDim,
    cursor: "pointer", fontSize: 12, fontWeight: primary ? 700 : 400,
    fontFamily: "inherit", letterSpacing: "0.04em", transition: "all 0.13s", ...extra
  });

  const TABS = [["log","📝 每日輸入"], ["week","📊 週覽"], ["review","🎯 週六複盤"]];

  return (
    <div style={{minHeight:"100vh", background:C.bg, color:C.text, fontFamily:"'Georgia','Times New Roman',serif"}}>

      {/* ─ HEADER ─ */}
      <div style={{background:C.surf, borderBottom:`1px solid ${C.border}`,
        padding:"14px 18px", position:"sticky", top:0, zIndex:10}}>
        <div style={{display:"flex", alignItems:"center", justifyContent:"space-between",
          gap:10, flexWrap:"wrap", marginBottom:12}}>
          <div>
            <div style={{fontSize:9, letterSpacing:"0.22em", color:C.gold, textTransform:"uppercase"}}>Boss Tung · 決策日誌</div>
            <div style={{fontSize:17, color:"#F0E8D8", marginTop:1, fontWeight:400}}>Intelligence Journal</div>
          </div>
          <div style={{display:"flex", gap:6, alignItems:"center"}}>
            <button onClick={() => setWeekOffset(o => o-1)} style={btn(false, {padding:"5px 11px", fontSize:12})}>‹</button>
            <div style={{textAlign:"center", minWidth:88}}>
              <div style={{fontSize:11, color:C.gold}}>{weekOffset===0?"本週":weekOffset===-1?"上週":`${Math.abs(weekOffset)}週前`}</div>
              <div style={{fontSize:9, color:C.textDim}}>{getWeekRange(weekOffset)}</div>
            </div>
            <button onClick={() => setWeekOffset(o => Math.min(0, o+1))} disabled={weekOffset>=0}
              style={btn(false, {padding:"5px 11px", fontSize:12, opacity:weekOffset>=0?0.3:1})}>›</button>
          </div>
          <div style={{display:"flex", gap:14}}>
            {[{v:filled, l:"記錄", c:C.gold}, {v:`${Math.round(filled/21*100)}%`, l:"完成率", c:C.blue}].map(({v, l, c}) => (
              <div key={l} style={{textAlign:"center"}}>
                <div style={{fontSize:17, color:c, fontWeight:600}}>{v}</div>
                <div style={{fontSize:8, color:C.textDim, letterSpacing:"0.1em"}}>{l}</div>
              </div>
            ))}
          </div>
        </div>
        <div style={{display:"flex", gap:3}}>
          {TABS.map(([v, l]) => (
            <button key={v} onClick={() => setTab(v)} style={{
              padding:"6px 14px", borderRadius:6, border:"none", cursor:"pointer", fontFamily:"inherit",
              background:tab===v?C.gold:"transparent", color:tab===v?"#09090C":C.textDim,
              fontSize:11, fontWeight:tab===v?700:400, letterSpacing:"0.04em", transition:"all 0.13s"
            }}>{l}</button>
          ))}
        </div>
      </div>

      {/* ─ LOG ─ */}
      {tab==="log" && (
        <div style={{padding:"18px"}}>
          {filled===0 && (
            <div style={{background:C.goldBg, border:`1px solid ${C.gold}35`, borderRadius:10,
              padding:16, marginBottom:18, display:"flex", gap:12}}>
              <span style={{fontSize:22, flexShrink:0}}>💡</span>
              <div>
                <div style={{color:C.gold, fontSize:13, fontWeight:600, marginBottom:4}}>使用說明 How to use</div>
                <div style={{color:"#B0A888", fontSize:12, lineHeight:1.9}}>
                  1. 選擇「日期」→ 選擇「Routine 類型」<br/>
                  2. 將 Claude Routine 自動生成的報告文字貼入下方<br/>
                  3. 系統每 0.7 秒自動儲存，無需手動操作<br/>
                  4. 每週六至「週六複盤」頁面一鍵生成 AI 趨勢分析
                </div>
                <button onClick={loadSample} style={btn(false, {marginTop:10, fontSize:11, padding:"5px 12px"})}>
                  📋 載入範例資料體驗功能
                </button>
              </div>
            </div>
          )}

          {/* Day pills */}
          <div style={{marginBottom:14}}>
            <div style={{fontSize:9, color:C.textDim, letterSpacing:"0.18em", marginBottom:7}}>選擇日期</div>
            <div style={{display:"flex", gap:5, flexWrap:"wrap"}}>
              {DAYS_ZH.map((d, i) => {
                const c = dayFilled(i), sel = i===day, today = i===todayIdx && weekOffset===0;
                return (
                  <button key={i} onClick={() => setDay(i)} style={{
                    padding:"7px 11px", borderRadius:8, fontFamily:"inherit",
                    border:`1px solid ${sel?C.gold:c>0?C.borderHi:C.border}`,
                    background:sel?"#1C1A0A":"transparent",
                    color:sel?C.gold:c>0?"#C8B070":C.textMuted,
                    cursor:"pointer", fontSize:12, minWidth:50, textAlign:"center",
                    position:"relative", transition:"all 0.12s"
                  }}>
                    <div>{d}</div>
                    <div style={{fontSize:8, marginTop:1, color:sel?C.goldDim:c>0?"#6A5820":C.textMuted}}>
                      {c>0?`${c}/3✓`:today?"今天":"—"}
                    </div>
                    {today && <div style={{position:"absolute", top:3, right:3, width:4, height:4,
                      borderRadius:"50%", background:C.gold}}/>}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Route pills */}
          <div style={{marginBottom:14}}>
            <div style={{fontSize:9, color:C.textDim, letterSpacing:"0.18em", marginBottom:7}}>選擇情報類型</div>
            <div style={{display:"flex", gap:7, flexWrap:"wrap"}}>
              {ROUTES.map(r => {
                const m = RM[r], has = weekData[day]?.entries?.[r]?.trim(), sel = r===route;
                return (
                  <button key={r} onClick={() => setRoute(r)} style={{
                    padding:"9px 15px", borderRadius:10, fontFamily:"inherit",
                    border:`1px solid ${sel?m.color:has?C.borderHi:C.border}`,
                    background:sel?`${m.color}14`:"transparent",
                    color:sel?m.color:has?"#9A9080":C.textDim,
                    cursor:"pointer", fontSize:12, transition:"all 0.12s"
                  }}>
                    <span style={{fontWeight:sel?600:400}}>{m.icon} {m.label}</span>
                    <span style={{fontSize:9, marginLeft:6, color:has?C.goldDim:C.textMuted}}>
                      {has?"✓":""}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Editor */}
          <div style={{background:C.surf, borderRadius:12,
            border:`1px solid ${RM[route].color}28`, padding:16}}>
            <div style={{display:"flex", justifyContent:"space-between",
              alignItems:"center", marginBottom:10}}>
              <div style={{fontSize:9, color:RM[route].color, letterSpacing:"0.15em", textTransform:"uppercase"}}>
                {DAYS_ZH[day]} · {RM[route].full}
              </div>
              <div style={{display:"flex", gap:8, alignItems:"center"}}>
                <button onClick={loadSample} style={btn(false, {padding:"3px 10px", fontSize:10})}>📋 載入範例</button>
                <div style={{fontSize:9, color:
                  saveState==="saved"?"#6EE7B7":saveState==="saving"?C.goldDim:
                  saveState==="error"?"#F87171":C.textMuted}}>
                  {saveState==="saved"?"✓ 已儲存":saveState==="saving"?"儲存中…":
                   saveState==="error"?"⚠ 儲存失敗":""}
                </div>
              </div>
            </div>
            <div style={{fontSize:9, color:C.textMuted, marginBottom:8, lineHeight:1.6}}>
              💡 {RM[route].hint}
            </div>
            <textarea value={text} onChange={e => setText(e.target.value)}
              placeholder={`貼上「${RM[route].label}」Routine 的輸出內容…\n\n沒有 Routine 輸出？點擊右上「載入範例」體驗功能`}
              style={{
                width:"100%", minHeight:220, background:"transparent",
                border:`1px solid ${C.border}`, borderRadius:8, outline:"none",
                color:"#D4C8B4", fontSize:12, lineHeight:1.85, resize:"vertical",
                fontFamily:"'Georgia',serif", padding:12, boxSizing:"border-box",
              }}/>
            <div style={{display:"flex", justifyContent:"space-between",
              marginTop:6, fontSize:9, color:C.textMuted}}>
              <span>{text.length} 字元</span>
              <span>自動儲存 · Auto-saved to browser</span>
            </div>
          </div>
        </div>
      )}

      {/* ─ WEEK ─ */}
      {tab==="week" && (
        <div style={{padding:"18px"}}>
          <div style={{fontSize:9, color:C.textDim, letterSpacing:"0.15em", marginBottom:14}}>
            {wk} · {filled}/21 ENTRIES LOGGED
          </div>
          <div style={{display:"flex", gap:8, marginBottom:18, flexWrap:"wrap"}}>
            {ROUTES.map(r => {
              const m = RM[r], cnt = weekData.filter(d => d.entries[r]?.trim()).length;
              const tot = m.freq==="weekly"?1:7, pct = Math.round(cnt/tot*100);
              return (
                <div key={r} style={{flex:"1 1 160px", background:C.surf,
                  border:`1px solid ${C.border}`, borderRadius:10, padding:12}}>
                  <div style={{fontSize:10, color:m.color, marginBottom:7}}>{m.icon} {m.label}</div>
                  <div style={{display:"flex", gap:8, alignItems:"center"}}>
                    <div style={{flex:1, height:5, background:C.border, borderRadius:3}}>
                      <div style={{width:`${pct}%`, height:"100%", background:m.color,
                        borderRadius:3, transition:"width 0.4s"}}/>
                    </div>
                    <span style={{fontSize:10, color:C.textDim}}>{cnt}/{tot}</span>
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{overflowX:"auto"}}>
            <div style={{display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:5, minWidth:560}}>
              {DAYS_ZH.map((d, i) => {
                const today = i===todayIdx && weekOffset===0;
                return (
                  <div key={i} onClick={() => { setDay(i); setTab("log"); }}
                    style={{background:C.surf, borderRadius:10, padding:10, cursor:"pointer",
                      border:`1px solid ${today?C.gold+"50":C.border}`,
                      transition:"border-color 0.12s"}}>
                    <div style={{fontSize:10, fontWeight:600, color:today?C.gold:C.textDim,
                      marginBottom:7, paddingBottom:6, borderBottom:`1px solid ${C.border}`}}>
                      {d}{today && <span style={{fontSize:7, marginLeft:4, color:C.gold}}>今</span>}
                    </div>
                    {ROUTES.map(r => {
                      const m = RM[r], t = weekData[i]?.entries?.[r]?.trim();
                      return (
                        <div key={r} style={{marginBottom:5}}>
                          <div style={{fontSize:8, color:t?m.color:C.border}}>
                            {t?"●":"○"} {m.icon}
                          </div>
                          {t && <div style={{fontSize:8, color:C.textDim, lineHeight:1.4,
                            overflow:"hidden", display:"-webkit-box",
                            WebkitLineClamp:2, WebkitBoxOrient:"vertical"}}>
                            {t.substring(0, 55)}
                          </div>}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
          <div style={{fontSize:9, color:C.textMuted, marginTop:10, textAlign:"center"}}>
            點擊任一天 → 跳轉編輯 · Click any cell to edit
          </div>
        </div>
      )}

      {/* ─ REVIEW ─ */}
      {tab==="review" && (
        <div style={{padding:"18px", maxWidth:780}}>
          <div style={{background:C.goldBg, border:`1px solid ${C.gold}35`,
            borderRadius:12, padding:18, marginBottom:18}}>
            <div style={{fontSize:9, color:C.gold, letterSpacing:"0.2em", marginBottom:5}}>週六複盤 · SATURDAY OPTIMIZATION REVIEW</div>
            <div style={{fontSize:12, color:"#B8B098", lineHeight:1.8, marginBottom:14}}>
              AI 交叉分析本週 <b style={{color:C.gold}}>{filled}</b>/21 份報告，找出趨勢信號、盲點警告、下週 One Thing。
              {filled<3 && <div style={{color:"#F87171", marginTop:5, fontSize:11}}>
                ⚠️ 建議至少 3 份報告再分析（目前 {filled} 份）。
                可至「每日輸入」用「載入範例」填充測試資料。
              </div>}
            </div>
            <div style={{display:"flex", gap:8, flexWrap:"wrap"}}>
              <button onClick={doReview} disabled={revLoading}
                style={btn(true, {opacity:revLoading?0.6:1})}>
                {revLoading?"🔄 AI 分析中…":"🎯 生成本週趨勢信號分析"}
              </button>
              {review && <button onClick={() => setReview("")}
                style={btn(false, {fontSize:11, padding:"9px 14px"})}>🗑 清除</button>}
              {review && <button onClick={() => {
                try { navigator.clipboard.writeText(review); } catch(e) {}
              }} style={btn(false, {fontSize:11, padding:"9px 14px"})}>📋 複製</button>}
            </div>
          </div>

          {revLoading && (
            <div style={{background:C.surf, borderRadius:12, padding:28,
              border:`1px solid ${C.border}`, textAlign:"center"}}>
              <div style={{color:C.goldDim, marginBottom:10, fontSize:13}}>
                🔄 正在交叉分析 {filled} 份報告…
              </div>
              <div style={{color:C.textMuted, fontSize:11, marginBottom:16}}>
                AI 正在找出跨 Routine 的趨勢關聯，約需 10–20 秒
              </div>
              <div style={{display:"flex", justifyContent:"center", gap:5}}>
                {[0,1,2].map(i => (
                  <div key={i} style={{width:7, height:7, borderRadius:"50%",
                    background:C.gold, animation:`bounce 1.2s ease-in-out ${i*0.2}s infinite`}}/>
                ))}
              </div>
            </div>
          )}

          {!revLoading && review && (
            <div style={{background:C.surf, border:`1px solid ${C.border}`, borderRadius:12, padding:22}}>
              <div style={{fontSize:9, color:C.textDim, letterSpacing:"0.15em",
                marginBottom:14, paddingBottom:12, borderBottom:`1px solid ${C.border}`}}>
                {wk} · AI ANALYSIS · 已自動儲存
              </div>
              <div style={{fontSize:13, lineHeight:2, color:"#D4C9B4",
                whiteSpace:"pre-wrap", fontFamily:"'Georgia',serif"}}>
                {review}
              </div>
            </div>
          )}

          {!review && !revLoading && (
            <div style={{background:C.surf, border:`1px solid ${C.border}`,
              borderRadius:12, padding:32, textAlign:"center", color:C.textMuted}}>
              <div style={{fontSize:36, marginBottom:12}}>📋</div>
              <div style={{fontSize:12, lineHeight:1.8}}>
                點擊上方按鈕生成本週分析<br/>
                <span style={{fontSize:10}}>結果自動儲存，下次開啟直接查閱</span>
              </div>
            </div>
          )}
        </div>
      )}

      <div style={{borderTop:`1px solid ${C.border}`, padding:"12px 18px",
        display:"flex", justifyContent:"space-between", fontSize:9, color:C.textMuted, marginTop:20}}>
        <span>Boss Tung · Intelligence Decision Journal · {getWeekKey(0)}</span>
        <span style={{color:C.goldDim}}>↺ Sat 09:00 Weekly Review</span>
      </div>

      <style>{`
        @keyframes bounce{0%,100%{transform:translateY(0);opacity:.4}50%{transform:translateY(-6px);opacity:1}}
        textarea::placeholder{color:#3A3844;font-family:'Georgia',serif;font-size:12px}
        button:hover:not(:disabled){opacity:.8}
        ::-webkit-scrollbar{width:4px;height:4px}
        ::-webkit-scrollbar-track{background:#09090C}
        ::-webkit-scrollbar-thumb{background:#2A2830;border-radius:2px}
      `}</style>
    </div>
  );
}
