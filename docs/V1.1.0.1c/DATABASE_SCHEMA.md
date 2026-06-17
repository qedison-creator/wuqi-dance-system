# 舞栖舞蹈社 V1.1.0.1c - 数据库 Schema 汇总

> **数据库名称**: `wuqi_dance`
> **数据库类型**: MongoDB (Mongoose ODM)
> **文档版本**: V1.1.0.1c
> **生成时间**: 2026-06-18

---

## 目录

- [第一部分：核心业务模型](#第一部分核心业务模型)
  - [1.1 User（用户/会员）](#11-user用户会员)
  - [1.2 Coach（教练）](#12-coach教练)
  - [1.3 Store（门店）](#13-store门店)
  - [1.4 DanceStyle（舞蹈风格）](#14-dancestyle舞蹈风格)
  - [1.5 Schedule（课程排课）](#15-schedule课程排课)
  - [1.6 Booking（预约记录）](#16-booking预约记录)
  - [1.7 Waitlist（候补名单）](#17-waitlist候补名单)
  - [1.8 Package（套餐）](#18-package套餐)
  - [1.9 UserPackage（用户已购套餐）](#19-userpackage用户已购套餐)
  - [1.10 PackageActivation（套餐激活记录）](#110-packageactivation套餐激活记录)
  - [1.11 PackageExtension（套餐延期记录）](#111-packageextension套餐延期记录)
  - [1.12 Attendance（出勤/签到记录）](#112-attendance出勤签到记录)
- [第二部分：消息推送模型（本次修改核心）](#第二部分消息推送模型)
  - [2.1 TemplateFieldMapping ⭐核心模型](#21-templatefieldmapping-核心模型)
- [第三部分：系统与配置模型](#第三部分系统与配置模型)
  - [3.1 SystemConfig（系统配置 KV）](#31-systemconfig系统配置-kv)
  - [3.2 Config（配置 KV - 简化版）](#32-config配置-kv---简化版)
  - [3.3 PendingTask（延迟待执行任务）](#33-pendingtask延迟待执行任务)
  - [3.4 Image（图片资源）](#34-image图片资源)
  - [3.5 Banner（首页轮播）](#35-banner首页轮播)
  - [3.6 Announcement（公告）](#36-announcement公告)
  - [3.7 ExemptionLog（豁免次数变更日志）](#37-exemptionlog豁免次数变更日志)
  - [3.8 OperationLog（操作审计日志）](#38-operationlog操作审计日志)
  - [3.9 Holiday（节假日/维护日）](#39-holiday节假日维护日)
  - [3.10 TransferRequest（转店申请）](#310-transferrequest转店申请)
  - [3.11 WeekTemplate（星期排课模板）](#311-weektemplate星期排课模板)
  - [3.12 CoachSalary（教练薪资规则）](#312-coachsalary教练薪资规则)
  - [3.13 CoachSalaryStat（教练薪资结算明细）](#313-coachsalarystat教练薪资结算明细)
  - [3.14 SalaryBill（薪资结算账单）](#314-salarybill薪资结算账单)

---

## 第一部分：核心业务模型

### 1.1 User（用户/会员）

| 项目 | 内容 |
| --- | --- |
| 集合名 | `users` |
| 模型文件名 | `src/models/User.js` |
| 主要用途 | 存储会员/管理员/员工账户信息 |

#### 字段列表

| 字段 | 类型 | 必填 | 默认值 | 约束 / 索引 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `_id` | ObjectId | 是 | 自动生成 | 主键 | 记录 ID |
| `openid` | String | 否 | - | unique, sparse | 微信 openid（小程序登录用） |
| `unionid` | String | 否 | - | - | 微信 unionid |
| `nick_name` | String | 否 | - | - | 微信昵称 |
| `avatar_url` | String | 否 | - | - | 头像 URL |
| `phone` | String | 否 | - | 普通索引 | 手机号 |
| `wechat_phone` | String | 否 | - | 普通索引 | 微信授权手机号 |
| `reserve_phone` | String | 否 | - | 普通索引 | 预留手机号 |
| `user_type` | String | 是 | `member` | enum: member/admin/staff | 用户角色类型 |
| `member_status` | String | 是 | `registered` | enum: guest/registered/official | 会员状态 |
| `gender` | Number | 否 | `0` | - | 性别 (0 未知 / 1 男 / 2 女) |
| `real_name` | String | 否 | - | - | 真实姓名 |
| `store_id` | ObjectId | 否 | - | ref: Store | 归属门店（主） |
| `store_ids` | ObjectId[] | 否 | `[]` | ref: Store | 可使用的门店列表 |
| `role` | String | 否 | - | enum: super_admin/store_manager/staff | 管理员角色 |
| `permissions` | String[] | 否 | `[]` | - | 权限列表 |
| `username` | String | 否 | - | unique, sparse | 后台登录用户名 |
| `password` | String | 否 | - | - | BCrypt 加密后的密码 |
| `status` | String | 是 | `active` | enum: active/disabled | 账户状态 |
| `exemption_count` | Number | 否 | `3` | - | 豁免次数（取消预约不扣费） |
| `member_code` | String | 否 | - | unique, sparse | 会员编号 |
| `info_completed` | Boolean | 否 | `false` | - | 信息是否完善 |
| `phone_audit_status` | String | 否 | `pending` | enum: pending/approved/rejected | 手机号审核状态 |
| `phone_audit_pending` | String | 否 | - | - | 待审核手机号 |
| `phone_audit_requested_at` | Date | 否 | - | - | 手机号申请时间 |
| `last_inactive_reminded_at` | Date | 否 | - | - | 上次休眠提醒时间 |
| `info_change_request.status` | String | 否 | `none` | enum: none/pending/approved/rejected | 信息变更申请状态 |
| `info_change_request.pending_data` | Mixed | 否 | - | - | 待审核数据 |
| `info_change_request.requested_at` | Date | 否 | - | - | 申请时间 |
| `info_change_request.reviewed_by` | ObjectId | 否 | - | ref: User | 审核人 |
| `info_change_request.reviewed_at` | Date | 否 | - | - | 审核时间 |
| `info_change_request.reject_reason` | String | 否 | - | - | 拒绝原因 |
| `created_at` | Date | 是 | 自动生成 | - | 创建时间 |
| `updated_at` | Date | 是 | 自动生成 | - | 更新时间 |

#### 索引

- `{ openid: 1 }` unique + sparse
- `{ username: 1 }` unique + sparse
- `{ member_code: 1 }` unique + sparse
- `{ user_type: 1, member_status: 1 }`
- `{ phone: 1 }`
- `{ wechat_phone: 1 }`
- `{ reserve_phone: 1 }`

#### 关联关系

- → `Store`（归属门店）
- → `User`（自关联：审核人）
- ← `Booking` / `Waitlist` / `UserPackage` / `Attendance` / `TransferRequest` / `ExemptionLog` / `OperationLog`

---

### 1.2 Coach（教练）

| 项目 | 内容 |
| --- | --- |
| 集合名 | `coaches` |
| 模型文件名 | `src/models/Coach.js` |

#### 字段列表

| 字段 | 类型 | 必填 | 默认值 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `name` | String | 是 | - | - | 教练姓名 |
| `avatar_url` | String | 否 | - | - | 头像 URL |
| `gender` | Number | 否 | `0` | - | 性别 |
| `phone` | String | 否 | - | - | 联系电话 |
| `introduction` | String | 否 | - | - | 介绍 |
| `dance_styles` | ObjectId[] | 否 | `[]` | ref: DanceStyle | 擅长舞蹈风格 |
| `gallery` | String[] | 否 | `[]` | ≤ 9 张 | 相册（已迁移至 Image 模型，deprecated） |
| `status` | String | 是 | `active` | enum: active/disabled | 状态 |
| `sort_order` | Number | 否 | `0` | - | 排序权重 |
| `show_on_home` | Boolean | 否 | `true` | - | 首页展示 |
| `created_at` / `updated_at` | Date | 是 | 自动 | - | 时间戳 |

#### 索引

- `{ name: 1 }`
- `{ status: 1 }`
- `{ store_id: 1 }`（注意：字段 schema 未显式声明 store_id）

#### 关联关系

- → `DanceStyle`（擅长风格）
- ← `Schedule` / `CoachSalary` / `CoachSalaryStat`

---

### 1.3 Store（门店）

| 项目 | 内容 |
| --- | --- |
| 集合名 | `stores` |
| 模型文件名 | `src/models/Store.js` |

#### 字段列表

| 字段 | 类型 | 必填 | 默认值 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `name` | String | 是 | - | - | 门店名称 |
| `address` | String | 否 | - | - | 地址 |
| `phone` | String | 否 | - | - | 联系电话 |
| `description` | String | 否 | - | - | 描述 |
| `images` | String[] | 否 | `[]` | - | 门店图片 |
| `nav_name` | String | 否 | - | - | 导航名称 |
| `location.latitude` / `location.longitude` | Number | 否 | - | - | 经纬度 |
| `business_hours.start` / `business_hours.end` | String | 否 | `09:00` / `22:00` | - | 营业时间 |
| `status` | String | 是 | `active` | enum: active/disabled | 状态 |
| `created_at` / `updated_at` | Date | 是 | 自动 | - | 时间戳 |

#### 索引

- `{ name: 1 }`
- `{ status: 1 }`

#### 关联关系

- ← `User` / `Schedule` / `Booking` / `UserPackage` / `WeekTemplate` / `CoachSalaryStat` / `Holiday`

---

### 1.4 DanceStyle（舞蹈风格）

| 项目 | 内容 |
| --- | --- |
| 集合名 | `dancestyles` |
| 模型文件名 | `src/models/DanceStyle.js` |

#### 字段列表

| 字段 | 类型 | 必填 | 默认值 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `name` | String | 是 | - | unique | 舞蹈风格名称 |
| `description` | String | 否 | - | - | 描述 |
| `icon_url` | String | 否 | - | - | 图标 |
| `cover_url` | String | 否 | - | - | 封面 |
| `sort_order` | Number | 否 | `0` | - | 排序 |
| `status` | String | 是 | `active` | enum: active/disabled | 状态 |

#### 索引

- `{ sort_order: 1 }`
- `{ status: 1 }`

#### 关联关系

- ← `Coach` / `Schedule` / `Package`

---

### 1.5 Schedule（课程排课）

| 项目 | 内容 |
| --- | --- |
| 集合名 | `schedules` |
| 模型文件名 | `src/models/Schedule.js` |
| 核心地位 | 排课主表，与 Booking/Package 强关联 |

#### 字段列表

| 字段 | 类型 | 必填 | 默认值 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `coach_id` | ObjectId | 是 | - | ref: Coach | 教练 |
| `dance_style_id` | ObjectId | 是 | - | ref: DanceStyle | 舞蹈风格 |
| `store_id` | ObjectId | 是 | - | ref: Store | 门店 |
| `date` | String | 是 | - | 格式 `YYYY-MM-DD` | 上课日期 |
| `start_time` / `end_time` | String | 是 | - | 格式 `HH:mm` | 起止时间 |
| `max_bookings` | Number | 否 | `20` | - | 最大预约数 |
| `min_bookings` | Number | 否 | `5` | - | 最低开班人数 |
| `current_bookings` | Number | 否 | `0` | - | 当前已预约人数 |
| `status` | String | 是 | `available` | enum: available/full/cancelled/cancelled_insufficient/offline/not_open/completed/deleted | 课程状态 |
| `cancel_reason` / `cancel_type` | String | 否 | - | - | 取消原因/类型 |
| `note` | String | 否 | - | - | 备注 |
| `schedule_type` | String | 否 | `group` | enum: group/private/trial | 课程类型 |
| `course_name` | String | 否 | - | - | 课程名称 |
| `classroom` | String | 否 | - | - | 教室 |
| `duration` | Number | 否 | `75` | - | 时长（分钟） |
| `booking_deadline` | Number | 否 | `120` | - | 预约截止（课前分钟数） |
| `cancel_deadline` | Number | 否 | `60` | - | 取消截止 |
| `credits_cost` | Number | 否 | `1` | - | 消耗课时数 |
| `from_template` | Boolean | 否 | `false` | - | 是否来自 WeekTemplate |
| `remark` | String | 否 | - | - | 备注 |
| `cover` | String | 否 | - | - | 封面 |
| `cycle_config` | Mixed | 否 | - | - | 循环配置 |
| `created_by` | ObjectId | 否 | - | ref: User | 创建人 |

#### 索引

- `{ coach_id: 1, date: 1 }`
- `{ store_id: 1, date: 1 }`
- `{ store_id: 1, weekday: 1 }`
- `{ dance_style_id: 1 }`
- `{ date: 1, start_time: 1 }`
- `{ status: 1 }`

#### 关联关系

- → `Coach` / `DanceStyle` / `Store` / `User`
- ← `Booking` / `Waitlist` / `Attendance` / `CoachSalaryStat` / `PendingTask`

---

### 1.6 Booking（预约记录）

| 项目 | 内容 |
| --- | --- |
| 集合名 | `bookings` |
| 模型文件名 | `src/models/Booking.js` |

#### 字段列表

| 字段 | 类型 | 必填 | 默认值 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `user_id` | ObjectId | 是 | - | ref: User | 预约用户 |
| `schedule_id` | ObjectId | 是 | - | ref: Schedule | 课程 |
| `coach_id` | ObjectId | 是 | - | ref: Coach | 教练 |
| `dance_style_id` | ObjectId | 是 | - | ref: DanceStyle | 舞蹈风格 |
| `store_id` | ObjectId | 是 | - | ref: Store | 门店 |
| `booking_date` | String | 是 | - | - | 预约日期 |
| `booking_time` | String | 是 | - | - | 预约时间 |
| `status` | String | 是 | `booked` | enum: booked/cancelled/completed | 状态 |
| `cancel_reason` | String | 否 | - | - | 取消原因 |
| `cancelled_at` | Date | 否 | - | - | 取消时间 |
| `is_exempt` | Boolean | 否 | `false` | - | 是否豁免 |
| `remark` | String | 否 | - | - | 备注 |
| `cancel_type` | String | 否 | - | enum: normal/timeout/exempt/admin_cancel/min_bookings_not_met/holiday | 取消类型 |
| `cancel_time` | Date | 否 | - | - | 取消时间 |
| `credits_deducted` | Number | 否 | `1` | - | 扣除课时 |
| `credits_refunded` | Number | 否 | `0` | - | 已退还课时 |
| `exemption_used` | Boolean | 否 | `false` | - | 已使用豁免 |
| `checked_in` | Boolean | 否 | `false` | - | 是否已签到 |
| `check_in_time` | Date | 否 | - | - | 签到时间 |
| `checked_in_by` | ObjectId | 否 | - | ref: User | 签到操作人 |
| `user_package_id` | ObjectId | 否 | - | ref: UserPackage | 使用的套餐 |
| `source` | String | 否 | `member` | enum: member/onsite/admin | 来源 |
| `reminder_1h_sent` | Boolean | 否 | `false` | - | 1h 上课提醒已发送 |
| `reminder_30m_sent` | Boolean | 否 | `false` | - | 30m 上课提醒已发送 |

#### 索引

- `{ user_id: 1, booking_date: 1 }`
- `{ user_id: 1, schedule_id: 1 }`
- `{ schedule_id: 1 }`
- `{ schedule_id: 1, status: 1 }`
- `{ coach_id: 1, booking_date: 1 }`
- `{ store_id: 1, booking_date: 1 }`
- `{ status: 1 }`
- `{ created_at: -1 }`

#### 关联关系

- → `User` / `Schedule` / `Coach` / `DanceStyle` / `Store` / `UserPackage`
- ← `Waitlist` / `Attendance` / `ExemptionLog` / `CoachSalaryStat`

---

### 1.7 Waitlist（候补名单）

| 项目 | 内容 |
| --- | --- |
| 集合名 | `waitlists` |
| 模型文件名 | `src/models/Waitlist.js` |

#### 字段列表

| 字段 | 类型 | 必填 | 默认值 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `user_id` | ObjectId | 是 | - | ref: User | 用户 |
| `schedule_id` | ObjectId | 是 | - | ref: Schedule | 课程 |
| `store_id` | ObjectId | 是 | - | ref: Store | 门店 |
| `status` | String | 是 | `waiting` | enum: waiting/notified/booked/expired/cancelled | 候补状态 |
| `position` | Number | 否 | `1` | - | 排队位置 |
| `notified_at` | Date | 否 | - | - | 通知时间 |
| `expire_at` | Date | 否 | - | - | 过期时间 |
| `remark` | String | 否 | - | - | 备注 |

#### 索引

- `{ user_id: 1, schedule_id: 1 }` **unique**
- `{ schedule_id: 1, status: 1 }`
- `{ status: 1, created_at: 1 }`

#### 关联关系

- → `User` / `Schedule` / `Store`

---

### 1.8 Package（套餐）

| 项目 | 内容 |
| --- | --- |
| 集合名 | `packages` |
| 模型文件名 | `src/models/Package.js` |

#### 字段列表

| 字段 | 类型 | 必填 | 默认值 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `name` | String | 是 | - | - | 套餐名称 |
| `description` | String | 否 | - | - | 描述 |
| `class_count` | Number | 是 | - | - | 课时数 |
| `price` | Number | 是 | - | - | 价格 |
| `original_price` | Number | 否 | - | - | 原价 |
| `duration_days` | Number | 是 | - | - | 有效天数 |
| `dance_styles` | ObjectId[] | 否 | `[]` | ref: DanceStyle | 可用舞蹈风格 |
| `is_popular` | Boolean | 否 | `false` | - | 热门推荐 |
| `sort_order` | Number | 否 | `0` | - | 排序 |
| `status` | String | 是 | `active` | enum: active/disabled | 状态 |

#### 索引

- `{ name: 1 }`
- `{ status: 1 }`
- `{ sort_order: 1 }`

#### 关联关系

- → `DanceStyle`
- ← `UserPackage` / `PackageActivation` / `PackageExtension`

---

### 1.9 UserPackage（用户已购套餐）

| 项目 | 内容 |
| --- | --- |
| 集合名 | `userpackages` |
| 模型文件名 | `src/models/UserPackage.js` |
| 核心地位 | 套餐生命周期主表 |

#### 字段列表

| 字段 | 类型 | 必填 | 默认值 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `user_id` | ObjectId | 是 | - | ref: User | 所属用户 |
| `package_id` | ObjectId | 否 | - | ref: Package | 套餐模板 |
| `store_id` | ObjectId | 否 | - | ref: Store | 所属门店 |
| `package_type` | String | 是 | `count_card` | enum: count_card/time_card | 计次卡 / 时间卡 |
| `total_credits` | Number | 是 | - | - | 总课时 |
| `remaining_credits` | Number | 是 | - | - | 剩余课时 |
| `duration_value` / `duration_unit` | Number / String | 否 | - / `month` | enum: month/day | 有效期时长 |
| `start_date` / `end_date` | Date | 否 | - | - | 开始/结束日期 |
| `original_end_date` | Date | 否 | - | - | 原始结束日期（用于延期） |
| `daily_limit` / `weekly_limit` | Number | 否 | - | - | 日/周使用次数限制 |
| `used_count_current_period` | Number | 否 | `0` | - | 当前周期已用次数 |
| `period_start_date` | Date | 否 | - | - | 当前周期起始 |
| `is_activated` | Boolean | 否 | `false` | - | 是否激活 |
| `activated_at` | Date | 否 | - | - | 激活时间 |
| `auto_activate_at` | Date | 否 | - | - | 自动激活时间 |
| `is_suspended` | Boolean | 否 | `false` | - | 是否停卡 |
| `suspended_at` / `suspend_end_date` | Date | 否 | - | - | 停卡起止 |
| `frozen_remaining_credits` / `frozen_end_date` | Number / Date | 否 | - | - | 冻结数据 |
| `status` | String | 是 | `pending` | enum: pending/active/expired/exhausted | 主状态 |
| `extension_days` / `extension_reason` | Number / String | 否 | `0` / - | - | 延期累计 |
| `remark` | String | 否 | - | - | 备注 |
| `created_by` | ObjectId | 是 | - | ref: User | 创建人 |
| `last_expire_reminded_at` | Date | 否 | - | - | 上次过期提醒时间 |
| `last_low_count_reminded_at` | Date | 否 | - | - | 上次课时不足提醒时间 |

#### 索引

- `{ user_id: 1, status: 1 }`
- `{ user_id: 1, store_id: 1, status: 1 }`
- `{ status: 1 }`
- `{ end_date: 1 }`
- `{ auto_activate_at: 1 }`

#### 关联关系

- → `User` / `Package` / `Store` / `User`(created_by)
- ← `Booking` / `PackageActivation` / `PackageExtension`

---

### 1.10 PackageActivation（套餐激活记录）

| 项目 | 内容 |
| --- | --- |
| 集合名 | `packageactivations` |
| 模型文件名 | `src/models/PackageActivation.js` |

#### 字段列表

| 字段 | 类型 | 必填 | 默认值 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `user_package_id` | ObjectId | 是 | - | ref: UserPackage | 被激活的用户套餐 |
| `user_id` | ObjectId | 是 | - | ref: User | 用户 |
| `package_id` | ObjectId | 否 | - | ref: Package | 套餐模板 |
| `store_id` | ObjectId | 否 | - | ref: Store | 门店 |
| `activation_type` | String | 是 | - | enum: first_booking/manual_force | 激活类型 |
| `booking_id` | ObjectId | 否 | - | ref: Booking | 首次预约触发时关联 |
| `activated_by` | ObjectId | 否 | - | ref: User | 操作人 |
| `activated_at` | Date | 是 | `now` | - | 激活时间 |
| `remark` | String | 否 | - | - | 备注 |

#### 索引

- `{ user_package_id: 1 }` / `{ user_id: 1 }` / `{ package_id: 1 }` / `{ store_id: 1 }` / `{ activated_at: -1 }`

---

### 1.11 PackageExtension（套餐延期记录）

| 项目 | 内容 |
| --- | --- |
| 集合名 | `packageextensions` |
| 模型文件名 | `src/models/PackageExtension.js` |

#### 字段列表

| 字段 | 类型 | 必填 | 默认值 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `user_package_id` | ObjectId | 是 | - | ref: UserPackage | 目标套餐 |
| `user_id` | ObjectId | 是 | - | ref: User | 用户 |
| `package_id` | ObjectId | 是 | - | ref: Package | 套餐模板 |
| `store_id` | ObjectId | 是 | - | ref: Store | 门店 |
| `operation_type` | String | 是 | - | enum: extend/revoke | 操作类型 |
| `extend_days` | Number | 否 | - | - | 延期天数 |
| `original_expire_at` / `new_expire_at` | Date | 是 | - | - | 新旧过期时间 |
| `holiday_id` | ObjectId | 否 | - | ref: Holiday | 关联节假日 |
| `operated_by` | ObjectId | 是 | - | ref: User | 操作人 |
| `revoked_extension_id` | ObjectId | 否 | - | ref: PackageExtension | 被撤销的延期记录 |
| `reason` / `remark` | String | 否 | - | - | 原因/备注 |

#### 索引

- `{ user_package_id: 1 }` / `{ user_id: 1 }` / `{ package_id: 1 }` / `{ store_id: 1 }` / `{ created_at: -1 }`

---

### 1.12 Attendance（出勤/签到记录）

| 项目 | 内容 |
| --- | --- |
| 集合名 | `attendances` |
| 模型文件名 | `src/models/Attendance.js` |

#### 字段列表

| 字段 | 类型 | 必填 | 默认值 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `schedule_id` | ObjectId | 是 | - | ref: Schedule, index | 课程 |
| `user_id` | ObjectId | 是 | - | ref: User, index | 用户 |
| `booking_id` | ObjectId | 否 | `null` | ref: Booking | 关联预约 |
| `store_id` | ObjectId | 否 | - | ref: Store, index | 门店 |
| `coach_id` | ObjectId | 否 | - | ref: Coach | 教练 |
| `dance_style_id` | ObjectId | 否 | - | ref: DanceStyle | 舞蹈风格 |
| `check_in_time` | Date | 否 | `now` | - | 签到时间 |
| `check_in_by` | ObjectId | 否 | - | ref: User | 签到操作人 |
| `source` | String | 否 | `booking` | enum: booking/onsite/admin, index | 来源 |
| `check_in_method` | String | 否 | `scan` | enum: scan/auto/exempt_cancel | 签到方式 |
| `credits_cost` | Number | 否 | `0` | - | 消耗课时 |
| `date` | String | 否 | - | index | 日期字符串 |
| `course_name` | String | 否 | `""` | - | 课程名（冗余） |
| `remark` | String | 否 | `""` | - | 备注 |

#### 索引

- `{ schedule_id: 1, user_id: 1 }` **unique**
- `{ user_id: 1 }` / `{ store_id: 1 }` / `{ source: 1 }` / `{ date: 1 }`

#### 关联关系

- → `Schedule` / `User` / `Booking` / `Store` / `Coach` / `DanceStyle`

---

## 第二部分：消息推送模型

### 2.1 TemplateFieldMapping ⭐核心模型

> **本次修改核心模型**：负责微信订阅消息模板与业务数据字段的映射关系。业务推送逻辑通过 `template_key` 查找映射配置，将业务字段自动填充到微信模板的 `{{data.xxx}}` 占位符中。

| 项目 | 内容 |
| --- | --- |
| 集合名 | `templatefieldmappings` |
| 模型文件名 | `src/models/TemplateFieldMapping.js` |
| 文档版本 | V1.1.0.1c |

#### 主字段列表

| 字段 | 类型 | 必填 | 默认值 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `template_key` | String | 是 | - | **unique + index** | 模板标识 key（唯一索引，业务逻辑查找主键） |
| `template_title` | String | 否 | `""` | - | 模板标题 |
| `template_name` | String | 是 | - | - | 微信模板名称 |
| `template_id` | String | 否 | `""` | - | 微信订阅消息 template_id（在微信公众平台后台申请得到） |
| `description` | String | 否 | `""` | - | 描述/说明 |
| `mappings` | Mapping[] | 否 | `[]` | 内嵌子文档 | 字段映射数组 |

#### 子文档结构：`mappings`

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `field_name` | String | 否 | `""` | 字段名（可选描述） |
| `wx_field` | String | 是 | - | **微信模板字段名**（如 `thing1` / `time2` / `thing3`） |
| `biz_field` | String | 是 | - | **业务字段表达式**（如 `user.nick_name` / `schedule.date` / `booking.time`） |
| `example_value` | String | 否 | `""` | 示例值（测试/调试用） |

#### 典型 `template_key` 示例（业务约定）

| template_key | 用途 |
| --- | --- |
| `booking_success` | 预约成功通知 |
| `booking_cancel` | 预约取消通知 |
| `class_reminder_1h` | 上课前 1 小时提醒 |
| `class_reminder_30m` | 上课前 30 分钟提醒 |
| `package_expire` | 套餐到期提醒 |
| `package_low_count` | 课时不足提醒 |
| `waitlist_available` | 候补可报名通知 |
| `class_cancelled` | 课程取消通知 |

#### 索引

- `{ template_key: 1 }` **unique + 普通索引**

#### 关联关系

- 无直接外键引用，业务通过 `biz_field` 表达式动态解析关联模型的字段
- 典型解析场景：`User` / `Coach` / `Schedule` / `Store` / `Booking` / `UserPackage` / `DanceStyle`

#### ✅ 本次修改重点说明

1. `template_key` 已加 `unique: true` + `index: true`，保证模板标识全局唯一，便于业务快速查找
2. `template_id` 为空时业务应视为"未配置"，不会发送微信消息
3. `biz_field` 支持对象点路径，由推送服务统一解析（需实现路径解析器，如 `_.get(bizData, biz_field)`）
4. `mappings` 是一个可扩展的数组，同一模板可配置多个字段映射，数量与微信模板占位符一一对应

---

## 第三部分：系统与配置模型

### 3.1 SystemConfig（系统配置 KV）

| 项目 | 内容 |
| --- | --- |
| 集合名 | `systemconfigs` |
| 模型文件名 | `src/models/SystemConfig.js` |

#### 字段列表

| 字段 | 类型 | 必填 | 默认值 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `key` | String | 是 | - | **unique** | 配置键 |
| `value` | Mixed | 是 | - | - | 配置值（任意类型） |
| `description` | String | 否 | - | - | 描述 |
| `group` | String | 否 | `general` | - | 配置分组 |

#### 索引

- `{ key: 1 }` **unique**
- `{ group: 1 }`

---

### 3.2 Config（配置 KV - 简化版）

| 项目 | 内容 |
| --- | --- |
| 集合名 | `configs` |
| 模型文件名 | `src/models/Config.js` |

#### 字段列表

| 字段 | 类型 | 必填 | 默认值 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `key` | String | 是 | - | unique | 配置键 |
| `value` | Mixed | 否 | - | - | 配置值 |
| `description` | String | 否 | - | - | 描述 |
| `category` | String | 否 | `general` | - | 分类 |

> ⚠️ 注意：`SystemConfig` 与 `Config` 功能高度重叠，建议后续统一为一个模型。

---

### 3.3 PendingTask（延迟待执行任务）

| 项目 | 内容 |
| --- | --- |
| 集合名 | `pendingtasks` |
| 模型文件名 | `src/models/PendingTask.js` |
| 用途 | 上课提醒、自动签到、最低人数检查等延迟任务 |

#### 字段列表

| 字段 | 类型 | 必填 | 默认值 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `schedule_id` | ObjectId | 是 | - | ref: Schedule | 关联课程 |
| `user_id` | ObjectId | 否 | `null` | ref: User | 目标用户 |
| `trigger_at` | Date | 是 | - | - | 触发时间 |
| `type` | String | 是 | - | enum: class_reminder_1h/class_reminder_30m/min_bookings_check/auto_check_in/class_complete | 任务类型 |
| `processed` | String | 否 | `pending` | enum: pending/sending/done | 处理状态 |
| `updated_at` / `created_at` | Date | 否 | `now` | - | 时间戳 |

#### 索引

- `{ trigger_at: 1, processed: 1 }`
- `{ schedule_id: 1, type: 1 }`

---

### 3.4 Image（图片资源）

| 项目 | 内容 |
| --- | --- |
| 集合名 | `images` |
| 模型文件名 | `src/models/Image.js` |

#### 字段列表

| 字段 | 类型 | 必填 | 默认值 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `title` | String | 是 | - | - | 标题 |
| `image_url` | String | 是 | - | - | 图片 URL |
| `thumbnail_url` | String | 否 | `""` | - | 缩略图 URL |
| `coach_ids` | ObjectId[] | 否 | `[]` | ref: Coach | 关联教练 |
| `width` / `height` | Number | 否 | `0` | - | 尺寸 |
| `orientation` | String | 否 | `landscape` | enum: landscape/portrait/square | 方向 |
| `show_on_home` | Boolean | 否 | `true` | - | 首页展示 |
| `sort_order` | Number | 否 | `0` | - | 排序 |

#### 索引

- `{ coach_ids: 1 }`
- `{ show_on_home: 1, sort_order: -1 }`
- `{ created_at: -1 }`

---

### 3.5 Banner（首页轮播）

| 项目 | 内容 |
| --- | --- |
| 集合名 | `banners` |
| 模型文件名 | `src/models/Banner.js` |

#### 字段列表

| 字段 | 类型 | 必填 | 默认值 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `title` | String | 是 | - | - | 标题 |
| `image_url` | String | 是 | - | - | 图片 URL |
| `link_type` | String | 否 | `none` | enum: none/page/url/mini_program | 链接类型 |
| `link_value` | String | 否 | - | - | 链接值 |
| `sort_order` | Number | 否 | `0` | - | 排序 |
| `start_date` / `end_date` | String | 否 | - | - | 展示日期范围 |
| `status` | String | 是 | `active` | enum: active/disabled | 状态 |

#### 索引

- `{ sort_order: 1 }` / `{ status: 1 }` / `{ created_at: -1 }`

---

### 3.6 Announcement（公告）

| 项目 | 内容 |
| --- | --- |
| 集合名 | `announcements` |
| 模型文件名 | `src/models/Announcement.js` |

#### 字段列表

| 字段 | 类型 | 必填 | 默认值 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `title` | String | 是 | - | - | 标题 |
| `content` | String | 是 | - | - | 正文 |
| `store_id` | ObjectId | 否 | `null` | ref: Store | 指定门店（null 为全门店） |
| `status` | String | 否 | `active` | enum: active/inactive | 状态 |
| `created_at` / `updated_at` | Date | 否 | `now` | - | 时间戳 |

---

### 3.7 ExemptionLog（豁免次数变更日志）

| 项目 | 内容 |
| --- | --- |
| 集合名 | `exemptionlogs` |
| 模型文件名 | `src/models/ExemptionLog.js` |

#### 字段列表

| 字段 | 类型 | 必填 | 默认值 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `user_id` | ObjectId | 是 | - | ref: User | 目标用户 |
| `booking_id` | ObjectId | 否 | - | ref: Booking | 关联预约 |
| `type` | String | 是 | - | enum: use/add/deduct/reset | 变更类型 |
| `delta` | Number | 是 | - | - | 变更数量（正为增加，负为减少） |
| `before_count` / `after_count` | Number | 是 | - | - | 变更前后次数 |
| `reason` | String | 否 | `""` | - | 原因 |
| `operator_id` | ObjectId | 否 | - | ref: User | 操作人 |
| `operator_name` | String | 否 | `""` | - | 操作人姓名（冗余） |

#### 索引

- `{ user_id: 1, created_at: -1 }`
- `{ created_at: -1 }`

---

### 3.8 OperationLog（操作审计日志）

| 项目 | 内容 |
| --- | --- |
| 集合名 | `operationlogs` |
| 模型文件名 | `src/models/OperationLog.js` |

#### 字段列表

| 字段 | 类型 | 必填 | 默认值 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `operator_id` | ObjectId | 否 | - | ref: User | 操作人 |
| `operator_name` | String | 否 | - | - | 操作人姓名 |
| `action` | String | 是 | - | - | 操作动作 |
| `module` | String | 是 | - | - | 所属模块 |
| `target_id` | ObjectId | 否 | - | - | 目标对象 ID |
| `target_type` | String | 否 | - | - | 目标对象类型 |
| `detail` | String | 否 | - | - | 详情 |
| `result` | String | 否 | `success` | enum: success/failure | 结果 |
| `ip` / `user_agent` | String | 否 | - | - | 客户端信息 |

#### 索引

- `{ operator_id: 1 }` / `{ module: 1 }` / `{ action: 1 }` / `{ created_at: -1 }`

---

### 3.9 Holiday（节假日/维护日）

| 项目 | 内容 |
| --- | --- |
| 集合名 | `holidays` |
| 模型文件名 | `src/models/Holiday.js` |

#### 字段列表

| 字段 | 类型 | 必填 | 默认值 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `name` | String | 是 | - | - | 节假日名称 |
| `date` | String | 是 | - | - | 开始日期 |
| `end_date` | String | 否 | - | - | 结束日期（支持跨天） |
| `is_recurring` | Boolean | 否 | `false` | - | 是否每年重复 |
| `type` | String | 否 | `holiday` | enum: holiday/maintenance/custom | 类型 |
| `description` | String | 否 | - | - | 描述 |
| `status` | String | 是 | `active` | enum: active/disabled/cancelled | 状态 |
| `store_scope` | String | 否 | `all` | enum: all/single | 作用范围 |
| `store_id` | ObjectId | 否 | - | ref: Store | 指定门店（single 时有效） |

#### 索引

- `{ date: 1 }` / `{ type: 1 }` / `{ status: 1 }`

---

### 3.10 TransferRequest（转店申请）

| 项目 | 内容 |
| --- | --- |
| 集合名 | `transferrequests` |
| 模型文件名 | `src/models/TransferRequest.js` |

#### 字段列表

| 字段 | 类型 | 必填 | 默认值 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `user_id` | ObjectId | 是 | - | ref: User | 申请用户 |
| `from_store_id` / `to_store_id` | ObjectId | 是 | - | ref: Store | 转出/转入门店 |
| `reason` | String | 否 | - | - | 原因 |
| `status` | String | 是 | `pending` | enum: pending/approved/rejected | 状态 |
| `reviewed_by` | ObjectId | 否 | - | ref: User | 审核人 |
| `reviewed_at` | Date | 否 | - | - | 审核时间 |
| `reject_reason` | String | 否 | - | - | 拒绝原因 |
| `remark` | String | 否 | - | - | 备注 |

#### 索引

- `{ user_id: 1, status: 1 }` / `{ status: 1 }` / `{ from_store_id: 1, to_store_id: 1 }`

---

### 3.11 WeekTemplate（星期排课模板）

| 项目 | 内容 |
| --- | --- |
| 集合名 | `weektemplates` |
| 模型文件名 | `src/models/WeekTemplate.js` |

#### 字段列表

| 字段 | 类型 | 必填 | 默认值 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `store_id` | ObjectId | 是 | - | ref: Store, **unique** | 门店 |
| `template` | Mixed | 否 | `{ 0:[],1:[],...,6:[] }` | - | 星期模板。键为 `0-6` 对应周日到周六，值为课程配置数组 |
| `created_at` / `updated_at` | Date | 否 | `now` | - | 时间戳 |

#### 索引

- `{ store_id: 1 }` **unique**（每个门店只能有一个模板）

---

### 3.12 CoachSalary（教练薪资规则）

| 项目 | 内容 |
| --- | --- |
| 集合名 | `coachsalaries` |
| 模型文件名 | `src/models/CoachSalary.js` |

#### 字段列表

| 字段 | 类型 | 必填 | 默认值 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `coach_id` | ObjectId | 是 | - | ref: Coach | 教练 |
| `store_id` | ObjectId | 否 | - | ref: Store | 门店 |
| `duration` | Number | 是 | - | - | 课时时长档（分钟） |
| `salary_rate` | Number | 是 | - | - | 薪资单价（元/节） |
| `created_by` | ObjectId | 是 | - | ref: User | 创建人 |
| `is_active` | Boolean | 否 | `true` | - | 是否启用 |
| `effective_from` / `effective_to` | Date | 否 | `now` / - | - | 生效时间范围 |
| `remark` | String | 否 | - | - | 备注 |

#### 索引

- `{ coach_id: 1, duration: 1 }` **unique**（同一教练时长档唯一）
- `{ coach_id: 1 }` / `{ store_id: 1 }` / `{ is_active: 1 }`

---

### 3.13 CoachSalaryStat（教练薪资结算明细）

| 项目 | 内容 |
| --- | --- |
| 集合名 | `coachsalarystats` |
| 模型文件名 | `src/models/CoachSalaryStat.js` |

#### 字段列表

| 字段 | 类型 | 必填 | 默认值 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `coach_id` | ObjectId | 是 | - | ref: Coach | 教练 |
| `store_id` | ObjectId | 是 | - | ref: Store | 门店 |
| `booking_id` | ObjectId | 否 | `null` | ref: Booking | 关联预约 |
| `schedule_id` | ObjectId | 是 | - | ref: Schedule | 课程 |
| `class_date` | Date | 是 | - | - | 上课日期 |
| `duration` | Number | 是 | - | - | 课时时长 |
| `attendance_count` | Number | 否 | `0` | - | 出勤人数 |
| `salary_rate` | Number | 是 | - | - | 薪资单价 |
| `total_salary` | Number | 是 | - | - | 总薪资 |
| `status` | String | 否 | `pending` | enum: pending/settled/cancelled | 结算状态 |
| `settled_at` | Date | 否 | - | - | 结算时间 |
| `settled_by` | ObjectId | 否 | - | ref: User | 结算操作人 |
| `remark` | String | 否 | - | - | 备注 |

#### 索引

- `{ coach_id: 1, store_id: 1 }` / `{ coach_id: 1 }` / `{ store_id: 1 }` / `{ booking_id: 1 }` / `{ schedule_id: 1 }` / `{ class_date: -1 }` / `{ status: 1 }`

---

### 3.14 SalaryBill（薪资结算账单）

| 项目 | 内容 |
| --- | --- |
| 集合名 | `salarybills` |
| 模型文件名 | `src/models/SalaryBill.js` |

#### 字段列表

| 字段 | 类型 | 必填 | 默认值 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `start_date` / `end_date` | Date | 是 | - | - | 结算周期 |
| `coaches` | Object[] | 否 | `[]` | 内嵌子文档 | 教练薪资明细数组 |
| `coaches[].coach_id` | ObjectId | 是 | - | ref: Coach | 教练 ID |
| `coaches[].coach_name` | String | 否 | - | - | 教练姓名（冗余） |
| `coaches[].items[]` | Object[] | 否 | - | - | 时长档位明细（duration/count/rate/amount） |
| `coaches[].total_amount` | Number | 否 | - | - | 该教练结算金额 |
| `total_amount` | Number | 否 | `0` | - | 账单总金额 |
| `coach_count` | Number | 否 | `0` | - | 教练人数 |
| `generated_by` | ObjectId | 否 | - | ref: User | 生成人 |
| `created_at` | Date | 否 | `now` | - | 生成时间 |

#### 索引

- `{ created_at: -1 }`
- `{ start_date: 1, end_date: 1 }`

---

## 附录 A：模型一览总表

| 序号 | 模型名 | 集合名（推断） | 分组 | 核心度 |
| --- | --- | --- | --- | --- |
| 1 | User | `users` | 核心业务 | ★★★★★ |
| 2 | Coach | `coaches` | 核心业务 | ★★★★ |
| 3 | Store | `stores` | 核心业务 | ★★★★ |
| 4 | DanceStyle | `dancestyles` | 核心业务 | ★★★ |
| 5 | Schedule | `schedules` | 核心业务 | ★★★★★ |
| 6 | Booking | `bookings` | 核心业务 | ★★★★★ |
| 7 | Waitlist | `waitlists` | 核心业务 | ★★★ |
| 8 | Package | `packages` | 核心业务 | ★★★★ |
| 9 | UserPackage | `userpackages` | 核心业务 | ★★★★★ |
| 10 | PackageActivation | `packageactivations` | 核心业务 | ★★★ |
| 11 | PackageExtension | `packageextensions` | 核心业务 | ★★★ |
| 12 | Attendance | `attendances` | 核心业务 | ★★★★ |
| 13 | TemplateFieldMapping | `templatefieldmappings` | **消息推送** | ⭐ **本次修改核心** |
| 14 | SystemConfig | `systemconfigs` | 系统配置 | ★★★ |
| 15 | Config | `configs` | 系统配置 | ★★ |
| 16 | PendingTask | `pendingtasks` | 系统配置 | ★★★★ |
| 17 | Image | `images` | 系统配置 | ★★ |
| 18 | Banner | `banners` | 系统配置 | ★★ |
| 19 | Announcement | `announcements` | 系统配置 | ★★ |
| 20 | ExemptionLog | `exemptionlogs` | 系统配置 | ★★★ |
| 21 | OperationLog | `operationlogs` | 系统配置 | ★★★ |
| 22 | Holiday | `holidays` | 系统配置 | ★★★ |
| 23 | TransferRequest | `transferrequests` | 系统配置 | ★★★ |
| 24 | WeekTemplate | `weektemplates` | 系统配置 | ★★★ |
| 25 | CoachSalary | `coachsalaries` | 系统配置 | ★★★ |
| 26 | CoachSalaryStat | `coachsalarystats` | 系统配置 | ★★★ |
| 27 | SalaryBill | `salarybills` | 系统配置 | ★★★ |

---

## 附录 B：关键索引汇总

| 集合 | 唯一索引 | 普通高频索引 |
| --- | --- | --- |
| users | openid / username / member_code | (user_type, member_status) / phone / wechat_phone / reserve_phone |
| dancestyles | name | sort_order / status |
| waitlists | (user_id, schedule_id) | (schedule_id, status) |
| templatefieldmappings | template_key | template_key |
| weektemplates | store_id | - |
| coachsalaries | (coach_id, duration) | coach_id / store_id / is_active |
| attendances | (schedule_id, user_id) | user_id / store_id / source / date |
| bookings | - | (user_id, schedule_id) / (schedule_id, status) / (coach_id, date) / status |
| schedules | - | (coach_id, date) / (store_id, date) / status / (date, start_time) |
| systemconfigs | key | group |

---

**文档结束**

> 本文档由 Schema 代码自动汇总生成，字段定义以 `src/models/*.js` 中的实际代码为准。任何字段变更请同时更新本文档与相关业务逻辑。
