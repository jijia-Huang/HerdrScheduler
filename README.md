# HerdrScheduler

在 herdr 裡定時派「工單」給 Claude Code。每個排程是一張固定的工單：在哪個資料夾、用什麼指令啟動 Claude、要交代什麼任務。到點時自動把任務送進對應的 pane；pane 不在就開一個新的。設計細節見 `設計文件.md`。

## 怎麼用

**直接跟 Claude 說就好。** 裝好之後，每個**新開的** Claude Code session 都有 `herdr-scheduler` 的 MCP 工具（安裝前就開著的 session 要重開才有），例如：

- 「每週一早上 9 點，在 D:\TMD\Inanna 用 skillpool inanna-slot 跑 `/inanna-irpc:slot-weekly 我是儒儒，照上週那樣跑`」
- 「列出排程」「把週測改成 8 點半」「先暫停週測」「週測現在跑一次」
- 「看一下週測上一次的結果」「排程器有沒有在跑？」

Claude 會直接新增、修改，並告訴你下次觸發時間和實際的啟動指令。

排程到點時：

1. 排程器（「排程」workspace 裡的「排程器」tab）每分鐘檢查一次。
2. 到期的排程會交給它自己的 tab（tab 名稱就是排程 id）。pane 還在就直接送；不在就開新 tab，用 `--resume` 接回上次的對話；連對話都沒有就開新對話。
3. Claude 這一輪做完（包含它派出去的背景工作），herdr 會跳通知，結果存在 `results\<排程 id>\<run id>.md`，也可以請 Claude 讀給你。

你隨時可以切到工單 tab 看它在做什麼、回答它的問題、接手。

**立刻執行**：在「排程器」tab 用 ↑↓ 選排程、按 `r`；或跟 Claude 說「XX 現在跑一次」；或 `hsched run-now <id>`。都會馬上開 pane，Claude 啟動約一分鐘後送出任務。

## 手動指令（hsched）

```
hsched list                     列出排程
hsched show <id>                一個排程的完整內容與最近的執行
hsched add <id> --when "0 9 * * 1" --cwd D:\path --command "skillpool inanna-slot" --task-file task.txt
hsched edit <id> --when "30 8 * * 1-5"
hsched pause <id> / resume <id> / remove <id>
hsched run-now <id>             立刻執行一次（不影響固定時間）
hsched log [<id>]               執行紀錄
hsched result --last <id>       最近一次的結果
hsched doctor                   檢查安裝與排程器狀態
```

每個指令都可以加 `--json`。

## 排程欄位

| 欄位 | 預設 | 說明 |
|---|---|---|
| `id` | | 小寫英數字和 `-`，也是 tab 名稱 |
| `when` | | 5 欄 cron，本機時間。`0 9 * * 1` 每週一 9:00；`*/30 * * * *` 每 30 分鐘 |
| `cwd` | | 啟動路徑 |
| `command` | `["claude"]` | 啟動指令，例如 `["skillpool", "inanna-slot"]` |
| `args` | `[]` | 每次啟動都加的參數 |
| `task` | | 每次送給 agent 的文字，可以是 slash command、可以多行 |
| `reuse` | `continue` | `continue` 接著同一段對話；`clear` 同一個 pane 但先 `/clear`；`fresh` 每次開新的 |
| `on_busy` | `queue` | agent 還在忙：`queue` 等它閒下來；`skip` 這次跳過 |
| `on_missed` | `run_once` | herdr 沒開而錯過：`run_once` 起來後補跑一次；`skip` 不補 |
| `enabled` | `true` | `false` 暫停 |

## 執行狀態

| 狀態 | 意思 |
|---|---|
| `completed` | 做完了（Stop hook 回報，而且沒有還在跑的背景工作） |
| `skipped` | agent 在忙、`on_busy=skip` |
| `missed` | herdr 沒在跑而錯過、`on_missed=skip` |
| `blocked` | Claude 停在信任資料夾的畫面，要你去選 |
| `failed` | 啟動失敗（例如 3 分鐘內沒就緒、路徑不存在） |
| `lost` | 執行中的 pane 被關掉、Claude 結束、或 herdr 重啟 |
| `abandoned` | 送出後一直沒收到結束回報（例如你按了 Esc），下一次觸發時收掉 |

Claude 停在權限確認框時會發通知，但不會自動按任何東西。

**通知**：先用 herdr 的通知；herdr 的通知是關的（預設 `[ui.toast] delivery = "off"`）時，自動改用 Windows 通知。想改成 herdr 內的提示，在 `%APPDATA%\herdr\config.toml` 加 `[ui.toast]` `delivery = "herdr"` 再 `herdr server reload-config`（這也會打開其他 agent 的通知）。

**只在一個 herdr server 跑**：排程器只在安裝時的 herdr server（預設 session）裡跑。你另外開的 named session 不會再開一個排程器。

## 安裝

需要：Windows、herdr 0.8.0 以上、Node.js 20 以上、Claude Code。

1. **下載**到一個固定的位置（之後不要搬，插件設定會記住這個路徑）：

   ```
   git clone https://github.com/jijia-Huang/HerdrScheduler.git D:\Tool\HerdrScheduler
   ```

2. **在 herdr 的 pane 裡**執行安裝（要在 herdr 裡面跑，安裝程式會記下這個 herdr server，排程器只在它裡面跑）：

   ```
   cd D:\Tool\HerdrScheduler
   node bin\hsched.mjs install --link --shim
   ```

   這一步會產生 herdr 插件設定並連結插件、在 `%LOCALAPPDATA%\herdr-scheduler\` 建立資料夾，並建立 `%USERPROFILE%\.local\bin\hsched.cmd`（這個資料夾要在 PATH 裡，`hsched` 指令才能用）。

3. **裝 Claude Code 插件**（讓 Claude 可以操作排程，並讓工單 pane 回報狀態）：

   ```
   claude plugin marketplace add D:\Tool\HerdrScheduler\claude-plugin
   claude plugin install herdr-scheduler@herdr-scheduler
   ```

4. **加快捷鍵**（可選）：在 `%APPDATA%\herdr\config.toml` 加上下面這段，再執行 `herdr server reload-config`：

   ```toml
   [[keys.command]]
   key = "prefix+alt+s"
   type = "plugin_action"
   command = "herdr-scheduler.open"
   description = "HerdrScheduler: 打開排程器"
   ```

5. **打開排程器**：按 `ctrl+b`，放開，再按 `alt+s`（或執行 `herdr plugin action invoke open --plugin herdr-scheduler`）。之後每次 herdr server 啟動都會自動打開排程器。

6. **檢查**：`hsched doctor`，每一項都是 OK 就裝好了。已經開著的 Claude session 要重開才有排程工具。

### 更新

```
cd D:\Tool\HerdrScheduler
git pull
claude plugin marketplace update herdr-scheduler
claude plugin update herdr-scheduler@herdr-scheduler
```

然後關掉「排程器」tab（看門狗會用新版本自動重開），開著的 Claude session 也重開。

### 移除

```
herdr plugin unlink herdr-scheduler
claude plugin uninstall herdr-scheduler@herdr-scheduler
```

再刪掉 `%USERPROFILE%\.local\bin\hsched.cmd` 和 `config.toml` 裡的快捷鍵。資料在 `%LOCALAPPDATA%\herdr-scheduler\`，不要了就一起刪。

SkillPool：profile 預設會載入使用者裝的插件。如果某個 profile 的 `plugins.off` 列了 `herdr-scheduler`，用那個 profile 的排程會因為收不到回報而失敗。

## 開發

- `npm test`：單元測試（不碰 herdr）。
- `test/m0`、`test/p1`：在隔離的 herdr session 跑的實測腳本與紀錄。
