# CLAUDE.md — linkou-line-bot（LINE 官方帳號學區 bot・使用中）

> 客戶在 LINE 打地址/社區名/里鄰 → 秒回學區資訊。跑在 **Cloudflare Workers**。
> **push `main` → Cloudflare Workers Builds 自動在雲端 `wrangler deploy`**（本機無 Node，不能本機 deploy、不能本機跑測試）。
> 通用守則見 `~/.claude/CLAUDE.md`；SOP 見 `C:\repo\linkou-toolbox\docs\`。

## 架構

- `src/index.js`：Worker 本體——LINE webhook 驗簽（`x-line-signature`，HMAC-SHA256）→ 呼叫 `SchoolLogic.lookupText(文字)` → 查到學區回 **Flex 圖卡**（`buildFlexCard`，配色沿用網站 style.css 設計系統），查無/提示維持純文字。
- `school-logic.js`：學區純邏輯（UMD 式：瀏覽器掛 `window.SchoolLogic`、Worker 用 require），**不碰畫面**，函式內資料一律走 `D.xxx`。
- `linkou-data.js`：主專案那份的**複本（手動同步）**。學區資料更新流程見 `linkou-toolbox/docs/DATA-UPDATE.md` 第 2 節第 5 步：複製整份過來 → push → 手機實測。
- Worker 名稱 `mute-limit-6246linkou-line-bot` 寫死在 `wrangler.toml`——**不要改名**，改了網址、webhook、密鑰綁定全斷。
- 密鑰 `CHANNEL_SECRET`／`CHANNEL_ACCESS_TOKEN` 是 Worker 的 Secret 環境變數，**不在 repo 裡**（也永遠不准放進來）。

## 踩過的雷

- LINE 回覆 API 網域是 **`api.line.me`**，不是 `api.line.biz`（打錯會回 Cloudflare 530/1016）。
- 驗證方式＝push 後看 Cloudflare build log ＋ 拿手機對官方帳號實測（打「世紀長虹」應回南勢里19鄰＋學區）。沒有本機測試這回事。

## 已拍板（勿重問，詳 `docs/DECISIONS.md`）

- ~~Flex 圖卡延後~~ → **2026-07-05 已完成**：正式帳號（使用者＋太太共用）上線、Worker 密鑰已換綁新帳號、學區回覆已升級 Flex 圖卡。
- bot 是離線查（門牌索引＋社區表），不接 Nominatim；查不到就回提示＋網頁版連結。
