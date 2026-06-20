# 项目快照 — 课程数据解耦改造前

**快照时间**: 2026-06-18 19:15
**Git 基准**: `a2f4cca` — V1.1.0.1c
**目的**: 课程数据独立改造执行前，记录原始状态，便于回退

---

## 一、即将改动的文件清单

### 1.1 Model 层（3 个文件）— 追加字段

| 文件 | 当前字段数 | 计划追加 | 追加后字段数 |
|------|-----------|---------|------------|
| `wuqi-backend/src/models/Booking.js` | 29 | 11 | 40 |
| `wuqi-backend/src/models/Attendance.js` | 14 | 5 | 19 |
| `wuqi-backend/src/models/Waitlist.js` | 9 | 6 | 15 |

### 1.2 Service 层（4 个文件）— 写入/查询改造

| 文件 | 改动点 |
|------|--------|
| `wuqi-backend/src/services/attendance.service.js` | `createAttendance` 写快照；`getMyAttendance` 懒补建加校验 |
| `wuqi-backend/src/services/booking.service.js` | `createBooking`/`checkIn` 写 Booking 快照 |
| `wuqi-backend/src/services/schedule.service.js` | `ensureFinalState` 写快照；`deleteSchedule` 追加 Waitlist 清理 |
| `wuqi-backend/src/services/coach-salary.service.js` | `getClassHoursStats` 过滤 exempt_cancel + 快照降级 |

### 1.3 新增文件（3 个迁移脚本）

| 文件 | 用途 |
|------|------|
| `wuqi-backend/scripts/migrate-booking-snapshots.js` | 存量 Booking 补全快照 |
| `wuqi-backend/scripts/migrate-attendance-snapshots.js` | 存量 Attendance 补全快照 |
| `wuqi-backend/scripts/migrate-waitlist-snapshots.js` | 存量 Waitlist 补全快照 |

### 1.4 本地配置文件

| 文件 | 状态 |
|------|------|
| `wuqi-backend/ecosystem.config.js` | 已存在（PM2 配置，进程名 `wuqi`，路径 `/home/ubuntu/wuqi-dance-system/backend`） |

---

## 二、完整数据模型原始定义

### 2.1 Booking 模型（改造前）

```javascript
const bookingSchema = new mongoose.Schema({
  // === 关联外键 ===
  user_id:          { type: ObjectId, ref: 'User', required: true },
  schedule_id:      { type: ObjectId, ref: 'Schedule', required: true },
  coach_id:         { type: ObjectId, ref: 'Coach', required: true },
  dance_style_id:   { type: ObjectId, ref: 'DanceStyle', required: true },
  store_id:         { type: ObjectId, ref: 'Store', required: true },
  user_package_id:  { type: ObjectId, ref: 'UserPackage' },
  checked_in_by:    { type: ObjectId, ref: 'User' },

  // === 业务字段 ===
  booking_date:     { type: String, required: true },
  booking_time:     { type: String, required: true },
  status:           { type: String, enum: ['booked','cancelled','completed'], default: 'booked' },
  cancel_reason:    { type: String },
  cancelled_at:     { type: Date },
  is_exempt:        { type: Boolean, default: false },
  cancel_type:      { type: String, enum: ['normal','timeout','exempt','admin_cancel','min_bookings_not_met','holiday'] },
  cancel_time:      { type: Date },
  credits_deducted: { type: Number, default: 1 },
  credits_refunded: { type: Number, default: 0 },
  exemption_used:   { type: Boolean, default: false },
  checked_in:       { type: Boolean, default: false },
  check_in_time:    { type: Date },
  source:           { type: String, enum: ['member','onsite','admin'], default: 'member' },
  remark:           { type: String },
  reminder_1h_sent: { type: Boolean, default: false },
  reminder_30m_sent:{ type: Boolean, default: false },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

// 索引
bookingSchema.index({ user_id: 1, booking_date: 1 });
bookingSchema.index({ user_id: 1, schedule_id: 1 });
bookingSchema.index({ schedule_id: 1 });
bookingSchema.index({ schedule_id: 1, status: 1 });
bookingSchema.index({ coach_id: 1, booking_date: 1 });
bookingSchema.index({ store_id: 1, booking_date: 1 });
bookingSchema.index({ status: 1 });
bookingSchema.index({ created_at: -1 });
```

### 2.2 Attendance 模型（改造前）

```javascript
const AttendanceSchema = new mongoose.Schema({
  schedule_id:   { type: ObjectId, ref: 'Schedule', required: true, index: true },
  user_id:       { type: ObjectId, ref: 'User', required: true, index: true },
  booking_id:    { type: ObjectId, ref: 'Booking', default: null },
  store_id:      { type: ObjectId, ref: 'Store', index: true },
  coach_id:      { type: ObjectId, ref: 'Coach' },
  dance_style_id:{ type: ObjectId, ref: 'DanceStyle' },
  check_in_time: { type: Date, default: Date.now },
  check_in_by:   { type: ObjectId, ref: 'User' },
  source:        { type: String, enum: ['booking','onsite','admin'], default: 'booking', index: true },
  check_in_method:{ type: String, enum: ['scan','auto','exempt_cancel'], default: 'scan' },
  credits_cost:  { type: Number, default: 0 },
  date:          { type: String, index: true },
  course_name:   { type: String, default: '' },
  remark:        { type: String, default: '' },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

// 联合唯一索引
AttendanceSchema.index({ schedule_id: 1, user_id: 1 }, { unique: true });
```

### 2.3 Waitlist 模型（改造前）

```javascript
const waitlistSchema = new mongoose.Schema({
  user_id:     { type: ObjectId, ref: 'User', required: true },
  schedule_id: { type: ObjectId, ref: 'Schedule', required: true },
  store_id:    { type: ObjectId, ref: 'Store', required: true },
  status:      { type: String, enum: ['waiting','notified','booked','expired','cancelled'], default: 'waiting' },
  position:    { type: Number, default: 1 },
  notified_at: { type: Date },
  expire_at:   { type: Date },
  remark:      { type: String },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

// 索引
waitlistSchema.index({ user_id: 1, schedule_id: 1 }, { unique: true });
waitlistSchema.index({ schedule_id: 1, status: 1 });
waitlistSchema.index({ status: 1, created_at: 1 });
```

### 2.4 Schedule 模型（不改动，仅记录）

```javascript
// 核心字段
coach_id, dance_style_id, store_id (ObjectId ref), date, start_time, end_time (String),
max_bookings(Number, default 20), min_bookings(Number, default 5),
current_bookings(Number, default 0), credits_cost(Number, default 1),
duration(Number, default 75), booking_deadline(Number, default 120),
cancel_deadline(Number, default 60), course_name(String), classroom(String),
schedule_type (enum: group/private/trial), from_template(Boolean),
status (enum: available/full/cancelled/cancelled_insufficient/offline/not_open/completed/deleted),
cancel_reason, cancel_type, note, remark, cover, cycle_config(Mixed), created_by(ref User)

// 索引
{ coach_id:1, date:1 }, { store_id:1, date:1 }, { store_id:1, weekday:1 },
{ dance_style_id:1 }, { date:1, start_time:1 }, { status:1 }
```

### 2.5 CoachSalaryStat 模型（不改动，仅记录）

```javascript
// 已自包含
coach_id(ref Coach), store_id(ref Store), booking_id(ref Booking), schedule_id(ref Schedule),
class_date(Date), duration(Number, required), attendance_count(Number, default 0),
salary_rate(Number, required), total_salary(Number, required),
status (enum: pending/settled/cancelled), settled_at(Date), settled_by(ref User), remark
```

### 2.6 其他不受影响的模型

- `User.js` — 不改动
- `Coach.js` — 不改动
- `Store.js` — 不改动
- `DanceStyle.js` — 不改动
- `UserPackage.js` — 不改动
- `Package.js` — 不改动
- `PendingTask.js` — 不改动
- `TransferRequest.js` — 不改动
- `SalaryBill.js` — 不改动
- `Holiday.js` — 不改动
- `SystemConfig.js` — 不改动

---

## 三、核心 Service 函数原始逻辑要点

### 3.1 `attendanceService.createAttendance`（第 70-90 行）
- 使用 `findOneAndUpdate + $setOnInsert + upsert:true`
- 只传入了调用方给的 data，不做额外 enrich
- 联合唯一索引 `(schedule_id, user_id)` 防止重复

### 3.2 `attendanceService.getMyAttendance` 懒补建（第 198-236 行）
- 对有 Booking 但无 Attendance 的记录自动补建
- 补建时从 `booking.schedule_id` 提取 date/course_name
- **未校验 schedule.status**，可能为已取消课程补建

### 3.3 `bookingService.createBooking`（第 92 行起）
- 从 `Schedule.findById` 获取 schedule 数据
- 创建 Booking 时传入 schedule 的 coach_id/dance_style_id/store_id/credits_deducted
- **未写快照字段（course_name/start_time 等）**

### 3.4 `bookingService.checkIn`（第 1681-1769 行）
- 调用 `attendanceService.createAttendance(data)` 
- data 中包含 schedule_id/user_id/store_id/coach_id/dance_style_id/credits_cost/date/course_name
- **未传 start_time/end_time/duration/coach_name/store_name**

### 3.5 `ensureFinalState`（schedule.service.js 第 52-109 行）
- 课程结束时自动将所有 booked booking 改为 completed
- 补建 Attendance（调用 createAttendance）
- **与 checkIn 补建面临相同问题：缺少完整快照**

### 3.6 `getClassHoursStats`（coach-salary.service.js 第 766 行起）
- 从 Attendance 查 schedule_ids → 反查 Schedule → 按教练分组统计
- **未过滤 exempt_cancel**
- **依赖 Schedule 表获取 start_time/end_time/duration**

---

## 四、回退方案

如需回退，按以下步骤执行：

### 4.1 代码回退
```bash
# 本地
git checkout -- wuqi-backend/src/models/Booking.js
git checkout -- wuqi-backend/src/models/Attendance.js
git checkout -- wuqi-backend/src/models/Waitlist.js
git checkout -- wuqi-backend/src/services/attendance.service.js
git checkout -- wuqi-backend/src/services/booking.service.js
git checkout -- wuqi-backend/src/services/schedule.service.js
git checkout -- wuqi-backend/src/services/coach-salary.service.js

# 服务器：scp 上传恢复后的文件，然后：
pm2 restart wuqi
```

### 4.2 数据库回退（如有迁移）
Mongoose 追加的非必填字段不需要回退（不影响功能），但如需清理：
```bash
mongosh wuqi-dance --eval '
  db.bookings.updateMany({}, { $unset: { course_name:"", schedule_date:"", schedule_start_time:"", schedule_end_time:"", schedule_duration:"", coach_name:"", store_name:"", dance_style_name:"", classroom:"", credits_cost:"", max_bookings:"" } });
  db.attendances.updateMany({}, { $unset: { start_time:"", end_time:"", duration:"", coach_name:"", store_name:"" } });
  db.waitlists.updateMany({}, { $unset: { course_name:"", schedule_date:"", start_time:"", end_time:"", coach_name:"", store_name:"" } });
'
```

### 4.3 验证回退成功
```bash
# 查看模型字段
mongosh wuqi-dance --eval 'db.bookings.findOne()' | grep -E '(course_name|schedule_start|coach_name)'
# 应返回空（字段已移除）
```
