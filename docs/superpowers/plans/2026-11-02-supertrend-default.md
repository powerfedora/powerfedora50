# Supertrend 默认主图 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在个股 K 线主图提供 Supertrend，并将其与 BOLL 作为默认组合。

**Architecture:** `indicators.js` 计算 Supertrend 的逐日线值和方向；`chart.js` 根据方向分段绘制主图线并输出悬停读数；弹窗状态与 HTML 控件决定是否显示。保持现有原生 SVG、CommonJS 测试和零依赖结构。

**Tech Stack:** Node.js 20、原生 JavaScript、node:test、原生 SVG。

**Spec:** `docs/superpowers/specs/2026-11-02-supertrend-default-design.md`

## Global Constraints

- 不新增依赖。
- Supertrend 使用 ATR 长度 10、倍数 3。
- 默认显示 BOLL 与 Supertrend，默认隐藏 BBI；三个指标均可独立切换。
- 多头段为上涨色、空头段为下跌色，数据不足时不绘制。

## Review Focus

- 前 10 根 K 线没有足够 ATR 时，指标必须返回空值且不能产生 NaN。
- 趋势翻转日必须从旧趋势线中断，并在新趋势色段开始。
- 开启 Supertrend 后其值必须影响主图纵轴范围，不能被裁切。
- 鼠标悬停任一 K 线时，读数应显示对应值和多空状态。
- 仅切换 BBI、BOLL 或 Supertrend 中任一项时，其他指标的显示状态必须保持。

---

### Task 1: 计算 Supertrend

**Files:**
- Modify: `public/js/indicators.js`
- Modify: `test/core.test.js`

**Interfaces:**
- Produces: `supertrend(bars, length = 10, multiplier = 3) -> { line: (number|null)[], direction: (1|-1|null)[] }`

- [ ] **Step 1: Write the failing test**

在 `test/core.test.js` 断言函数已导出、返回与 bars 等长的数组、数据充分后有有限数值和方向。

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/core.test.js`

Expected: FAIL，因为 `IND.supertrend` 尚未定义。

- [ ] **Step 3: Implement `supertrend(bars, length = 10, multiplier = 3)`**

用 Wilder 风格 ATR 平滑计算基本上下轨、最终上下轨及趋势方向；每根数据不足时写入 `null`。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/core.test.js`

Expected: Supertrend 测试 PASS。

### Task 2: 主图与默认控件

**Files:**
- Modify: `public/index.html`
- Modify: `public/js/stock-dialog.js`
- Modify: `public/js/chart.js`
- Modify: `public/css/style.css`

**Interfaces:**
- Consumes: `IND.supertrend(bars, 10, 3)`。
- Produces: `KChart.drawK(..., { supertrend: boolean })` 的可选主图叠加层。

- [ ] **Step 1: Extend test before code where testable**

在 `test/core.test.js` 读取弹窗与图表源文件，断言 Supertrend 控件、默认状态和传参存在。

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/core.test.js`

Expected: FAIL，因为 UI 尚无 Supertrend 状态与控件。

- [ ] **Step 3: Add the toggle and chart overlay**

增加 `supertrend` 独立复选框；默认 `bbi: false, boll: true, supertrend: true`；主图将同一方向连续线段分别用上涨/下跌色绘制，纳入缩放范围并写入悬停图例。

- [ ] **Step 4: Run tests to verify it passes**

Run: `npm test`

Expected: 新增指标与 UI 断言通过；如既有无关测试失败，记录其名称和原因。

- [ ] **Step 5: Manually verify in browser**

打开任一个股弹窗，确认默认 BOLL＋Supertrend、BBI 未选中，切换三者可独立重绘，悬停读数显示 Supertrend 数值及方向。
