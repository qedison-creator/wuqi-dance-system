# Tasks

- [x] Task 1: 重构 index.wxml 公告弹窗结构
  - [x] 1.1 删除卡片外部的 `am-nav-row` 和单条公告的独立关闭按钮
  - [x] 1.2 删除头部的 `am-page` 页码显示元素
  - [x] 1.3 在头部右侧添加关闭 ✕ 按钮（与"公告"标签同行）
  - [x] 1.4 在头部下方添加 Stories 风格分段进度条（仅多条公告时显示），每段可点击跳转
  - [x] 1.5 简化底部 footer：仅保留日期信息，移除圆点指示器
  - [x] 1.6 给内容区域添加触摸事件绑定（bindtouchstart、bindtouchmove、bindtouchend）用于滑动手势

- [x] Task 2: 重写 index.wxss 公告弹窗样式
  - [x] 2.1 删除外部导航相关样式：`am-nav-row`、`am-nav-arrow-btn`、`am-arrow-left`、`am-arrow-right`、`am-close-btn`、`am-close-ring`、`am-close-x`、`am-close-label`
  - [x] 2.2 删除 `am-page` 样式
  - [x] 2.3 删除底部圆点指示器样式：`am-dots`、`am-dot`、`am-dot.active`
  - [x] 2.4 新增头部关闭按钮样式：右上角 ✕ 符号，#948284 色，64rpx 触摸区域
  - [x] 2.5 新增进度条样式：6rpx 高度、6rpx 间距、3rpx 圆角、品牌渐变填充/浅灰未填充
  - [x] 2.6 简化底部 footer 样式：移除三栏布局，仅保留日期左对齐
  - [x] 2.7 添加内容切换淡入淡出动画（opacity transition）

- [x] Task 3: 在 index.js 中添加滑动手势处理
  - [x] 3.1 添加 `onContentTouchStart` 方法记录起始X坐标
  - [x] 3.2 添加 `onContentTouchEnd` 方法判断滑动方向和距离，触发切换
  - [x] 3.3 滑动阈值：水平位移 > 50rpx 才触发切换，避免误触
  - [x] 3.4 添加 `onProgressTap` 方法处理进度条段点击跳转

# Task Dependencies
- Task 2 依赖 Task 1（结构先改，样式再配）
- Task 3 独立于 Task 1/2（JS 逻辑可与结构样式并行开发）
