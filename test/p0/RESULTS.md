# P0 驗證結果（2026-11-23）

環境：Windows 11、herdr 0.8.0-preview（2026-08-04）、Node v22.22.0、SkillPool profile `inanna-slot`。

**做法**：

- 用隔離的具名 session `schedp0`（`herdr --session schedp0 server`）跑全部測試，**沒有重啟、也沒有動到使用者的 default server**。CLI 用 `HERDR_SOCKET_PATH` 指到 `schedp0` 的 socket。
- herdr 測試插件在 `herdr-plugin\`。Claude Code 測試插件在 `claude-plugin\`，用 `--plugin-dir` 載入，沒有安裝。
- 時間軸探針是 `probe.mjs`。原始紀錄在 `out\`。

## 結果

| # | 項目 | 結果 | 說明 |
|---|---|---|---|
| 1 | `[[startup]]` | 過 | server 每次啟動都跑一次（3 次啟動共 3 筆），`herdr plugin log list` 有紀錄（`event: startup`、`exit_code: 0`）。`plugin link` 當下不會跑 |
| 2 | `[[events]]` | 過 | `pane.closed`、`pane.created`、`tab.created`、`pane.agent_status_changed` 連結時都沒有警告，也都有觸發。`HERDR_PLUGIN_EVENT_JSON` 例：`{"event":"pane_agent_status_changed","data":{"pane_id":"w2:p4","workspace_id":"w2","agent_status":"idle","agent":"claude"}}`；`pane_closed` 只有 `pane_id`、`workspace_id` |
| 3 | 插件 pane 開成指定 workspace 的 tab | 過 | `plugin pane open --placement tab --workspace w2 --no-focus` 可用。pane 的 label 是 manifest 的 `title`，**tab 的 label 仍是編號**，要另外 `tab rename` |
| 4 | 插件指令的環境 | 過 | 有 `HERDR_SOCKET_PATH`、`HERDR_BIN_PATH`、`HERDR_PANE_ID`、`HERDR_WORKSPACE_ID`。`HERDR_PLUGIN_STATE_DIR` 是 `%LOCALAPPDATA%\herdr\plugins\<id>`，config 在 `%APPDATA%\herdr\plugins\config\<id>`。action、event 的 cwd 是插件資料夾；插件 pane 的 cwd 是 `\\?\D:\...` |
| 5 | action | 過 | `plugin action invoke ping --plugin <id>` 可用 |
| 6 | **server 重啟後的 pane** | 注意 | layout、pane id、pane label 都保留，**terminal id 全部換新**，原本的程序全部結束。還原出來的 pane 是在原 cwd 的空 PowerShell。插件 pane 還原後**變成一般 pane**：`plugin pane close` 回 `plugin_pane_not_found`，要用 `pane close`。舊的心跳在重啟當下就停了 |
| 7 | **tab 的 `--env` 重啟後不保留** | 注意 | 還原的 pane 裡 `$env:HERDR_SCHEDULER_ID` 是空的 |
| 8 | 插件登記是全域的 | 注意 | 在 `schedp0` 連結，default server 的 `plugins.json` 也出現；但 default server 沒有即時載入：`events.jsonl` 全部 32 筆的 `socket` 都是 `schedp0`，沒有一筆來自 default。要等 default 下次啟動才會載入 |
| 9 | **Claude 就緒時間** | 證實（有條件） | 一般 `claude`：herdr 第 46.4 秒報 idle，SessionStart hook 第 66.9 秒（這次在繼承 `CLAUDE_CODE_*` 的環境下跑，見下方注意事項）。`skillpool inanna-slot`（乾淨環境）：48.1 秒對 66.0 秒。resume：hook 第 7 秒。**herdr 的 idle 比 SessionStart 早約 20 秒**。**沒測到的邊界**：兩次冷啟動的任務都是在 SessionStart 之後 55 秒以上才送出，「hook 一到就立刻送」能不能成功還沒測 |
| 10 | Claude Code 插件 hook | 過 | `hooks.json` 的 SessionStart、Stop 都有執行，沒有被 `cc-plugin-sec-default` 略過；skillpool 啟動的 Claude 也一樣 |
| 11 | hook 拿到的資料 | 過 | SessionStart：`session_id`、`source`、`transcript_path`、`cwd`、`model`（resume 時另有 `session_title`、`seconds_since_last_response`、`context_tokens` 等）。**Stop 有 `last_assistant_message`**（最後一則回覆全文）、`permission_mode`、`prompt_id`，以及 **`background_tasks`**（這一輪結束時還在跑的背景工作） |
| 12 | `--session-id` | 過 | 給的 UUID 就是 hook 回報的 session id（一般 claude、skillpool 都是） |
| 13 | **用 `herdr agent prompt` 送 slash command** | 過 | `/hs-p0:p0-echo hello 世界 & \| % "q"` 被當成指令執行，回覆 `P0-SLASH-OK hello 世界 & \| % "q"`，中文和特殊字元都完整（這次在繼承 `CLAUDE_CODE_*` 的環境下跑；乾淨環境下 `/clear` 也被當成指令，見 #16） |
| 14 | 多行任務 | 過 | 兩行文字一次送出、同一輪處理（回覆「MULTI-OK 2」） |
| 15 | **在同一個 pane resume** | 過 | 重啟後在還原的 pane 先設 `$env:HERDR_SCHEDULER_ID`，再 `skillpool inanna-slot --resume <id>`：SessionStart `source=resume`，session id 不變，問暗號答得出 `P0-RESUME-42` |
| 16 | `/clear` | 過（有條件） | SessionStart `source=clear`，帶新的 session id。但 `agent prompt --wait` 送 `/clear` 會回 `agent_prompt_stalled`（狀態沒變成 working），要改成不帶 `--wait`、等 hook |
| 17 | **resume 找不到 session** | 證實 | 印出「No conversation found with session ID: <id>」後退回 shell，**沒有** SessionStart。中間 herdr 曾短暫報 `claude:idle`，之後變 `unknown` |
| 18 | SkillPool profile 與插件 | 過（原始碼＋實測） | profile 的 `plugins` 是 `{"off": [...], "on": [...]}`，預設載入使用者裝的插件，除非列在 `off`。實測 `inanna-slot` 裡有載入使用者裝的 herdr-commander |

## 測試本身的注意事項（不是 herdr 或 Claude 的問題）

- **測試 server 不能從 Claude session 裡直接啟動**。它會繼承 `CLAUDE_CODE_CHILD_SESSION` 等變數，pane 裡的 Claude 會把自己當成子 session、不存對話紀錄（畫面顯示「Transcript saving is off — inherited CLAUDE_COD…」）。之後的測試都用 `env -u ...` 清掉再啟動。使用者自己開的 herdr 不會有這個問題。
- **Git Bash 會把 `/clear` 這種參數轉成路徑**（`C:/Program Files/Git/clear`）。要設 `MSYS_NO_PATHCONV=1`。正式版用 Node 直接呼叫 herdr，不經過 Git Bash。

## 要改設計的發現

1. **就緒一律看 SessionStart hook**，herdr 的 idle 不算（#9、#17）。但「hook 一到立刻送」沒測過，要另外驗證或加一段安全等待。
2. **server 重啟後 terminal id 全換、pane id 不變**（#6）。「同一個 pane」的判斷要分兩種：
   - terminal id 相同：同一個還活著的程序。
   - pane id 相同、terminal id 不同：herdr 重啟後還原的空 shell，等於「pane 還在、裡面沒有 Claude」，可以在原地 resume。
3. **在還原的 pane 裡 resume 要自己補環境變數**（#7），例如 PowerShell 的 `$env:HERDR_SCHEDULER_ID='<id>'; <啟動指令>`。這樣會跟 pane 的 shell 綁在一起。另一個做法是關掉還原的 pane，用 `tab create --env` 開新的。
4. **startup 要接手還原的排程器 pane**（#6）：用 label 或記錄的 pane id 找到它，用 `pane close` 關掉，再 `plugin pane open` 開新的。
5. **`/clear` 不要用 `--wait`**（#16），送出後等 `source=clear` 的 SessionStart。
6. **resume 失敗的判斷**：逾時內沒有 SessionStart，加上畫面出現「No conversation found」（#17）。
7. **結果直接用 Stop hook 的 `last_assistant_message`**（#11），不必讀 pane 畫面。
8. **插件 pane 開的 tab 名稱要另外 `tab rename`**（#3）。
9. **Stop 不一定代表做完**（#11）：Stop 有 `background_tasks`，這一輪結束時如果還有背景工作（例如派出去的子代理），不能算完成。

## 清理

- `schedp0` session 已停止並刪除（`herdr session delete schedp0`）。
- 測試插件已 `unlink`。`plugins.json` 是 `[]`，`herdr plugin list` 顯示沒有插件。
- herdr 為測試插件建的空資料夾 `%LOCALAPPDATA%\herdr\plugins\herdr-scheduler.p0`、`%APPDATA%\herdr\plugins\config\herdr-scheduler.p0` 已刪。
- 測試用 Claude 對話紀錄 `~/.claude/projects/D--Tool-HerdrScheduler-test-p0` 已刪。
- 被 `session stop` 直接結束的 skillpool 啟動器沒跑到自己的清理，留下 `~/.claude/skillpool/sessions/l-4324`（指向 inanna-slot profile 的 junction）和 `~/.claude/skillpool/run/inanna-slot-4324-settings.json`（只有 `skillOverrides`、`autoMemoryEnabled`，沒有密鑰）。確認 pid 4324 已不存在後兩個都刪了，只刪 junction 本身，profile 沒動。使用者自己的 `l-36976`、`l-4668`（程序還活著）沒有動。
- default server、`config.toml`、`~/.claude/settings.json` 都沒有改動。
