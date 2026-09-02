# Kiwi Finance — 项目 Prompt

> 用途：把这份内容整段粘贴给任何 AI（Claude / ChatGPT / Gemini / Cursor / Codex），作为项目上下文。
> 自包含，无需附带其他文档。改动产品决策时同步更新这里 —— 它是喂给 AI 的唯一真源。
> 版本 v1.0 · 2026-09

---

```
我在做一款名为 Kiwi Finance 的 AI 原生个人财务应用。以下是完整背景，请在此基础上工作。

## 产品定位

Kiwi 是个人财务数据层，不是又一个记账 App。
一句话：记录极简到只需截个图；分析强到可以用一句话生成任何报表；数据随时可以交给用户自己的 AI。

对标参考：
- 咔皮记账（商汤出品，AI 截图记账，上线半年百万用户）—— 学它的捕获体验，避开它的浅账本和数据可靠性问题
- Copilot / Monarch / YNAB（$95–110/年）—— 它们 100% 依赖银行聚合，现金消费与语义信息全部丢失
- 钱迹（免费无广告、600 万用户）—— 学它的信任叙事：可导出、不硬删、无理财导流

## 三条不可违背的原则

任何与之冲突的方案一律否决。

1. 数字永远不来自模型。
   LLM 只输出类型化的「查询规格」（Report Spec, JSON），所有计算由确定性指标引擎完成。
   屏幕上每个数字都能点击溯源到具体交易行。模型物理上没有产生数字的路径。

2. 多币种是数据模型的地基，不是功能。
   交易落库即固化：原币种金额（整数最小单位，永不用浮点）+ 汇率 + 汇率来源 + 本位币金额。
   历史汇率永久缓存、永不回算。
   区分「成交汇率」（银行卡真实汇率，默认口径）与「报表汇率」（统一中间价，跨期对比用），并在界面明确标注。

3. 用户的数据属于用户。
   MCP 连接、全量导出、Skill 导出三条通道永远开放，且导出无付费墙。

## 核心能力

【捕获层 —— 产品的核心价值】
产品的核心价值不是分析，是让「记录」这件事消失。入口不通，后面全是空的。
六条入口统一归一化为一个 DraftTransaction（带 confidence 与 provenance）：
截图 / 拍照（支持条目级拆分）/ 邮件转发 / 个人 API 与 Webhook / 语音（一句话多笔）/ 手动（3 秒，永远一键可达）。
iOS 系统级入口是必需项：Share Extension、App Intents（Shortcuts / 背部轻点）、主屏小组件。
入口必须在 App 之外，否则留存无解。
低置信度记录进「待确认队列」，一屏批量确认。provenance（哪张图/哪封邮件/哪次调用）永久保存。

【AI Harness —— 核心机制是 text-to-spec, not text-to-answer】
用户意图 → Planner(LLM) → Report Spec (JSON) → schema 校验（非法即拒，不降级不猜）
→ 指标引擎（确定性，约 40 个版本化命名指标，纯函数 + 单元测试 + 黄金数据集）
→ 事实集 → Narrator(LLM，只能引用事实集中的数字，每个论断标注来源) + 渲染器（确定性画图，不经过 LLM）

【报表与开放能力】
- 8 个内置标准报表（预计算 + 缓存，首屏 <300ms，不用提问就够用）：
  月度复盘 / 订阅审计 / 跨境与汇率暴露 / 旅行账单结算 / 大额异常排查 / 预算重规划 / 报税准备包 / 年度回顾
- 自然语言生成的个性化报表（走上面的 Planner 链路）
- Skill 化：一份报表 = 一个符合 agentskills.io 规范的 Skill 包（SKILL.md + Spec 模板 + 渲染规则），
  可命名、定时、分享，并可导出到用户自己的 Claude / Codex 中使用
- MCP Server：远程 MCP + OAuth 2.1（Authorization Code + PKCE + 动态客户端注册）
  工具：kiwi_list_schema / kiwi_query_transactions / kiwi_run_metric / kiwi_run_report /
        kiwi_search_receipts（以上只读）/ kiwi_add_transaction / kiwi_save_report（写，需单独授权）
  默认只读；每次外部访问写审计日志并在 App 内可见；返回字段最小化；速率与结果条数上限

## 市场优先级

1. 海外英文市场（美/加/英/澳），iOS 优先，多币种第一天可用
2. 中国大陆（第二阶段，独立分支）
3. 华人 / 跨境人群 —— 不独立立项，是首发市场内最容易口碑引爆的种子人群

## 技术选型倾向

- 客户端：Expo (React Native) + TypeScript；iOS 原生只写 Share Extension、App Intents、WidgetKit
- 本地：SQLite（本地优先，离线完全可用）；软删除 + append-only 事件日志，永不硬删
- 后端：Supabase（Postgres + Auth + RLS + Storage）
- AI / 指标服务：独立 Node + Fastify，同时是 MCP Server 的宿主；API Key 绝不进客户端
- 银行聚合：Teller 起步（前 100 连接免费），后期再评估 Plaid；聚合是可选增强，不是前提

## 模型策略（双轨，通过 ModelRouter 抽象层切换）

抽象层契约：{task, region, tier} → {provider, model, params}
产品代码只认任务（如 extract(receipt)），不认模型。换模型 = 改配置；进中国 = 换一组配置。

海外（偏好 OpenAI / Gemini，Claude 成本偏高）：
- 交易分类：Gemini 2.5 Flash-Lite
- 收据/截图提取：Gemini 3.7 Flash（Vision Evals 数据抽取 94.8%，同档最便宜）
- 低置信复核（约 10% 样本）：Gemini 3.1 Pro
- Planner / Narrator：Gemini 3.7 Flash / 3.1 Pro；OpenAI GPT-5.6 Terra 作为 strict schema 备选与容灾

中国（合规硬约束，非成本偏好）：
- 境外模型服务境内公众无合规路径
- 只调用已备案的国产模型 API，不做微调或任何二次开发
  → 因此只需 AI 应用登记，可避开 3–6 个月的大模型备案
- 组合：阿里云百炼 qwen-vl-ocr（专用 OCR）+ Qwen-Turbo（分类）+ Qwen3.7 Max（Planner / Narrator）

值得测的方案：两段式提取（专用 OCR 出文字与版面 → 便宜文本模型做语义归类），
中国市场已有证据显示 0.9B 专用 OCR 在 OmniDocBench 上打赢通用 VLM 且成本约 1/10。

## 商业模式

Free：全部捕获入口 + 3 个标准报表 + 单币种 + 每月 30 次 AI 识别
Plus $49/年：无限 AI 捕获 + 全部 8 个标准报表 + 多币种 + 每月 10 份个性化报表
Pro $99/年：MCP 连接 + 个人 API + 无限个性化报表 + Skill 导出与定时 + 银行聚合 + 家庭共享

## 安全与合规红线

- 收据与邮件是不可信输入，可能含 prompt injection（小票上可以印「忽略之前的指令」）。
  提取模型必须：零工具权限、以纯数据方式处理、输出走严格 schema 校验。对抗用例拦截率必须 100%。
- 不使用任何「投资建议」措辞；不做贷款/理财产品导流
- 中国版所有自由文本字段过内容安全接口（敏感问题拒答率 ≥95%）
- Supabase 全表开启行级安全；送模型的数据做最小化

## 明确不做

投资组合追踪 · 贷款理财导流 · 社交 feed · MVP 阶段的 Android

## 工作要求

- 给出判断和推荐，不要罗列所有选项让我选
- 涉及数字时说明假设与来源；不确定就标注为「待核实」，不要编造
- 优先保护三条原则和捕获体验；任何与之冲突的方案，先说明冲突再给方案
- 我不是程序员但有技术背景：解释简明、分点，技术细节可以给但要说清楚为什么重要
```

---

## 使用说明

**完整上下文**：直接粘贴上面代码块的全部内容。

**只需要某一部分时**，可以裁剪，但这三节建议永远保留：
- 三条不可违背的原则
- 核心能力中的 AI Harness 段落
- 工作要求

**配合仓库使用**：如果 AI 能读仓库文件，这段 prompt 加一句即可 ——
"详细需求见 `docs/PRD.md`，架构见 `docs/03-ai-native-architecture.md`，模型选型见 `docs/04-model-strategy.md`。"
