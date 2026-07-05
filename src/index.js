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

// 處理單一事件：查到學區→回 Flex 圖卡；查不到／提示→維持純文字
async function handleEvent(event, env) {
  if (event.type !== "message" || event.message.type !== "text") return;
  try {
    const r = SchoolLogic.lookupText(event.message.text);
    const messages = r.card ? [buildFlexCard(r.card)] : [{ type: "text", text: r.reply }];
    const res = await reply(env.CHANNEL_ACCESS_TOKEN, event.replyToken, messages);
    if (res.status !== 200) console.log("回覆 API 狀態 =", res.status, await res.text());
  } catch (e) {
    console.log("處理事件出錯 =", e && e.stack || String(e));
    await reply(env.CHANNEL_ACCESS_TOKEN, event.replyToken, [{ type: "text", text: "查詢時發生問題，請稍後再試，或改用網頁版：https://s156843217.github.io/linkou-toolbox/school/" }]);
  }
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
            action: { type: "uri", label: "網頁版查詢（含地圖）", uri: "https://s156843217.github.io/linkou-toolbox/school/" },
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
