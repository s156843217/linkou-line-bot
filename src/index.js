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

// 處理單一事件：只回覆文字訊息
async function handleEvent(event, env) {
  if (event.type !== "message" || event.message.type !== "text") return;
  try {
    const { reply: text } = SchoolLogic.lookupText(event.message.text);
    const res = await reply(env.CHANNEL_ACCESS_TOKEN, event.replyToken, text);
    if (res.status !== 200) console.log("回覆 API 狀態 =", res.status, await res.text());
  } catch (e) {
    console.log("處理事件出錯 =", e && e.stack || String(e));
    await reply(env.CHANNEL_ACCESS_TOKEN, event.replyToken, "查詢時發生問題，請稍後再試，或改用網頁版：https://s156843217.github.io/linkou-toolbox/school/");
  }
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

// 呼叫 LINE 回覆 API（網域是 api.line.me）
async function reply(token, replyToken, text) {
  return await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    },
    body: JSON.stringify({ replyToken, messages: [{ type: "text", text }] }),
  });
}
