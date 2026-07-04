# V1.1.0.5 版本修改记录

发布日期：2026-07-05

## 一、版本号统一

- 管理端关于页面：`wuqi-admin/package-common/pages/about/about.js` 更新为 `V1.1.0.5`
- 会员端关于页面：`wuqi-member/package-sub/pages/about/about.js` 更新为 `V1.1.0.5`
- 会员端个人中心「关于系统」弹窗：`wuqi-member/pages/profile/profile.js` 更新为 `V1.1.0.5`
- 根目录 `package.json` 更新为 `1.1.0.5`
- 后端 `wuqi-backend/package.json` 更新为 `1.1.0.5`

## 二、管理端（wuqi-admin）

### 1. 首页（pages/dashboard/dashboard.js / .wxml）
- 待办事项加载策略优化：首屏只加载「今日课程」，「近期课程」按需后台加载
- 课程卡片数据看板从 4 个统计改为 3 个：已预约 / 已签到 / 已取消
- 点击卡片统计项直接跳转预约记录页对应分类

### 2. 运营管理页（pages/operations/operations.js / .wxml / .wxss）
- 修复月份切换无响应问题
- 课程卡片统计改为 3 个分类
- 课程日志弹窗去掉顶部数据看板，点击分类直接显示对应列表

### 3. 预约记录页（package-schedule/pages/bookings/bookings.js / .wxml / .wxss）
- 支持 URL 传入 `tab` 参数，默认显示对应分类
- 顶部数据看板精简，与弹窗逻辑保持一致
- 预约状态统一为 3 分类：已预约 / 已签到 / 已取消

### 4. 预约汇总页（package-schedule/pages/booking-summary/booking-summary.js / .wxml / .wxss）
- 统计分类同步改为：已预约 / 已签到 / 已取消

### 5. 会员管理页（pages/members/members.js）
- 修复页面一直显示「加载中」的问题

### 6. 性能优化
- 自定义组件增加 `pureDataPattern`
- 图片标签统一添加 `decoding="async"`

## 三、核心业务逻辑修复

### 课程取消与预约记录关系
- 课程取消（包括人数不足自动取消、管理员手动取消、放假取消、签到后取消）后，预约记录不再被移入「已取消」名单
- 课程取消后，预约人数仍显示实际预约人数，不因课程取消或签到而变为 0
- 「已取消」名单仅记录用户自行取消或豁免取消的预约

### 预约状态 3 分类统一
- **已预约**：`booked` + 课程/admin 取消的 `cancelled`
- **已签到**：`checked_in` + `completed`（completed 标注「已完成」）
- **已取消**：用户自行取消的 `cancelled` + `exempted`（豁免取消标注「豁免取消」）

## 四、会员端（wuqi-member）

### 我的记录页（package-sub/pages/records/records.js / .wxml / .wxss）
- 去掉无限滚动自动分页，改为点击「查看更多」手动加载
- 每次加载 5 条，「查看更多（XX条）」数字固定为真实剩余条数
- 三个分类标签改为吸顶固定
- 已显示超过 10 条且滑动越过第 5 条记录时，右下角显示返回顶部按钮
- 点击返回顶部按钮后按钮隐藏，再次下滑越过第 5 条记录时重新显示

## 五、后端（wuqi-backend）

- `package.json` 版本号同步更新为 `1.1.0.5`
- 配合管理端分类统计，返回正确的预约/考勤数据
