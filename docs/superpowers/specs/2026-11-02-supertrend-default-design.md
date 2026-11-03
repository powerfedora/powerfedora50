# Supertrend 默认主图设计

## 目标

将个股 K 线弹窗的默认主图组合调整为 BOLL（20，2）与 Supertrend（ATR 10，倍数 3）；BBI 保留为可选指标但默认不显示。

## 范围

- 在指标计算模块增加逐日 Supertrend 序列，返回趋势状态及对应主图线值。
- 在弹窗增加 Supertrend 复选框，默认选中；BBI 默认取消选中。
- 在主图以红/绿两段绘制 Supertrend，并纳入价格坐标范围和鼠标悬停读数。
- 更新主图说明文字和自动化测试。

## 非目标

- 不改变 BOLL 参数，不改选股条件，不新增交易或提醒规则。
- 不将 Supertrend 作为机械买卖信号。

## 方案比较

1. **独立复选框（采用）**：BOLL、BBI 与 Supertrend 可独立开关；默认只开 BOLL 与 Supertrend。用户可按需要重新打开 BBI。
2. 与 BOLL 绑定：无法只看 BOLL 或只看 Supertrend，不符合现有指标控件的一致性。

## 约束

- 保持原生 SVG 和无新增依赖。
- 采用 ATR 长度 10、倍数 3。
- Supertrend 多头段使用上涨色，空头段使用下跌色；首次得到足够 ATR 数据前不绘制。
