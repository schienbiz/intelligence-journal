import { useState, useEffect, useRef } from "react";
import { SAMPLE } from "./data/samples.js";

const ROUTES = ["R1_FNB", "R2_DUBAI", "R3_SANGHUANG"];
const RM = {
  R1_FNB:       { icon:"🍜", label:"F&B + AI 情報", full:"每日 F&B + AI 市場情報摘要", color:"#E8A838", freq:"daily",  hint:"貼上 Routine 1 輸出：F&B市場動態、AI工具更新、Superhuman/1440頭條摘要" },
  R2_DUBAI:     { icon:"🏛️", label:"Dubai 法規",   full:"Dubai 商業法規變動監控",     color:"#60A5FA", freq:"weekly", hint:"貼上 Routine 2 輸出：UAE法規動態、IFZA更新、Golden Visa、稅務變更" },
  R3_SANGHUANG: { icon:"🍄", label:"桑黃市場",     full:"桑黃產品市場輿情追蹤",       color:"#6EE7B7", freq:"daily",  hint:"貼上 Routine 3 輸出：桑黃研究動態、競品分析、消費者聲量、定價觀察" },
};
const DAYS_ZH = ["週一","週二","週三","週四","週五","週六","週日"];

const C = {
  bg:"#09090C", surf:"#0F0F12", surf2:"#141418",
  border:"#1E1E24", borderHi:"#2E2E38",
  gold:"#E8A838", goldDim:"#8A6020", goldBg:"#1C1A0A",
  blue:"#60A5FA", green:"#6EE7B7",
  text:"#E0D8CC", textDim:"#7A7880", textMuted:"#3E3C44",
  danger:"#F87171",
};

// ── Utility ───────────────────────────────────────────────────────────────────
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
const EMPTY_WEEK = () => Array.from({length:7}, (_, i) => ({dayIndex:i, entries:{R1_FNB:"",R2_DUBAI:"",R3_SANGHUANG:""}}));

function sSet(k, v) { try { localStorage.setItem(k, v); return true; } catch(e) { return false; } }
function sGet(k)    { try { return localStorage.getItem(k); } catch(e) { return null; } }

// ── Markdown renderer ─────────────────────────────────────────────────────────
function renderInline(text) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**") && p.length > 4)
      return <strong key={i} style={{color:C.gold}}>{p.slice(2,-2)}</strong>;
    return p;
  });
}

function MarkdownOutput({ text, streaming }) {
  if (!text) return null;
  const lines = text.split("\n");
  return (
    <div style={{fontSize:13, lineHeight:2, color:"#D4C9B4", fontFamily:"'Georgia',serif"}}>
      {lines.map((line, i) => {
        const isLast = i === lines.length - 1;
        const cursor = isLast && streaming
          ? <span style={{opacity:.6, animation:"blink .7s step-end infinite"}}>▌</span>
          : null;

        if (line.startsWith("## "))
          return <div key={i} style={{fontSize:14,fontWeight:700,color:C.gold,marginTop:18,marginBottom:4}}>
            {renderInline(line.slice(3))}{cursor}
          </div>;
        if (line.startsWith("# "))
          return <div key={i} style={{fontSize:15,fontWeight:700,color:C.gold,marginTop:20,marginBottom:6}}>
            {renderInline(line.slice(2))}{cursor}
          </div>;
        if (/^[-*] /.test(line))
          return <div key={i} style={{display:"flex",gap:8,marginTop:2,paddingLeft:4}}>
            <span style={{color:C.goldDim,flexShrink:0}}>•</span>
            <span>{renderInline(line.slice(2))}{cursor}</span>
          </div>;
        if (!line.trim())
          return <div key={i} style={{height:10}} />;
        return <div key={i}>{renderInline(line)}{cursor}</div>;
      })}
    </div>
  );
}

// ── Button helper ─────────────────────────────────────────────────────────────
const btn = (primary, extra = {}) => ({
  padding:"9px 20px", borderRadius:8,
  border: primary ? "none" : `1px solid ${C.border}`,
  background: primary ? C.gold : C.surf2,
  color: primary ? "#09090C" : C.textDim,
  cursor:"pointer", fontSize:12, fontWeight: primary ? 700 : 400,
  fontFamily:"inherit", letterSpacing:"0.04em", transition:"all 0.13s",
  ...extra,
});

// ── App ───────────────────────────────────────────────────────────────────────
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
  const [copyState, setCopyState]   = useState("idle");
  const [clearPending, setClearPending] = useState(false);
  // Oracle state
  const [oQuestion, setOQuestion]   = useState("");
  const [oResult, setOResult]       = useState("");
  const [oLoading, setOLoading]     = useState(false);
  const [oStage, setOStage]         = useState(null);   // scout|analyst|synth|validator
  const [oScout, setOScout]         = useState(null);   // {hexagrams, tarot}
  const [oCopyState, setOCopyState] = useState("idle");
  const timer      = useRef(null);
  const abortRef   = useRef(null);
  const oAbortRef  = useRef(null);
  const wk = getWeekKey(weekOffset);

  // Load from storage — also abort any in-flight review and reset transient state
  useEffect(() => {
    abortRef.current?.abort();
    oAbortRef.current?.abort();
    setRevLoading(false); setOLoading(false);
    setClearPending(false);
    setLoaded(false);
    const jRaw = sGet(`j:${wk}`);
    const rRaw = sGet(`r:${wk}`);
    const oRaw = sGet(`o:${wk}`);
    try { setWeekData(jRaw ? JSON.parse(jRaw) : EMPTY_WEEK()); } catch { setWeekData(EMPTY_WEEK()); }
    setReview(rRaw || "");
    setOResult(oRaw || "");
    setOScout(null); setOStage(null);
    setLoaded(true);
  }, [wk]);

  // Sync textarea when day/route/weekData changes
  useEffect(() => { setText(weekData[day]?.entries?.[route] || ""); }, [day, route, weekData]);

  // Auto-save — D2 fix: no "saving" flicker during debounce; silent until write completes
  useEffect(() => {
    if (!loaded) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const nd = weekData.map((d, i) => i === day ? {...d, entries:{...d.entries,[route]:text}} : d);
      const ok = sSet(`j:${wk}`, JSON.stringify(nd));
      if (ok) {
        setWeekData(nd);
        setSaveState("saved");
        setTimeout(() => setSaveState("idle"), 2000);
      } else {
        setSaveState("error");
      }
    }, 700);
    return () => clearTimeout(timer.current);
  }, [text]);

  const filled    = weekData.reduce((a, d) => a + ROUTES.filter(r => d.entries[r]?.trim()).length, 0);
  const dayFilled = i => ROUTES.filter(r => weekData[i]?.entries?.[r]?.trim()).length;
  const todayIdx  = getTodayIdx();

  const loadSample = () => setText(SAMPLE[route] || "");

  // ── A1: Streaming review ───────────────────────────────────────────────────
  const doReview = async () => {
    const ENTRY_LIMIT = 600;
    const content = weekData.map((d, i) => {
      const f = ROUTES.filter(r => d.entries[r]?.trim());
      if (!f.length) return null;
      return `=== ${DAYS_ZH[i]} ===\n` + f.map(r => {
        const t = d.entries[r];
        return `[${RM[r].full}]\n${t.length > ENTRY_LIMIT ? t.slice(0, ENTRY_LIMIT) + "…" : t}`;
      }).join("\n\n");
    }).filter(Boolean).join("\n\n—\n\n");

    if (!content.trim()) {
      setReview("⚠️ 本週尚無資料。\n\n請先至「📝 每日輸入」頁面填入報告內容。\n如需體驗功能，可點擊「📋 載入範例」按鈕。");
      return;
    }

    setRevLoading(true);
    setReview("");
    setClearPending(false);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const resp = await fetch("/api/review", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ content, weekKey: wk }),
        signal: ctrl.signal,
      });

      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error || "Server error");
      }

      const reader = resp.body.getReader();
      const dec = new TextDecoder();
      let buf = "", full = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop();

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data === "[DONE]") { sSet(`r:${wk}`, full); setRevLoading(false); return; }
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) throw new Error(parsed.error);
            if (parsed.text) { full += parsed.text; setReview(full); }
          } catch(e) { if (e.name !== "SyntaxError") throw e; }
        }
      }
      sSet(`r:${wk}`, full);
    } catch(e) {
      if (e.name !== "AbortError") setReview(`❌ 連線錯誤：${e.message}`);
    }
    setRevLoading(false);
  };

  const stopReview = () => { abortRef.current?.abort(); setRevLoading(false); };

  // ── Oracle: 4-Agent pipeline ────────────────────────────────────────────────
  const doOracle = async () => {
    if (!oQuestion.trim()) return;
    setOLoading(true); setOResult(""); setOStage("scout"); setOScout(null);
    const ctrl = new AbortController();
    oAbortRef.current = ctrl;
    try {
      const resp = await fetch("/api/oracle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: oQuestion }),
        signal: ctrl.signal,
      });
      if (!resp.ok) { const e = await resp.json(); throw new Error(e.error || "Server error"); }
      const reader = resp.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n"); buf = lines.pop();
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          let ev;
          try { ev = JSON.parse(line.slice(6)); } catch { continue; }
          if (ev.error) throw new Error(ev.error);
          if (ev.stage) setOStage(ev.stage);
          if (ev.scout) setOScout(ev.scout);
          if (ev.result) { sSet(`o:${wk}`, ev.result); setOResult(ev.result); }
          if (ev.done) { setOLoading(false); return; }
        }
      }
    } catch(e) {
      if (e.name !== "AbortError") setOResult(`❌ ${e.message}`);
    }
    setOLoading(false);
  };
  const stopOracle = () => { oAbortRef.current?.abort(); setOLoading(false); };

  const copyReview = () => {
    const done = () => { setCopyState("copied"); setTimeout(() => setCopyState("idle"), 2000); };
    if (navigator.clipboard) {
      navigator.clipboard.writeText(review).then(done).catch(() => {
        const el = document.createElement("textarea");
        el.value = review; document.body.appendChild(el); el.select();
        document.execCommand("copy"); document.body.removeChild(el); done();
      });
    } else {
      const el = document.createElement("textarea");
      el.value = review; document.body.appendChild(el); el.select();
      document.execCommand("copy"); document.body.removeChild(el); done();
    }
  };

  const clearReview = () => {
    if (!clearPending) { setClearPending(true); return; }
    setReview(""); sSet(`r:${wk}`, ""); setClearPending(false);
  };

  const TABS = [["log","📝 每日輸入"],["week","📊 週覽"],["review","🎯 週六複盤"],["oracle","🔮 決策 Oracle"]];

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
            {[{v:filled, l:"記錄", c:C.gold},{v:`${Math.round(filled/21*100)}%`, l:"完成率", c:C.blue}].map(({v,l,c}) => (
              <div key={l} style={{textAlign:"center"}}>
                <div style={{fontSize:17, color:c, fontWeight:600}}>{v}</div>
                <div style={{fontSize:8, color:C.textDim, letterSpacing:"0.1em"}}>{l}</div>
              </div>
            ))}
          </div>
        </div>
        <div style={{display:"flex", gap:3}}>
          {TABS.map(([v,l]) => (
            <button key={v} onClick={() => setTab(v)} style={{
              padding:"6px 14px", borderRadius:6, border:"none", cursor:"pointer", fontFamily:"inherit",
              background:tab===v?C.gold:"transparent", color:tab===v?"#09090C":C.textDim,
              fontSize:11, fontWeight:tab===v?700:400, letterSpacing:"0.04em", transition:"all 0.13s",
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

          {/* Day pills — L1: today more prominent */}
          <div style={{marginBottom:14}}>
            <div style={{fontSize:9, color:C.textDim, letterSpacing:"0.18em", marginBottom:7}}>選擇日期</div>
            <div style={{display:"flex", gap:5, flexWrap:"wrap"}}>
              {DAYS_ZH.map((d, i) => {
                const c = dayFilled(i), sel = i===day, today = i===todayIdx && weekOffset===0;
                return (
                  <button key={i} onClick={() => setDay(i)} style={{
                    padding:"7px 11px", borderRadius:8, fontFamily:"inherit",
                    border:`1px solid ${sel ? C.gold : today ? C.gold+"60" : c>0 ? C.borderHi : C.border}`,
                    background: sel ? "#1C1A0A" : today ? "#1C1A0A80" : "transparent",
                    color: sel ? C.gold : today ? C.gold+"CC" : c>0 ? "#C8B070" : C.textMuted,
                    cursor:"pointer", fontSize:12, minWidth:50, textAlign:"center",
                    position:"relative", transition:"all 0.12s",
                    boxShadow: today && !sel ? `0 0 0 1px ${C.gold}30` : "none",
                  }}>
                    <div style={{fontWeight: today ? 600 : 400}}>{d}</div>
                    <div style={{fontSize:8, marginTop:1, color:sel?C.goldDim:c>0?"#6A5820":C.textMuted}}>
                      {c>0 ? `${c}/3✓` : today ? "今天" : "—"}
                    </div>
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
                    cursor:"pointer", fontSize:12, transition:"all 0.12s",
                  }}>
                    <span style={{fontWeight:sel?600:400}}>{m.icon} {m.label}</span>
                    {has && <span style={{fontSize:9, marginLeft:6, color:C.goldDim}}>✓</span>}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Editor */}
          <div style={{background:C.surf, borderRadius:12, border:`1px solid ${RM[route].color}28`, padding:16}}>
            <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10}}>
              <div style={{fontSize:9, color:RM[route].color, letterSpacing:"0.15em", textTransform:"uppercase"}}>
                {DAYS_ZH[day]} · {RM[route].full}
              </div>
              <div style={{display:"flex", gap:8, alignItems:"center"}}>
                {/* L2: clear entry button */}
                {text && (
                  <button onClick={() => setText("")}
                    style={btn(false, {padding:"3px 10px", fontSize:10, color:C.danger, borderColor:C.danger+"40"})}>
                    🗑 清除
                  </button>
                )}
                <button onClick={loadSample} style={btn(false, {padding:"3px 10px", fontSize:10})}>📋 載入範例</button>
                <div style={{fontSize:9, color:
                  saveState==="saved" ? "#6EE7B7" : saveState==="error" ? C.danger : C.textMuted}}>
                  {saveState==="saved" ? "✓ 已儲存" : saveState==="error" ? "⚠ 儲存失敗" : ""}
                </div>
              </div>
            </div>
            <textarea value={text} onChange={e => setText(e.target.value)}
              placeholder={`貼上「${RM[route].label}」Routine 的輸出內容…\n\n${RM[route].hint}`}
              style={{
                width:"100%", minHeight:220, background:"transparent",
                border:`1px solid ${C.border}`, borderRadius:8, outline:"none",
                color:"#D4C8B4", fontSize:12, lineHeight:1.85, resize:"vertical",
                fontFamily:"'Georgia',serif", padding:12, boxSizing:"border-box",
              }}/>
            {/* L5: character count with limit guidance */}
            <div style={{display:"flex", justifyContent:"space-between", marginTop:6, fontSize:9}}>
              <span style={{color: text.length > 600 ? C.danger : C.textMuted}}>
                {text.length} 字元{text.length > 600 ? " · 超過 600 建議上限，AI 分析將截短" : " · 建議 600 字以內"}
              </span>
              <span style={{color:C.textMuted}}>自動儲存 · Auto-saved to browser</span>
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

          {/* W3: thicker progress bars (8px) */}
          <div style={{display:"flex", gap:8, marginBottom:18, flexWrap:"wrap"}}>
            {ROUTES.map(r => {
              const m = RM[r];
              const cnt = m.freq==="weekly"
                ? (weekData.some(d => d.entries[r]?.trim()) ? 1 : 0)
                : weekData.filter(d => d.entries[r]?.trim()).length;
              const tot = m.freq==="weekly" ? 1 : 7;
              const pct = Math.round(cnt/tot*100);
              return (
                <div key={r} style={{flex:"1 1 160px", background:C.surf,
                  border:`1px solid ${C.border}`, borderRadius:10, padding:12}}>
                  <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8}}>
                    <div style={{fontSize:10, color:m.color}}>{m.icon} {m.label}</div>
                    {m.freq==="weekly" && <div style={{fontSize:8, color:C.textDim, border:`1px solid ${C.border}`, borderRadius:4, padding:"1px 5px"}}>週報</div>}
                  </div>
                  <div style={{display:"flex", gap:8, alignItems:"center"}}>
                    <div style={{flex:1, height:8, background:C.border, borderRadius:4}}>
                      <div style={{width:`${pct}%`, height:"100%", background:m.color,
                        borderRadius:4, transition:"width 0.4s"}}/>
                    </div>
                    <span style={{fontSize:10, color:C.textDim, minWidth:28}}>{cnt}/{tot}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* W1: Dubai weekly — full-width single cell */}
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
                      const m = RM[r];
                      const t = weekData[i]?.entries?.[r]?.trim();
                      // W1: Dubai weekly — show single indicator only on first entry day
                      if (m.freq==="weekly") {
                        const dubaiFilled = weekData.some(d => d.entries[r]?.trim());
                        const isFirst = i === weekData.findIndex(d => d.entries[r]?.trim());
                        if (dubaiFilled && isFirst) return (
                          <div key={r} style={{marginBottom:5}}>
                            <div style={{fontSize:8, color:m.color}}>● {m.icon} <span style={{color:C.textDim}}>週報</span></div>
                          </div>
                        );
                        if (dubaiFilled) return null;
                        if (i===0) return (
                          <div key={r} style={{marginBottom:5}}>
                            <div style={{fontSize:8, color:C.border}}>— {m.icon} <span style={{color:C.textMuted}}>週報</span></div>
                          </div>
                        );
                        return null;
                      }
                      return (
                        <div key={r} style={{marginBottom:5}}>
                          <div style={{fontSize:8, color:t?m.color:C.border}}>{t?"●":"○"} {m.icon}</div>
                          {t && <div style={{fontSize:8, color:C.textDim, lineHeight:1.4,
                            overflow:"hidden", display:"-webkit-box",
                            WebkitLineClamp:2, WebkitBoxOrient:"vertical"}}>
                            {t.substring(0,55)}
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
              {filled<3 && (
                <div style={{color:C.danger, marginTop:5, fontSize:11}}>
                  ⚠️ 建議至少 3 份報告再分析（目前 {filled} 份）。可至「每日輸入」用「載入範例」填充測試資料。
                </div>
              )}
            </div>
            <div style={{display:"flex", gap:8, flexWrap:"wrap", alignItems:"center"}}>
              {/* A1: streaming — show Stop button during loading */}
              {revLoading ? (
                <button onClick={stopReview} style={btn(false, {color:C.danger, borderColor:C.danger+"60"})}>
                  ⏹ 停止
                </button>
              ) : (
                <button onClick={doReview} style={btn(true)}>
                  🎯 生成本週趨勢信號分析
                </button>
              )}
              {review && !revLoading && (
                <>
                  {/* R3: clear with confirmation */}
                  <button onClick={clearReview}
                    style={btn(false, {fontSize:11, padding:"9px 14px",
                      color: clearPending ? C.danger : C.textDim,
                      borderColor: clearPending ? C.danger+"60" : C.border})}>
                    {clearPending ? "確認清除？" : "🗑 清除"}
                  </button>
                  {clearPending && (
                    <button onClick={() => setClearPending(false)}
                      style={btn(false, {fontSize:11, padding:"9px 14px"})}>取消</button>
                  )}
                  {/* R1: copy with success feedback */}
                  <button onClick={copyReview}
                    style={btn(false, {fontSize:11, padding:"9px 14px",
                      color: copyState==="copied" ? C.green : C.textDim,
                      borderColor: copyState==="copied" ? C.green+"60" : C.border})}>
                    {copyState==="copied" ? "✓ 已複製" : "📋 複製"}
                  </button>
                </>
              )}
            </div>
          </div>

          {/* A1: streaming loading indicator */}
          {revLoading && !review && (
            <div style={{background:C.surf, borderRadius:12, padding:28,
              border:`1px solid ${C.border}`, textAlign:"center"}}>
              <div style={{color:C.goldDim, marginBottom:10, fontSize:13}}>
                🔄 正在交叉分析 {filled} 份報告…
              </div>
              <div style={{color:C.textMuted, fontSize:11, marginBottom:16}}>
                AI 正在找出跨 Routine 的趨勢關聯
              </div>
              <div style={{display:"flex", justifyContent:"center", gap:5}}>
                {[0,1,2].map(i => (
                  <div key={i} style={{width:7,height:7,borderRadius:"50%",background:C.gold,
                    animation:`bounce 1.2s ease-in-out ${i*0.2}s infinite`}}/>
                ))}
              </div>
            </div>
          )}

          {/* A2: markdown rendering; streaming shows cursor */}
          {review && (
            <div style={{background:C.surf, border:`1px solid ${C.border}`, borderRadius:12, padding:22}}>
              <div style={{fontSize:9, color:C.textDim, letterSpacing:"0.15em",
                marginBottom:14, paddingBottom:12, borderBottom:`1px solid ${C.border}`}}>
                {wk} · AI ANALYSIS{!revLoading && " · 已自動儲存"}
              </div>
              <MarkdownOutput text={review} streaming={revLoading} />
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

      {/* ─ ORACLE ─ */}
      {tab==="oracle" && (
        <div style={{padding:"18px", maxWidth:780}}>
          {/* Header card */}
          <div style={{background:"#0A0A14", border:`1px solid #3A2A6A`, borderRadius:12, padding:18, marginBottom:18}}>
            <div style={{fontSize:9, color:"#A080E0", letterSpacing:"0.2em", marginBottom:5}}>決策 ORACLE · 易經 × 塔羅 × 4-Agent AI</div>
            <div style={{fontSize:12, color:"#B8B098", lineHeight:1.8, marginBottom:14}}>
              輸入一個本週最重要的商業決策問題，Oracle 以易經卦象與塔羅牌義交叉共振，生成具體決策指引。
            </div>
            {/* Question input */}
            <textarea
              value={oQuestion}
              onChange={e => setOQuestion(e.target.value)}
              placeholder="例：桑黃下半年是否擴大採購量？Dubai 辦事處時機是否成熟？"
              disabled={oLoading}
              style={{
                width:"100%", minHeight:72, background:"#06060F",
                border:`1px solid ${oLoading ? "#3A2A6A" : "#4A3A8A"}`,
                borderRadius:8, outline:"none", color:"#D4C8B4",
                fontSize:12, lineHeight:1.8, resize:"vertical",
                fontFamily:"'Georgia',serif", padding:10, boxSizing:"border-box",
                opacity: oLoading ? 0.6 : 1,
              }}/>
            <div style={{display:"flex", gap:8, marginTop:10, flexWrap:"wrap", alignItems:"center"}}>
              {oLoading ? (
                <button onClick={stopOracle} style={btn(false, {color:C.danger, borderColor:C.danger+"60"})}>⏹ 停止</button>
              ) : (
                <button onClick={doOracle} disabled={!oQuestion.trim()}
                  style={btn(true, {background:"#7C3AED", opacity:oQuestion.trim()?1:0.4})}>
                  🔮 啟動 Oracle 分析
                </button>
              )}
              {oResult && !oLoading && (
                <button onClick={() => { navigator.clipboard?.writeText(oResult); setOCopyState("copied"); setTimeout(()=>setOCopyState("idle"),2000); }}
                  style={btn(false, {fontSize:11, padding:"9px 14px", color:oCopyState==="copied"?C.green:C.textDim, borderColor:oCopyState==="copied"?C.green+"60":C.border})}>
                  {oCopyState==="copied" ? "✓ 已複製" : "📋 複製"}
                </button>
              )}
              {oResult && !oLoading && (
                <button onClick={() => { setOResult(""); sSet(`o:${wk}`, ""); }}
                  style={btn(false, {fontSize:11, padding:"9px 14px", color:C.danger+"99", borderColor:C.danger+"30"})}>
                  🗑 清除
                </button>
              )}
            </div>
          </div>

          {/* Progress stages */}
          {oLoading && (
            <div style={{background:C.surf, border:`1px solid #3A2A6A`, borderRadius:12, padding:18, marginBottom:18}}>
              <div style={{fontSize:9, color:"#A080E0", letterSpacing:"0.15em", marginBottom:14}}>4-AGENT PIPELINE RUNNING</div>
              {[
                {key:"scout",    label:"Scout",    desc:"易卦 × 塔羅選卡",     provider:"Groq llama-4-scout"},
                {key:"analyst",  label:"Analyst",  desc:"深度語義解讀",         provider:"Cerebras gpt-oss-120b"},
                {key:"synth",    label:"Synth",    desc:"跨系統商業洞察",       provider:"NVIDIA llama-3.3-70b"},
                {key:"validator",label:"Validator","desc":"驗證與最終輸出",     provider:"Mistral large"},
              ].map(({key,label,desc,provider}) => {
                const stages = ["scout","analyst","synth","validator"];
                const cur = stages.indexOf(oStage);
                const idx = stages.indexOf(key);
                const done = idx < cur;
                const active = idx === cur;
                return (
                  <div key={key} style={{display:"flex", alignItems:"center", gap:12, marginBottom:10}}>
                    <div style={{
                      width:22, height:22, borderRadius:"50%", flexShrink:0,
                      display:"flex", alignItems:"center", justifyContent:"center",
                      fontSize:11, fontWeight:700,
                      background: done ? "#3A2A6A" : active ? "#7C3AED" : C.surf2,
                      border: `1px solid ${done ? "#6A4ACA" : active ? "#A080E0" : C.border}`,
                      color: done ? "#A080E0" : active ? "#fff" : C.textMuted,
                    }}>
                      {done ? "✓" : idx+1}
                    </div>
                    <div style={{flex:1}}>
                      <div style={{display:"flex", justifyContent:"space-between"}}>
                        <span style={{fontSize:12, color: active ? "#D4C8B4" : done ? "#8A80A0" : C.textMuted, fontWeight: active ? 600 : 400}}>
                          {label} — {desc}
                        </span>
                        <span style={{fontSize:9, color:C.textMuted}}>{provider}</span>
                      </div>
                      {active && (
                        <div style={{display:"flex", gap:3, marginTop:4}}>
                          {[0,1,2].map(i => (
                            <div key={i} style={{width:5,height:5,borderRadius:"50%",background:"#7C3AED",
                              animation:`bounce 1.2s ease-in-out ${i*0.2}s infinite`}}/>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              {/* Scout preview */}
              {oScout && (
                <div style={{marginTop:12, paddingTop:12, borderTop:`1px solid ${C.border}`, fontSize:10, color:"#8A80A0"}}>
                  {oScout.hexagrams?.map(h=>`${h.zh}卦(${h.en})`).join(' + ')}
                  {oScout.tarot?.length ? ` × ${oScout.tarot.map(t=>t.name).join(' + ')}` : ''}
                </div>
              )}
            </div>
          )}

          {/* Result */}
          {oResult && (
            <div style={{background:C.surf, border:`1px solid #3A2A6A`, borderRadius:12, padding:22}}>
              <div style={{fontSize:9, color:"#8A70C0", letterSpacing:"0.15em",
                marginBottom:14, paddingBottom:12, borderBottom:`1px solid ${C.border}`}}>
                {wk} · ORACLE READING · 已自動儲存
              </div>
              <MarkdownOutput text={oResult} streaming={false} />
            </div>
          )}

          {!oResult && !oLoading && (
            <div style={{background:C.surf, border:`1px solid ${C.border}`,
              borderRadius:12, padding:32, textAlign:"center", color:C.textMuted}}>
              <div style={{fontSize:36, marginBottom:12}}>🔮</div>
              <div style={{fontSize:12, lineHeight:1.8}}>
                輸入決策問題，啟動易經 × 塔羅跨系統分析<br/>
                <span style={{fontSize:10}}>分析需 20-40 秒，結果自動儲存</span>
              </div>
            </div>
          )}
        </div>
      )}

      <div style={{borderTop:`1px solid ${C.border}`, padding:"12px 18px",
        display:"flex", justifyContent:"space-between", fontSize:9, color:C.textMuted, marginTop:20}}>
        <span>Boss Tung · Intelligence Decision Journal · {wk}</span>
        <span style={{color:C.goldDim}}>↺ Sat 09:00 Weekly Review</span>
      </div>

      <style>{`
        @keyframes bounce{0%,100%{transform:translateY(0);opacity:.4}50%{transform:translateY(-6px);opacity:1}}
        @keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
        textarea::placeholder{color:#3A3844;font-family:'Georgia',serif;font-size:12px}
        button:hover:not(:disabled){opacity:.8}
        ::-webkit-scrollbar{width:4px;height:4px}
        ::-webkit-scrollbar-track{background:#09090C}
        ::-webkit-scrollbar-thumb{background:#2A2830;border-radius:2px}
      `}</style>
    </div>
  );
}
