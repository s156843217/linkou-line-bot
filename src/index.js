// ===== 林口工具箱 LINE bot — Phase 2：接上學區大腦 =====
// 使用者在 LINE 傳「地址 / 社區名 / 里別」→ 查出學區 → 回覆摘要。
// 學區邏輯與資料來自共用模組（與網頁同一份演算法）。

import SchoolLogic from "../school-logic.js";

export default {
  async fetch(request, env) {
    // 非 LINE 的 POST（例如用瀏覽器打開）→ 健康檢查
    if (request.method !== "POST") {
      return new Response("林口工具箱 LINE bot 運作中 ✅", { status: 200 });
    }

    const body = await request.text();
    const signature = request.headers.get("x-line-signature");

    // 驗證簽章，確認請求真的來自你的 LINE 頻道
    if (!(await verifySignature(env.CHANNEL_SECRET, body, signature))) {
      return new Response("簽章驗證失敗", { status: 401 });
    }

    // 逐一處理事件（reply token 有時效，用 Promise.all 並行回覆）
    const events = JSON.parse(body).events || [];
    await Promise.all(events.map((ev) => handleEvent(ev, env)));
    return new Response("OK", { status: 200 });
  },
};

// 圖文選單「聯絡我們」替客戶送出的固定句，與其回覆（不進學區查詢）
const CONTACT_TRIGGER = "我想詢問房屋買賣";
const CONTACT_REPLY =
  "已收到您的詢問 🙋 我們會盡快由真人回覆您。\n\n" +
  "也歡迎直接留言：想看的社區或物件、預算與需求，方便我們先幫您準備資料。\n\n" +
  "太平洋房屋 林口捷運加盟店\n李天夏 0936-123-288\n温美慈 0976-109-326";

// 處理單一事件：查到學區→回 Flex 圖卡；查不到／提示→維持純文字
async function handleEvent(event, env) {
  if (event.type === "postback") return handlePostback(event, env);   // 圖卡按鈕（查行情）
  if (event.type !== "message" || event.message.type !== "text") return;
  try {
    const text = event.message.text.trim();
    if (text === CONTACT_TRIGGER) {
      const resC = await reply(env.CHANNEL_ACCESS_TOKEN, event.replyToken, [{ type: "text", text: CONTACT_REPLY }]);
      if (resC.status !== 200) console.log("回覆 API 狀態 =", resC.status, await resC.text());
      return;
    }
    const r = SchoolLogic.lookupText(text);
    const messages = r.card ? [buildFlexCard(r.card)] : [{ type: "text", text: r.reply }];
    const res = await reply(env.CHANNEL_ACCESS_TOKEN, event.replyToken, messages);
    if (res.status !== 200) console.log("回覆 API 狀態 =", res.status, await res.text());
  } catch (e) {
    console.log("處理事件出錯 =", e && e.stack || String(e));
    await reply(env.CHANNEL_ACCESS_TOKEN, event.replyToken, [{ type: "text", text: "查詢時發生問題，請稍後再試，或改用網頁版：https://swcasa.com/school/" }]);
  }
}

// ===== 查行情（學區卡的 postback 按鈕）=====
// 摘要數字來自整合站每月自動產出的 price-summary.json（口徑與 price/ 網頁一致）；
// 走 postback + reply，不吃訊息額度。抓不到摘要時仍回「連結卡」，網頁有完整明細與鄰近參考。
const SUMMARY_URL = "https://swcasa.com/price-summary.json";

// 與 school-logic / 網頁同一套社區名正規化（那邊沒對外輸出，這裡放一份小複本）
function normComm(s) {
  return (s || "").replace(/管理委員會|管委會|社區|大廈|大樓|公寓|住戶|集合住宅|管理負責人/g, "").toLowerCase().trim();
}

// 在摘要檔裡找這個社區/建案：先精確、再正規化互含（社區表優先於預售建案表）
function findSummary(sum, name) {
  if (sum.comm && sum.comm[name]) return sum.comm[name];
  if (sum.pre && sum.pre[name]) return sum.pre[name];
  const nn = normComm(name);
  if (nn.length < 2) return null;
  for (const dict of [sum.comm || {}, sum.pre || {}]) {
    for (const k in dict) {
      const nk = normComm(k);
      if (nk && (nk === nn || nk.includes(nn) || nn.includes(nk))) return dict[k];
    }
  }
  return null;
}

async function handlePostback(event, env) {
  try {
    const data = (event.postback && event.postback.data) || "";
    if (!data.startsWith("price|")) return;
    const name = data.slice("price|".length).trim();
    let s = null;
    try {
      const res = await fetch(SUMMARY_URL, { cf: { cacheTtl: 3600, cacheEverything: true } });
      if (res.ok) s = findSummary(await res.json(), name);
    } catch (e) {
      console.log("抓行情摘要失敗 =", String(e));       // 摘要抓不到照樣回連結卡，不中斷
    }
    const res2 = await reply(env.CHANNEL_ACCESS_TOKEN, event.replyToken, [buildPriceFlexCard(name, s)]);
    if (res2.status !== 200) console.log("行情回覆 API 狀態 =", res2.status, await res2.text());
  } catch (e) {
    console.log("postback 出錯 =", e && e.stack || String(e));
    await reply(env.CHANNEL_ACCESS_TOKEN, event.replyToken, [{ type: "text", text: "查行情時出了點問題，請直接開網頁版：https://swcasa.com/price/" }]);
  }
}

// 民國 yyymmdd → "115/05/04"
function rocDate(d) {
  const s = String(d);
  return s.length >= 7 ? `${s.slice(0, 3)}/${s.slice(3, 5)}/${s.slice(5, 7)}` : s;
}

// 行情摘要 → Flex 圖卡（配色沿用設計系統，行情卡用墨綠與學區卡的陶土橘區隔）
function buildPriceFlexCard(name, s) {
  const url = "https://swcasa.com/price/?c=" + encodeURIComponent(name);
  const body = [{ type: "text", text: name, weight: "bold", size: "lg", color: COLOR.ink, wrap: true }];
  let alt;
  if (s) {
    alt = `【林口行情】${name}｜近${s.yrs}年 ${s.n} 筆` + (s.u ? `｜單價中位 ${s.u} 萬/坪` : "");
    body.push({ type: "text", text: `近 ${s.yrs} 年共 ${s.n} 筆成交`, size: "sm", weight: "bold", color: COLOR.teal, margin: "xs" });
    body.push({ type: "separator", margin: "md", color: COLOR.line });
    const rows = [];
    if (s.u) rows.push(["單價中位數", `${s.u} 萬/坪`]);
    if (s.t) rows.push(["總價中位數", `${s.t.toLocaleString("zh-TW")} 萬`]);
    rows.push(["最近一筆", rocDate(s.last)]);
    body.push({
      type: "box", layout: "vertical", spacing: "sm", margin: "md",
      contents: rows.map(([k, v]) => ({
        type: "box", layout: "horizontal", spacing: "md",
        contents: [
          { type: "text", text: k, size: "sm", color: COLOR.inkSoft, flex: 4 },
          { type: "text", text: v, size: "sm", weight: "bold", color: COLOR.ink, flex: 6 },
        ],
      })),
    });
    if (s.n < 5) body.push({ type: "text", text: "⚠ 成交樣本較少，數字僅供方向參考", size: "xs", color: COLOR.clayD, wrap: true, margin: "md" });
  } else {
    alt = `【林口行情】${name}｜點開看逐筆明細與鄰近成交`;
    body.push({ type: "text", text: "近三年查無此名稱的直接成交彙整，點下方按鈕看逐筆明細與 150 公尺鄰近成交參考。", size: "sm", color: COLOR.inkSoft, wrap: true, margin: "md" });
  }
  body.push({
    type: "text", margin: "lg", size: "xxs", color: COLOR.inkSoft, wrap: true,
    text: "資料來源：內政部實價登錄（每月自動更新）。僅供參考，正式資訊以實價登錄網站為準。",
  });

  return {
    type: "flex",
    altText: alt.slice(0, 380),
    contents: {
      type: "bubble",
      header: {
        type: "box", layout: "vertical", backgroundColor: COLOR.teal, paddingAll: "16px",
        contents: [
          { type: "text", text: "林口社區行情", color: "#FFFFFF", weight: "bold", size: "md" },
          { type: "text", text: "太平洋房屋 · 林口捷運加盟店", color: "#DFEDE6", size: "xs", margin: "xs" },
        ],
      },
      body: { type: "box", layout: "vertical", backgroundColor: COLOR.bg, paddingAll: "16px", contents: body },
      footer: {
        type: "box", layout: "vertical", spacing: "sm", backgroundColor: COLOR.bg,
        paddingAll: "16px", paddingTop: "0px",
        contents: [
          {
            type: "button", style: "primary", height: "sm", color: COLOR.teal,
            action: { type: "uri", label: "看逐筆明細＋鄰近成交", uri: url },
          },
          { type: "text", size: "xs", color: COLOR.inkSoft, wrap: true, margin: "sm", text: "李天夏 0936-123-288\n温美慈 0976-109-326" },
        ],
      },
    },
  };
}

// ===== 學區結果 → Flex 圖卡 =====
// 配色沿用網站設計系統（style.css :root）：陶土橘 / 墨綠 / 米色
const COLOR = { clay: "#BD5E39", clayD: "#9C4A2B", teal: "#3C7A62", bg: "#FBF6EE", ink: "#26221C", inkSoft: "#5C544A", line: "#E8DFD2" };

// 一類學校（國小或國中）的列：同里分鄰時每條規則一列，額滿學校加提醒
function schoolRows(label, items) {
  const rows = [];
  for (const it of items) {
    rows.push({
      type: "box", layout: "horizontal", spacing: "md",
      contents: [
        { type: "text", text: label + (it.seg ? `(${it.seg})` : ""), size: "sm", color: COLOR.inkSoft, flex: 3 },
        { type: "text", text: it.name, size: "sm", weight: "bold", color: COLOR.ink, wrap: true, flex: 7 },
      ],
    });
    if (it.full) rows.push({ type: "text", text: "⚠ 額滿學校，須提早設籍", size: "xs", color: COLOR.clayD, margin: "xs" });
  }
  return rows;
}

function buildFlexCard(card) {
  const linTxt = card.lin ? `${card.lin}鄰` : "";
  // altText＝通知列與不支援 Flex 的裝置看到的摘要（上限 400 字）
  const alt = (`【林口學區】${card.li}${linTxt}｜` +
    card.es.map((e) => `國小:${e.name}`).join("、") + "｜" +
    card.jh.map((j) => `國中:${j.name}`).join("、")).slice(0, 380);

  const body = [
    { type: "text", text: card.title, weight: "bold", size: "lg", color: COLOR.ink, wrap: true },
    { type: "text", text: `${card.li} ${linTxt}`.trim(), size: "sm", weight: "bold", color: COLOR.teal, margin: "xs" },
  ];
  if (card.warn) body.push({ type: "text", text: "⚠️ " + card.warn, size: "xs", color: COLOR.clayD, wrap: true, margin: "md" });
  body.push({ type: "separator", margin: "md", color: COLOR.line });
  body.push({ type: "box", layout: "vertical", spacing: "sm", margin: "md", contents: [...schoolRows("國小", card.es), ...schoolRows("國中", card.jh)] });
  // 學區免責提醒：紅線文字，逐字保留、不得刪改
  body.push({
    type: "text", margin: "lg", size: "xxs", color: COLOR.inkSoft, wrap: true,
    text: "※額滿學校須父母與學童共同設籍＋居住事實，超額依設籍先後排序，越早設籍越好。實際以學校當年度公告為準。",
  });

  return {
    type: "flex",
    altText: alt,
    contents: {
      type: "bubble",
      header: {
        type: "box", layout: "vertical", backgroundColor: COLOR.clay, paddingAll: "16px",
        contents: [
          { type: "text", text: "林口學區快查", color: "#FFFFFF", weight: "bold", size: "md" },
          { type: "text", text: "太平洋房屋 · 林口捷運加盟店", color: "#FBE9DF", size: "xs", margin: "xs" },
        ],
      },
      body: { type: "box", layout: "vertical", backgroundColor: COLOR.bg, paddingAll: "16px", contents: body },
      footer: {
        type: "box", layout: "vertical", spacing: "sm", backgroundColor: COLOR.bg,
        paddingAll: "16px", paddingTop: "0px",
        contents: [
          {
            type: "button", style: "primary", height: "sm", color: COLOR.clay,
            action: { type: "uri", label: "學區網頁查詢（含地圖）", uri: "https://swcasa.com/school/" },
          },
          {
            // 查行情：postback（帶社區名/地址）→ 回行情摘要卡，走 reply 不吃訊息額度
            type: "button", style: "primary", height: "sm", color: COLOR.teal,
            action: { type: "postback", label: "📈 查看社區行情", data: "price|" + card.title, displayText: `查「${card.title}」的行情` },
          },
          { type: "text", size: "xs", color: COLOR.inkSoft, wrap: true, margin: "sm", text: "李天夏 0936-123-288\n温美慈 0976-109-326" },
        ],
      },
    },
  };
}

// 用 Channel secret 做 HMAC-SHA256，比對 LINE 帶來的簽章
async function verifySignature(secret, body, signature) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  const base64 = btoa(String.fromCharCode(...new Uint8Array(mac)));
  return base64 === signature;
}

// 呼叫 LINE 回覆 API（網域是 api.line.me）；messages＝訊息物件陣列（文字或 Flex）
async function reply(token, replyToken, messages) {
  return await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    },
    body: JSON.stringify({ replyToken, messages }),
  });
}
