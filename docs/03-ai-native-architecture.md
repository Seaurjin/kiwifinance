# Kiwi Finance — AI 原生架构

> 版本 v0.2 · 2026-09 · 这份文档定义产品的技术骨架。
> 配套：[`01-market-research.md`](./01-market-research.md) · [`02-product-and-dev-plan.md`](./02-product-and-dev-plan.md)

---

## 0. 三条不可违背的原则

这三条决定了后面所有的架构选择。任何与之冲突的方案一律否决。

### ① 数字永远不来自模型

**LLM 只输出「查询规格」，不输出数字。** 所有计算由确定性引擎完成，屏幕上每一个数字都能点击溯源到具体的交易行。

一个财务 App 只要编错一次数字就死了。这不是"加个校验"能解决的问题，它必须是架构层面的约束：模型物理上没有产生数字的路径。

### ② 多币种是地基，不是功能

从第一行 schema 开始，交易就带 `原币种金额 + 汇率 + 汇率来源 + 本位币金额`。单币种是多币种的特例，反过来不成立。事后加多币种 = 重写数据层 + 全量数据迁移。

### ③ 用户的数据属于用户

MCP 连接、全量导出、Skill 导出三条通道永远开放。用户可以随时把 Kiwi 的数据交给自己的 AI 去分析，我们不做数据囚笼。**这既是价值观，也是最强的差异化。**

---

## 1. 系统全景

```
┌─ 捕获层 CAPTURE ──────────────────────────────────────────┐
│  截图 · 拍照 · 邮件转发 · API/Webhook · 语音 · 手动         │
│  → 统一归一化为 DraftTransaction(含 confidence + provenance)│
└───────────────────────────┬───────────────────────────────┘
                            ↓
┌─ 账本内核 LEDGER CORE ────────────────────────────────────┐
│  多币种原生 · 不可变事件日志 · 软删除 · 本地优先            │
└───────────────────────────┬───────────────────────────────┘
                            ↓
┌─ 指标引擎 METRIC ENGINE ──────────────────────────────────┐
│  ~40 个版本化命名指标 · 纯函数 · 有测试 · 确定性            │
└───────────────────────────┬───────────────────────────────┘
                            ↓
┌─ AI HARNESS ─────────────────────────────────────────────┐
│  意图 → Planner(LLM) → Report Spec(JSON) → 引擎执行         │
│       → 事实集 → Narrator(LLM,只能引用事实) → 渲染器(确定性) │
└───────┬───────────────────┬───────────────────┬───────────┘
        ↓                   ↓                   ↓
   内置报表 Skills      个性化报表          MCP Server
   （8 个，预计算）    （自然语言生成）   （用户自己的 AI）
```

---

## 2. 捕获层：核心价值点

**产品的核心价值不是分析，是让记录这件事消失。** 分析是兑现，记录是入口 —— 入口不通，后面全是空的。

| 入口 | 实现 | 场景 |
|---|---|---|
| **截图** | iOS Share Extension / 相册选择 | 支付结果页、账单列表长图、银行 App 明细 |
| **拍照** | 相机 → 收据 | 线下消费，支持条目级拆分（一张超市小票拆成食品/日用/酒水） |
| **邮件** | 专属转发地址（`u_xxx@in.kiwi.app`） | 电商/外卖/航司/酒店确认信，转发即入账 |
| **API / Webhook** | REST + 个人 API Key | 给 power user：Shortcuts 自动化、自建脚本、第三方服务 |
| **语音 / 自然语言** | 一句话多笔 | "午饭 35，打车 22，买水 3 块" |
| **手动** | 3 秒数字键盘 | 兜底路径，必须永远一键可达 |

**统一产出物：`DraftTransaction`**

```
字段：金额 · 币种 · 日期 · 商家 · 分类建议 · 条目明细 · 账户猜测
元数据：confidence(0-1) · provenance(来源类型+原件引用) · extracted_by(模型版本)
```

- `confidence` 低于阈值 → 进"待确认"队列，一屏批量确认（滑动即过）
- `provenance` **永久保存**：哪张图、哪封邮件、哪次 API 调用。这是"可溯源"承诺的物理基础
- 提取失败永远不阻塞记账：一键转手动

> ⚠️ **安全边界**：收据和邮件内容是**不可信输入**。一张小票上完全可以印着"忽略之前的指令"。提取模型必须以纯数据方式处理它们、不携带任何工具权限、输出走严格 schema 校验。这条在 Phase 0 就要写进提示词模板并做对抗测试。

---

## 3. 账本内核：多币种原生

### 3.1 交易表的关键字段

```sql
amount_minor        INTEGER   -- 原币种金额，整数最小单位（分/仙），永不用浮点
currency            CHAR(3)   -- 原币种 ISO 4217
fx_rate             DECIMAL   -- 记账时点汇率
fx_rate_source      TEXT      -- 'card_statement' | 'ecb' | 'provider' | 'manual'
fx_as_of            DATE      -- 该汇率对应的日期
base_amount_minor   INTEGER   -- 本位币金额，落库时固化
base_currency       CHAR(3)
```

**规则：历史汇率永久缓存、永不回算。** 报表里 3 月的那笔咖啡，一年后看还是同一个数字。

### 3.2 两种汇率语义（必须区分并在 UI 标注）

| 口径 | 含义 | 用途 |
|---|---|---|
| **成交汇率** | 银行卡账单上真实发生的汇率（含银行加点） | "我实际花了多少钱" —— **默认口径** |
| **报表汇率** | 统一使用某日/某期的中间价 | 跨期、跨币种对比时消除汇率噪音 |

报表可一键切换口径，并明确标注当前用的是哪个。混用而不标注是财务软件的经典错误。

### 3.3 多币种必须处理的四件事

1. **换汇交易**：用 CNY 买 USD → 记为两条腿 + 隐含手续费单独入账（而不是凭空多出一笔支出）
2. **外币账户浮动盈亏**：汇率变动导致的账户价值变化走独立科目，**不污染消费统计**
3. **双本位币视图**：允许"生活本位币 SGD" + "汇报本位币 CNY" 并存，同一份报表可切换
4. **汇率数据源**：ECB / Frankfurter 免费日频做基准，允许用户用账单真实汇率覆盖单笔

### 3.4 可靠性设计

- 所有删除写 `deleted_at`，`event_log` 只追加不覆写 → 任何"记录消失"都可恢复
- 本地 SQLite 优先，离线完全可用；同步是增量的、幂等的
- 每笔交易保留 `source_hash` 用于去重（同一张截图重复导入不会记两笔）

---

## 4. 指标引擎：harness 的确定性一半

一套**版本化、有测试、有明确口径**的命名指标。LLM 只能调用，不能发明。

| 分组 | 指标示例 |
|---|---|
| 现金流 | `net_cash_flow` `income_total` `expense_total` `savings_rate` |
| 结构 | `category_share` `merchant_concentration` `top_merchants` `essential_vs_discretionary` |
| 时间 | `mom_delta` `yoy_delta` `rolling_avg` `spend_by_weekday` `seasonality_index` |
| 预算 | `budget_variance` `daily_allowance` `burn_rate` `days_to_overspend` |
| 周期性 | `recurring_detected` `subscription_total` `price_increase_alert` |
| **多币种** | `fx_exposure` `fx_gain_loss` `spend_by_currency` `cross_border_flow` |
| 资产 | `net_worth` `account_balances` `runway_months` |
| 数据质量 | `uncategorized_ratio` `low_confidence_count` `duplicate_candidates` |

每个指标 = 一个纯函数：输入过滤条件，输出**带单位、币种、口径说明的结果对象**。每个都有单元测试和黄金数据集。

**新增指标 = 新增一个经过测试的函数**，而不是改提示词。这是这套架构可以长期演进的原因。

---

## 5. Report Spec：LLM 与引擎之间唯一的接口

这是整套 harness 的核心机制：**text-to-spec, not text-to-answer**。

用户说人话 → Planner 模型输出一份**类型化的 JSON 规格**，而不是答案：

```json
{
  "title": "2026 上半年跨境支出复盘",
  "period": { "from": "2026-01-01", "to": "2026-06-30", "compare_to": "previous_period" },
  "base_currency": "SGD",
  "fx_mode": "transaction",
  "filters": { "currencies": ["CNY", "USD"], "exclude_categories": ["transfer"] },
  "blocks": [
    { "type": "metric_row", "metrics": ["expense_total", "savings_rate", "fx_gain_loss"] },
    { "type": "chart", "viz": "stacked_bar", "metric": "category_share", "group_by": "month" },
    { "type": "table", "metric": "top_merchants", "limit": 10 },
    { "type": "narrative", "focus": ["anomalies", "fx_exposure"] }
  ]
}
```

**执行链路**

| 步 | 执行者 | 说明 |
|---|---|---|
| 1 | Planner (LLM) | 自然语言 → Report Spec |
| 2 | 校验器（确定性） | JSON Schema 校验；非法即拒绝并要求重出，**不降级、不猜** |
| 3 | 指标引擎（确定性） | 执行 Spec → **事实集**（带口径的数字集合） |
| 4 | Narrator (LLM) | 写解读，**只能引用事实集中的数字**，每个论断标注来源 block |
| 5 | 渲染器（确定性） | 按 Spec + 数据画图，不经过 LLM |

**这套设计换来五个好处**

- **可信**：数字不可能被编造，每个都能点开看到底层交易
- **可缓存**：同一份 Spec + 同一批数据 = 同一份结果，不必重复烧钱
- **可复现**：三个月后重跑同一份报表，结果一致
- **可版本化**：Spec 是文本，能 diff、能回滚
- **可导出**：一份 Spec 就是一个 Skill，也是 MCP 的一个调用

---

## 6. Skill 化：报表是可增长的资产

一份报表 = 一个 **Skill 包**：`SKILL.md`（YAML frontmatter + 说明）+ Spec 模板 + 渲染规则。遵循 [agentskills.io](https://agentskills.io) 开放规范（2025-12 起为开放标准，Claude、GitHub Copilot、VS Code、Cursor、Codex、Gemini CLI 等约 40 个客户端已支持）。

**首发 8 个内置 Skill**

| Skill | 回答的问题 |
|---|---|
| 月度复盘 | 这个月钱去哪了，和上月比有什么变化 |
| 订阅审计 | 我在为哪些订阅付费，哪些涨价了，哪些没在用 |
| 跨境与汇率暴露 | 我有多少钱暴露在汇率波动里，换汇亏了还是赚了 |
| 旅行账单结算 | 这趟旅行花了多少，多币种合计，谁欠谁 |
| 大额异常排查 | 这个月有哪些不寻常的支出 |
| 预算重规划 | 我超支了，剩下的日子每天能花多少 |
| 报税准备包 | 把可抵扣支出按类目导出成会计能看的表 |
| 年度回顾 | 一年的财务全景 |

**用户自己的报表也是 Skill。** 用户用自然语言生成一份满意的报表 → 一键保存 → 系统把它固化成 Skill（命名、定时运行、分享、**导出到用户自己的 Claude / Codex 里用**）。

这是差异化的关键：**报表不是写死的代码，是可以生长的资产库。** 竞品的报表是产品经理定的；Kiwi 的报表是用户自己长出来的。

---

## 7. MCP Server：让用户用自己的 AI 分析

远程 MCP + **OAuth 2.1（Authorization Code + PKCE，动态客户端注册 RFC 7591）**。用户在 Claude 的 `Settings → Connectors → 添加自定义连接器` 粘贴 URL 即可（Pro / Max / Team / Enterprise 及移动端均支持）；ChatGPT 通过开发者模式的自定义连接器接入。

### 7.1 工具面设计

按**工作流**切分，同时保留通用查询能力（两者都要 —— 有的客户端擅长组合原子工具，有的更适合高层工作流）：

| Tool | 读/写 | 说明 |
|---|---|---|
| `kiwi_list_schema` | 只读 | 账户、分类树、币种、标签、**可用指标目录**。让外部 AI 先知道能问什么 |
| `kiwi_query_transactions` | 只读 | 结构化过滤 + 分页，返回精简字段 |
| `kiwi_run_metric` | 只读 | 调用指标库中的命名指标，返回带口径的结果 |
| `kiwi_run_report` | 只读 | 执行一份 Report Spec，返回**事实集**（不返回图片） |
| `kiwi_search_receipts` | 只读 | 按商家/金额/日期定位原始凭证 |
| `kiwi_add_transaction` | 写 | 需要单独授权的写作用域 |
| `kiwi_save_report` | 写 | 把外部 AI 组出来的分析存回 Kiwi，成为一个 Skill |

**Resources**：账本 schema、分类树、指标目录 —— 让 AI 先读结构再提问，避免瞎猜字段名。
**Prompts**：内置分析模板，降低用户的提问门槛。

每个工具都标注 `readOnlyHint` / `destructiveHint` / `idempotentHint`，返回 `structuredContent` 而不只是文本，错误信息必须给出下一步建议（"这个分类不存在，可用分类见 `kiwi_list_schema`"）。

### 7.2 安全设计（这是产品信任的一部分，不是附属功能）

- **默认只读**。写作用域单独授权、随时可撤销
- 令牌按作用域签发，短有效期 + 刷新令牌轮换 + 严格 redirect URI 匹配
- **每一次外部访问写审计日志**，用户在 App 里能看到"你的 Claude 在 9/2 14:03 读取了 3 月的 218 笔交易"
- 返回字段最小化，账号默认脱敏
- 速率限制 + 单次结果上限（防止一次调用把整个账本吸走）
- 产品内明确告知：**数据一旦进入用户自己的 AI，就受那家的隐私政策约束** —— 这句话必须写在授权页上

> 已知坑：远程 MCP 的 OAuth 在 Claude Web / ChatGPT / Claude Desktop 之间存在实现差异，社区有"连上了但工具没送达模型"的报告。**Phase 2 必须在三个客户端各做一遍真实联调**，不能只测一个。

---

## 8. AI-native 的代价与对策

"All in AI" 的真实代价是**延迟和钱**。对策是分层执行 —— 让 LLM 只做它不可替代的事。

| 层 | 走 LLM？ | 目标延迟 | 占比 |
|---|---|---|---|
| 规则命中的分类 | ❌ | < 50ms | 60–70% 的交易 |
| 8 个标准报表 | ❌（预计算 + 缓存） | < 300ms | 绝大多数查看行为 |
| 截图 / 收据提取 | ✅ Sonnet 5 | 2–4s | 每次捕获 |
| 新意图的个性化报表 | ✅ Planner | 4–8s | 低频 |
| 月度复盘叙述 | ✅ Opus 5（批处理，离线） | 不阻塞用户 | 每月 1 次 |

**原则：LLM 用在"理解意图"和"写字"，不用在"算数"和"重复劳动"。**

这条同时保住了三件事：交互不卡、账单不爆、数字不错。

---

## 9. 这套架构对开发计划的影响

| 阶段 | 新增/变化 |
|---|---|
| **Phase 0** | 增加 Report Spec schema 设计 + 指标库 v0（12 个核心指标）+ prompt injection 对抗测试 |
| **Phase 1** | 多币种数据模型（**不可延后**）· 指标引擎 · 8 个标准报表 · 捕获层五入口 |
| **Phase 2** | Planner（个性化报表）· Skill 化 · **MCP Server + OAuth** · 订阅付费 |
| **Phase 3** | 银行聚合 · 家庭共享 · Android · Skill 分享 |

**为什么 MCP 能放在 Phase 2 而不是更晚**：如果指标引擎和 Report Spec 在 Phase 1 做对了，MCP Server 只是它们之上的一层薄封装 —— 大约 2 周工作量，其中一半是 OAuth 和审计日志。**架构从第一天就是 MCP-ready，端点在 Phase 2 上线。**

---

## 10. 需要你知道的三个判断

### ① MCP 是护城河，不是获客引擎

今天会连 MCP 的用户 = Claude Pro/Max 用户 + ChatGPT 开发者模式用户，这是个**小而高价值**的群体。它带来的是口碑、留存和定价权，不是下载量。

**所以：不要让 MCP 的工期挤占捕获体验的工期。** Phase 1 的成败仍然只看一件事 —— 用户愿不愿意每天记账。

### ② 定位和定价发生了实质变化

从"更便宜的 AI 记账本"变成了"**你的个人财务数据层**"。价格空档的论据变弱了，差异化的论据变强了很多。建议的三档：

| 档位 | 年费 | 内容 |
|---|---|---|
| Free | $0 | 捕获全入口 + 3 个标准报表 + 单币种 |
| **Plus** | **$49** | 无限 AI 捕获 + 全部 8 个标准报表 + 多币种 + 每月个性化报表额度 |
| **Pro** | **$99** | MCP 连接 + 个人 API + 无限个性化报表 + Skill 导出与定时 + 银行聚合 + 家庭共享 |

Plus 仍在 Copilot($95)/Monarch($100)/YNAB($109) 之下守住价值定位；Pro 与它们同价，但提供的是它们**结构上做不到**的能力。

### ③ 最大的新风险是复杂度膨胀

AI-native 产品最容易失败的方式是："什么都能问，但什么都不好用"。

对策：**8 个标准报表必须做到不用问就够用。** 个性化生成是给剩下 20% 的需求的，不是主路径。如果用户必须靠提问才能看懂自己的财务状况，说明标准报表设计失败了。

---

## 参考

- [Agent Skills 开放规范 · agentskills.io](https://agentskills.io) · [anthropics/skills 规范文件](https://github.com/anthropics/skills/blob/main/spec/agent-skills-spec.md)
- [Claude 自定义连接器（远程 MCP）使用说明](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)
- [MCP connector — Claude Platform Docs](https://platform.claude.com/docs/en/agents-and-tools/mcp-connector)
- [Remote MCP in the Real World: OAuth 2.1, DCR](https://medium.com/@yagmur.sahin/remote-mcp-in-the-real-world-oauth-2-1-9d149de6e475)
- [Storing Exchange Rates for Multi-Currency Systems](https://dev.to/doogal/storing-exchange-rates-for-multi-currency-systems-50m2)
- [7 Best Historical Exchange Rate APIs in 2026](https://blog.apilayer.com/7-best-historical-exchange-rate-apis-in-2026-comparison/)
