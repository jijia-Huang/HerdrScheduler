# 整合測試結果（M3、M4，2026-11-23）

環境：隔離的 herdr session `schedp1`（啟動前清掉 `CLAUDE_CODE_*`、`HERDR_*`）、herdr 插件以測試 id `herdr-scheduler.test` 連結（`hsched install --id herdr-scheduler.test --home test\p1\home --plugin-out test\p1\herdr-plugin`），資料放 `test\p1\home\`。Claude Code 插件用 `--plugin-dir` 載入（排程的 `args`）。所有觸發都用 `hsched run-now`，由排程器 pane 每分鐘的 tick 執行。紀錄：`home\runs.jsonl`、`home\logs\tick.log`、`home\results\`。

| # | 項目 | 結果 | 說明 |
|---|---|---|---|
| 1 | `open` action 開排程器 | 過 | 建「排程」workspace，tab 名稱「排程器」，心跳每 30 秒更新，畫面列出排程與最近的執行 |
| 2 | 第一次觸發：開新 pane | 過 | `path=new`。tab 名稱是排程 id（待驗證 #4）。觸發 → 啟動 → SessionStart → 55 秒後送出 → 完成，共約 4 分鐘；結果「FIRST」存進結果檔 |
| 3 | 第二次觸發：沿用 pane | 過 | `path=reuse_pane`，同一個 session，答出上一輪記住的暗號 `P1-MEM-77` |
| 4 | `reuse=clear` | 過 | 先送 `/clear`，等到 `source=clear` 的 SessionStart、session id 換新，再送任務 |
| 5 | 中文路徑、中文與特殊字元任務 | 過 | `cwd` 是 `test\p1\中文 路徑`（含空格），任務「只回一行：P1-CLEAR-OK 中文 & \| % "q"」，結果一字不差（待驗證 #3） |
| 6 | 看門狗 | 過 | 手動 `pane close` 排程器 pane，`pane.closed` 事件在 1 秒內重開，只開一個 |
| 7 | server 重啟 | 過 | `[[startup]]` 關掉還原的舊排程器 pane、開新的。之後觸發 p1-mem：關掉還原的空 shell，開新 tab 用 `--resume` 接回（`path=resume_new_pane`），session id 不變，答得出暗號 |
| 8 | `skillpool inanna-slot` 啟動 | 過 | 新開、沿用都正常。`pane process-info` 的前景程序是 `claude.exe`，判斷「pane 裡有沒有 Claude」可行 |
| 9 | Claude 已 `/exit` 只剩 shell | 過 | 在同一個 pane 用 `skillpool inanna-slot --resume <id>` 接回（`path=resume_in_pane`） |
| 10 | 新 tab 等提示字元 | 改進 | 第一版要等下一次 tick 才啟動；改成開 tab 後用 `pane wait-output` 等最多 15 秒，同一次 tick 就啟動 |

單元測試（`npm test`，26 個）另外涵蓋：resume 找不到對話改開新的、執行中 pane 被關掉（`lost`）、上一次還沒結束時再觸發（通知、排隊、`abandoned`）、有背景工作時不算完成、`on_busy=skip`、確認框只通知一次、錯過觸發（`on_missed`）、改 `cwd` 讓綁定失效、沒事時 tick 不呼叫 herdr、MCP 工具。

測試指令踩到的坑（不是工具的問題）：Git Bash 會把 `/exit` 轉成路徑，要設 `MSYS_NO_PATHCONV=1`；正式版從 Node 直接呼叫 herdr，不受影響。
