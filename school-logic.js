/* ============================================================
   林口學區 — 共用純邏輯
   瀏覽器（classic <script>）與 Node / Cloudflare Worker 皆可用。
   - 所有函式皆為純函式：吃參數、回結構化結果，不碰 DOM / 地圖 / 網路。
   - 資料來源 linkou-data.js：後端用 require 載入；瀏覽器直接用既有全域 const。
   - 與 school/index.html 的演算法保持一致；改邏輯時兩邊一起改（資料則同步整份 linkou-data.js）。
   ============================================================ */
(function () {
  // 取得資料：後端從 linkou-data.js 載入；瀏覽器沿用已宣告的全域 const
  var D;
  if (typeof module !== 'undefined' && module.exports) {
    D = require('./linkou-data.js');                                  // Node / Worker
  } else {
    D = { COMMUNITY, HOUSE, LI, LI_HOUSE_IDX, FULL_ES, ALIASES };     // 瀏覽器：全域 const
  }

  /* ── 地址正規化 / 門牌解析 ──────────────────────────────── */
  const _FWMAP = {'０':'0','１':'1','２':'2','３':'3','４':'4','５':'5','６':'6','７':'7','８':'8','９':'9','－':'-','～':'~','／':'/','　':' '};
  function toHalf(s){ return (s||'').replace(/[０-９－～／　]/g, c=>_FWMAP[c]); }

  // 把地址拆成 路名 / 巷弄 / 號（離線、不靠地理編碼）
  function parseHouse(addr){
    let a = toHalf(addr).trim();
    if (a.indexOf('林口') >= 0) a = a.replace(/^.*林口區/, '');          // 取林口區之後
    a = a.replace(/^\d{3}/, '').replace(/(新北市|臺北市|台北市)/g, '');
    a = a.replace(/[一-鿿]+(村|里)/g, '').replace(/\d+鄰/g, '').trim();  // 去 X村/X里、N鄰
    const mFirst = a.search(/\d/); if (mFirst < 0) return null;          // 沒有數字＝沒門牌號
    const road = a.slice(0, mFirst).replace(/[\s\-,，、]/g, '').trim();
    let rest = a.slice(mFirst), lane = '', alley = '';
    const ml = rest.match(/(\d+)\s*巷/); if (ml) lane = ml[1];
    const ma = rest.match(/(\d+)\s*弄/); if (ma) alley = ma[1];
    let r2 = rest.replace(/\d+\s*巷/, '').replace(/\d+\s*弄/, '').replace(/之/g, '-');
    const mn = r2.match(/(\d+(?:-\d+)?)/); if (!mn) return null;
    if (!road) return null;
    return { road, lk: lane + '-' + alley, num: mn[1], lane, alley };
  }

  // 門牌精準查詢：比對政府門牌索引 HOUSE，命中即回 里 + 鄰（+ 概略座標）
  function houseLookup(addr){
    const p = parseHouse(addr); if (!p) return null;
    const node = D.HOUSE && D.HOUSE[p.road]; if (!node) return null;
    function dec(val){ // "里|鄰;里|鄰*緯偏,經偏" → {codes, lat, lon}
      const [codes, co] = val.split('*');
      let lat = null, lon = null;
      if (co){ const [a, b] = co.split(','); lat = 25.0 + (+a) / 100000; lon = 121.3 + (+b) / 100000; }
      return { codes, lat, lon };
    }
    let codes = null, lat = null, lon = null;
    if (node[p.lk] && node[p.lk][p.num]){                               // 路+巷+弄+號 完全命中
      const d = dec(node[p.lk][p.num]); codes = d.codes; lat = d.lat; lon = d.lon;
    } else if (node[p.lk]){                                             // 同巷弄、找同基底號
      const base = p.num.split('-')[0]; const s = new Set();
      for (const k in node[p.lk]) if (k.split('-')[0] === base){ const d = dec(node[p.lk][k]); d.codes.split(';').forEach(x=>s.add(x)); if (lat == null){ lat = d.lat; lon = d.lon; } }
      if (s.size) codes = [...s].join(';');
    }
    if (!codes){                                                        // 退一步：忽略巷弄，整條路該號若只屬單一里
      const s = new Set(); let rl = null, rn = null;
      for (const lk in node) if (node[lk][p.num]){ const d = dec(node[lk][p.num]); d.codes.split(';').forEach(x=>s.add(x)); if (rl == null){ rl = d.lat; rn = d.lon; } }
      if (s.size === 1){ codes = [...s][0]; lat = rl; lon = rn; }
    }
    if (!codes) return null;
    const cands = codes.split(';').map(c => { const [i, n] = c.split('|'); return { li: D.LI_HOUSE_IDX[+i], lin: +n }; });
    return { parsed: p, cands, lat, lon };
  }

  /* ── 里 + 鄰 → 學區規則 ──────────────────────────────── */
  function inRange(n, rule){
    if (rule.r === 'all') return true;
    if (rule.r === 'else'){ if (n == null) return false; return !(rule.exclude || []).some(([a, b]) => n >= a && n <= b); }
    if (n == null) return false;
    return rule.r.some(([a, b]) => n >= a && n <= b);
  }
  function rangeLabel(rule){
    if (rule.r === 'all') return '全里';
    if (rule.r === 'else') return '其餘鄰';
    return rule.r.map(([a, b]) => a === b ? `${a}` : `${a}-${b}`).join('、') + '鄰';
  }
  function resolve(li, lin){
    const d = D.LI[li]; if (!d) return null;
    function pick(rules){
      if (lin != null && lin !== ''){ const n = parseInt(lin, 10); const hit = rules.find(rl => inRange(n, rl)); return hit ? [hit] : []; }
      return rules.length === 1 ? [rules[0]] : rules;   // 沒填鄰→列全部
    }
    return { es: pick(d.es), jh: pick(d.jh), hasSplit: (d.es.length > 1 || d.jh.length > 1) };
  }

  /* ── 社區搜尋 ──────────────────────────────────────── */
  const COMM_NAMES = Object.keys(D.COMMUNITY);
  function normalizeComm(s){ return (s || '').replace(/管理委員會|管委會|社區|大廈|大樓|公寓|住戶|集合住宅|管理負責人/g, '').toLowerCase().trim(); }
  const COMM_NORM = Object.fromEntries(COMM_NAMES.map(n => [n, normalizeComm(n)]));
  function searchComm(q){
    if (!q) return [];
    const aliasKey = Object.keys(D.ALIASES).find(k => k.includes(q) || q.includes(k));   // 先看俗稱字典
    if (aliasKey && D.COMMUNITY[D.ALIASES[aliasKey]]) return [D.ALIASES[aliasKey]];
    const nq = normalizeComm(q); if (!nq) return [];
    return COMM_NAMES.filter(n => COMM_NORM[n].includes(nq) || n.toLowerCase().includes(q.toLowerCase())).slice(0, 12);
  }

  // 把社區名解析成 里 + 鄰（對齊網頁 pickComm 的離線路徑；不含線上地理編碼）
  function resolveCommunity(q){
    let name = q, c = D.COMMUNITY[q];
    if (!c){
      const matches = searchComm(q);
      if (!matches.length) return null;
      const exact = matches.find(n => n === q);
      if (matches.length > 1 && !exact) return { type: 'list', names: matches.slice(0, 8) };
      name = exact || matches[0]; c = D.COMMUNITY[name];
    }
    if (!c) return null;
    if (c.li){                                                          // 已建檔里：直接用，缺鄰時用門牌表補
      let lin = c.lin || '';
      if (!lin && c.addr){ const hit = houseLookup(c.addr); if (hit && hit.cands.length === 1) lin = hit.cands[0].lin; }
      return { type: 'single', name, li: c.li, lin };
    }
    if (c.addr){                                                        // 跨里/無里：靠門牌精準表
      const hit = houseLookup(c.addr);
      if (hit && hit.cands.length) return { type: 'single', name, li: hit.cands[0].li, lin: hit.cands[0].lin, cands: hit.cands };
    }
    return { type: 'unknown', name };
  }

  // 直接輸入里別（如「南勢里」「南勢里19鄰」）
  function matchLi(q){
    const li = Object.keys(D.LI).find(n => q.includes(n));
    if (!li) return null;
    const m = q.match(/(\d+)\s*鄰/);
    return { li, lin: m ? m[1] : '' };
  }

  /* ── 產生回覆文字（對齊網頁 buildSummary，去掉地圖相關）──── */
  function buildSummaryText(li, lin, res){
    const linTxt = (lin != null && lin !== '') ? `${lin}鄰` : '';
    let t = `🏠 太平洋房屋 · 林口捷運加盟店 ｜ 林口學區快查\n\n【林口學區查詢】${li}${linTxt}\n`;
    const esLines = res.es.map(r => {
      const seg = res.es.length > 1 ? `(${rangeLabel(r)})` : '';
      return r.base ? `國小${seg}：${r.base}${D.FULL_ES.includes(r.base) ? '（額滿學校，須提早設籍）' : ''}` : `國小${seg}：自由學區 ${r.free.join('/')}`;
    });
    const jhLines = res.jh.map(r => {
      const seg = res.jh.length > 1 ? `(${rangeLabel(r)})` : '';
      return r.base ? `國中${seg}：${r.base}` : `國中${seg}：自由學區 ${r.free.join('/')}`;
    });
    t += esLines.join('\n') + '\n' + jhLines.join('\n');
    t += `\n\n※額滿學校須父母與學童共同設籍＋居住事實，超額依設籍先後排序，越早設籍越好。實際以學校當年度公告為準。`;
    t += `\n\n———\n太平洋房屋 林口捷運加盟店\n李天夏 0936-123-288\n温美慈 0976-109-326`;
    t += `\n🔎 線上學區快查（含地圖）：https://s156843217.github.io/linkou-toolbox/school/`;
    return t;
  }

  /* ── 產生圖卡用結構化資料（給 LINE Flex 等畫面自行排版；仍是純函式）── */
  function buildCardData(title, li, lin, res){
    const mk = (rules, many) => rules.map(r => ({
      seg: many ? rangeLabel(r) : '',                                   // 同里分鄰時標示鄰段
      name: r.base || ('自由學區 ' + r.free.join('/')),
      full: !!(r.base && D.FULL_ES.includes(r.base))                    // 額滿學校旗標
    }));
    return {
      title,
      li,
      lin: (lin != null && lin !== '') ? String(lin) : '',
      es: mk(res.es, res.es.length > 1),
      jh: mk(res.jh, res.jh.length > 1)
    };
  }

  /* ── 總機：一段文字 → 回覆內容 ──────────────────────────
     判斷使用者輸入屬於 門牌地址 / 社區名 / 里別，分流查詢後回傳文字。
     回傳 { ok, reply, card }：ok=true 表查到學區（card＝圖卡結構化資料）；
     ok=false 表提示或查無（無 card，沿用純文字）。 */
  function lookupText(text){
    const q = (text || '').trim();
    if (!q) return { ok: false, reply: '請輸入地址或社區名稱，例如「文化三路一段617巷2號」或「世紀長虹」。' };

    // ① 門牌精準索引（離線最準）
    const hit = houseLookup(q);
    if (hit && hit.cands.length){
      const { li, lin } = hit.cands[0];
      const res = resolve(li, lin);
      if (res){
        let reply = buildSummaryText(li, lin, res);
        const card = buildCardData(q, li, lin, res);
        if (hit.cands.length > 1){
          const list = hit.cands.map(c => `${c.li} ${c.lin}鄰`).join('　或　');
          reply = `⚠️ 此門牌位於里界、橫跨多里（${list}），以下先以第一個為準，建議向房仲確認。\n\n` + reply;
          card.warn = `此門牌位於里界、橫跨多里（${list}），先以第一個為準，建議向房仲確認。`;
        }
        return { ok: true, reply, card };
      }
    }

    // ② 社區名（精確優先，再模糊）
    const comm = resolveCommunity(q);
    if (comm){
      if (comm.type === 'single'){
        const res = resolve(comm.li, comm.lin);
        if (res) return { ok: true, reply: buildSummaryText(comm.li, comm.lin, res), card: buildCardData(comm.name, comm.li, comm.lin, res) };
      }
      if (comm.type === 'list') return { ok: false, reply: '找到多個相近社區，請回覆完整名稱：\n' + comm.names.map(n => '・' + n).join('\n') };
      if (comm.type === 'unknown') return { ok: false, reply: `「${comm.name}」目前里別待定位，請改用完整門牌地址查詢，或洽房仲協助。` };
    }

    // ③ 里別直接輸入
    const liHit = matchLi(q);
    if (liHit){
      const res = resolve(liHit.li, liHit.lin);
      if (res) return { ok: true, reply: buildSummaryText(liHit.li, liHit.lin, res), card: buildCardData(q, liHit.li, liHit.lin, res) };
    }

    // ④ 查無
    return { ok: false, reply:
      `查無「${q}」。可以試試：\n` +
      `・完整門牌（例：文化三路一段617巷2號）\n` +
      `・社區名稱（例：世紀長虹）\n` +
      `・里別（例：南勢里 19鄰）\n\n` +
      `🔎 也可用網頁版精準查詢＋地圖：\nhttps://s156843217.github.io/linkou-toolbox/school/` };
  }

  /* ── 對外輸出 ──────────────────────────────────────── */
  const api = { parseHouse, houseLookup, resolve, searchComm, resolveCommunity, matchLi, buildSummaryText, buildCardData, lookupText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;       // Node / Worker
  else (typeof self !== 'undefined' ? self : this).SchoolLogic = api;              // 瀏覽器：掛全域 SchoolLogic
})();
