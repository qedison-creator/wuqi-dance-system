# 教练课时与薪酬模块 - 审计漏洞报告

**审计日期**: 2026-06-18
**审计版本**: V1.1.0.1c
**审计范围**: 课时统计功能的代码与业务逻辑

---

## 审计范围

| 层级 | 文件数 | 关键文件 |
|------|--------|---------|
| 数据模型 | 5 | Attendance.js, CoachSalary.js, CoachSalaryStat.js, SalaryBill.js, Schedule.js |
| 后端服务 | 6 | attendance.service.js, coach-salary.service.js, schedule.service.js, booking.service.js, stats.service.js, scheduler.js |
| 后端路由 | 7 | attendance, coach-salary, schedule, booking, qrcode, system, index |
| 管理端页面 | 4 | salary, course-records, check-in, bookings |

---

## 一、数据解耦审计

### ✅ 优点：课程删除不会级联丢失课时数据

`schedule.service.js` 第 776-820 行 `deleteSchedule` 是**软删除**（`status = 'deleted'`），仅清理 `PendingTask`，**不删除 Attendance、不删除 Booking、不删除 CoachSalaryStat**。

整个代码库中唯一会删除 Attendance 的地方是 `system.routes.js` 第 84-92 行的系统重置接口（`Attendance.deleteMany({})`），需要 super_admin 权限。

### ⚠️ 漏洞 1：课时统计查询仍依赖 Schedule 表关联

**问题**: `coach-salary.service.js` 第 766-785 行 `getClassHoursStats`：

```javascript
// 步骤1：从 Attendance 获取 schedule_ids
const attendances = await Attendance.find(attendanceFilter).select('schedule_id coach_id store_id');
const scheduleIds = [...new Set(attendances.map(a => a.schedule_id.toString()))];

// 步骤2：用 schedule_ids 反查 Schedule 获取详情
const schedules = await Schedule.find(filter).populate('coach_id', 'name avatar_url').populate('store_id', 'name');
```

**风险**: 虽然 Schedule 是软删除（文档仍存在），但 `Schedule.find(filter)` 的 `filter` 可能包含 `status` 过滤条件，导致软删除的课程被排除，课时统计**漏算**。

**严重程度**: 🟡 中等

### ⚠️ 漏洞 2：Attendance 未冗余 start_time/end_time/duration

**问题**: `Attendance.js` 模型中冗余了 `course_name` 和 `date`，但**没有冗余 `start_time`、`end_time`、`duration`**。

**风险**: 如果 Schedule 文档被物理删除（虽然当前代码不会，但数据库操作误删可能发生），课时统计将无法获取上课时间和时长，薪酬计算（依赖 duration）会失败。

**严重程度**: 🟡 中等

---

## 二、数据一致性审计

### ✅ 优点：签到状态校验严格

- `booking.service.js` 第 1681-1769 行 `checkIn`：校验 `booking.status === 'booked'`，已签到的抛错"已签到过"
- `schedule.service.js` 第 1006-1052 行 `markAttendance`：使用 `findOneAndUpdate` 条件 `status: 'booked'`，已 completed 的不会被重复处理

### ✅ 优点：createAttendance 幂等

`attendance.service.js` 第 70-90 行使用 `findOneAndUpdate + $setOnInsert + upsert:true`，配合 `schedule_id + user_id` 唯一索引，保证多次调用安全。

### ⚠️ 漏洞 3：课时统计未校验开课状态

**问题**: `coach-salary.service.js` 第 766-771 行 `getClassHoursStats`：

```javascript
const attendances = await Attendance.find(attendanceFilter).select('schedule_id coach_id store_id');
```

**只查了 Attendance 表，没有校验 Schedule 的 `status` 是否为 `completed`**。如果课程被取消（`cancelled`/`cancelled_insufficient`）但已有签到记录（比如课程开始后取消），这些签到仍会被计入课时统计。

**严重程度**: 🟡 中等

### ⚠️ 漏洞 4：豁免取消覆写 Attendance 可能产生脏数据

**问题**: `booking.service.js` 第 421-471 行 `cancelBooking` 中的豁免取消分支：

```javascript
// 条件：booking.status='completed' + checked_in + !check_in_by（自动签到）+ 开课后10分钟内
// 覆写 Attendance：check_in_method='exempt_cancel', credits_cost=0
```

**风险**: 豁免取消后，Attendance 记录仍然存在（只是 `check_in_method` 改为 `exempt_cancel`，`credits_cost` 改为 0）。课时统计查询时如果不过滤 `exempt_cancel`，**这节课仍会被计入教练课时**，但实际上会员并没有上课。

**严重程度**: 🟠 中高

### ⚠️ 漏洞 5：懒补建机制可能为已取消的课程创建课时记录

**问题**: `attendance.service.js` 第 198-236 行 `getMyAttendance` 中的懒补建逻辑：

```javascript
// 若 Booking 已 completed 但 Attendance 缺失，自动补建
```

**风险**: 如果 Booking 状态被错误标记为 `completed`（比如通过 `ensureFinalState` 自动同步），但课程实际被取消了，懒补建会为这个无效的 completed booking 创建 Attendance 记录，产生**脏课时数据**。

**严重程度**: 🟡 中等

---

## 三、溯源完整性审计

### ✅ 优点：Attendance 冗余了部分快照

| 冗余字段 | 用途 |
|---------|------|
| `course_name` | 课程名快照 |
| `date` | 上课日期快照 |
| `coach_id` | 教练ID |
| `store_id` | 门店ID |
| `dance_style_id` | 舞种ID |
| `credits_cost` | 消耗课时 |

### ✅ 优点：CoachSalaryStat 冗余了完整快照

| 冗余字段 | 用途 |
|---------|------|
| `class_date` | 上课日期 |
| `duration` | 课程时长 |
| `attendance_count` | 签到人数 |
| `salary_rate` | 薪酬单价 |
| `total_salary` | 应发金额 |

### ✅ 优点：SalaryBill 冗余了教练名和完整明细

### ⚠️ 漏洞 6：Attendance 缺少关键字段冗余

**问题**: Attendance 没有冗余以下字段：

| 缺失字段 | 影响 |
|---------|------|
| `start_time` | 无法独立溯源上课时间段 |
| `end_time` | 无法独立溯源下课时间 |
| `duration` | 无法独立计算课时时长（薪酬计算依赖此字段） |
| `coach_name` | 教练改名后历史记录无法溯源原始名称 |
| `store_name` | 门店改名后历史记录无法溯源原始名称 |

**风险**: 当前依赖 `schedule_id` 关联 Schedule 获取这些信息。如果 Schedule 被软删除且查询时过滤了 `status`，或 Schedule 文档被误删，课时记录将**无法独立溯源**。

**严重程度**: 🟠 中高

### ⚠️ 漏洞 7：course_name 快照不同步

**问题**: Attendance 的 `course_name` 是创建时的快照。如果后续修改了 Schedule 的 `course_name`，Attendance 中的快照**不会更新**。

**风险**: 课时统计展示的课程名可能与当前排课表中的课程名不一致。

**严重程度**: 🟢 低

---

## 四、并发与异常审计

### ✅ 优点：原子 upsert 消除 TOCTOU 竞态

`attendance.service.js` 第 70-90 行 `createAttendance` 使用 `findOneAndUpdate + $setOnInsert + upsert:true`，配合唯一索引，即使并发调用也安全。

### ✅ 优点：原子计数防超扣

`booking.service.js` 第 332-336 行次卡扣减使用 `findOneAndUpdate` + `$gte` 条件，防止并发超扣。

### ⚠️ 漏洞 8：签到流程未使用事务

**问题**: 签到流程涉及 3 个写操作，分散在多个 await 中，**未使用 MongoDB session/transaction**：

```
1. Booking.findByIdAndUpdate（status → completed）     ← booking.service.js 第 1726-1731 行
2. attendanceService.createAttendance                   ← booking.service.js 第 1745-1759 行
3. Schedule.findByIdAndUpdate（status → completed）     ← booking.service.js 第 1761-1766 行
```

**风险**: 如果步骤 1 成功但步骤 2 失败（网络抖动/MongoDB 连接中断），Booking 已标记为 completed 但 Attendance 未创建。虽然懒补建机制会在后续查询时补建，但存在**窗口期数据不一致**。

**严重程度**: 🟡 中等

### ⚠️ 漏洞 9：ensureFinalState 与手动签到并发冲突

**问题**: `schedule.service.js` 第 52-109 行 `ensureFinalState` 会在课程结束时自动将所有 booked 的 booking 改为 completed 并补建 Attendance。

**风险**: 如果管理员同时手动签到（`markAttendance`），两个操作可能同时处理同一个 booking。虽然 `findOneAndUpdate` 条件 `status: 'booked'` 保证只有一个操作成功，但失败的那个会静默跳过，**可能导致签到来源记录不准确**。

**严重程度**: 🟢 低

### ⚠️ 漏洞 10：CoachSalaryStat 未自动生成

**问题**: `coach-salary.service.js` 第 223-304 行 `createSalaryStat` 方法存在，但**未被任何签到流程自动调用**。薪酬数据只能通过 `POST /coach-salaries/stats/generate` 手动触发，或通过 `getMonthlySalaryBreakdown` 实时计算。

**风险**: 如果管理员忘记手动生成，CoachSalaryStat 表为空，薪酬统计依赖实时计算（Attendance × CoachSalary 配置），一旦 Attendance 或 Schedule 数据异常，薪酬数据无法独立校验。

**严重程度**: 🟡 中等

---

## 五、漏洞汇总表

| 编号 | 漏洞 | 严重程度 | 影响 |
|------|------|---------|------|
| 1 | 课时统计查询依赖 Schedule 表关联，可能因 status 过滤漏算 | 🟡 中等 | 课时少算 |
| 2 | Attendance 未冗余 start_time/end_time/duration | 🟡 中等 | Schedule 丢失后无法溯源 |
| 3 | 课时统计未校验 Schedule 的开课状态 | 🟡 中等 | 取消课程的签到被计入 |
| 4 | 豁免取消后 Attendance 仍被计入课时 | 🟠 中高 | 课时多算 |
| 5 | 懒补建可能为已取消课程创建课时记录 | 🟡 中等 | 脏数据 |
| 6 | Attendance 缺少 coach_name/store_name 快照 | 🟠 中高 | 改名后无法溯源 |
| 7 | course_name 快照不同步 | 🟢 低 | 展示不一致 |
| 8 | 签到流程未使用事务 | 🟡 中等 | 窗口期数据不一致 |
| 9 | ensureFinalState 与手动签到并发冲突 | 🟢 低 | 签到来源记录不准确 |
| 10 | CoachSalaryStat 未自动生成 | 🟡 中等 | 薪酬无法独立校验 |

---

## 六、修复优先级建议

**高优先级（建议尽快修复）**:
- 漏洞 4：豁免取消的 Attendance 应在课时统计中排除
- 漏洞 6：Attendance 补充冗余 coach_name/store_name/start_time/end_time/duration

**中优先级（建议下个版本修复）**:
- 漏洞 1+3：课时统计查询应独立于 Schedule 表，或明确包含所有 status
- 漏洞 8：签到流程引入 MongoDB transaction
- 漏洞 10：签到完成后自动生成 CoachSalaryStat

**低优先级（可观察后再决定）**:
- 漏洞 2+5+7+9
