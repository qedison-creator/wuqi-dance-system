# 舞栖舞蹈社 V1.1.0.1c - 核心业务逻辑文档

**版本号**: V1.1.0.1c
**更新日期**: 2026-06-18
**主题**: 消息推送与预约取消核心业务逻辑

---

## 一、消息推送服务（wechat-message.service.js）

### 1.1 服务模块职责

`wuqi-backend/src/services/wechat-message.service.js` 是整个系统中微信订阅消息发送的唯一入口，主要职责：

1. 从 MongoDB `templatefieldmappings` 集合动态加载模板配置与字段映射（而非硬编码在代码中）
2. 缓存模板映射（60 秒 TTL），避免每次发送都查库
3. 通过 `bizFieldAliases` 对象建立"中文业务字段名 ↔ 英文代码 key"的别名映射，支持管理端灵活配置
4. 负责微信 access_token 的获取与刷新缓存
5. 实现 `sendSubscribeMessage` —— 真正调用微信 API 的底层函数
6. 提供各场景的封装函数：`sendBookingSuccess` / `sendBookingCancel` / `sendClassReminder` / `sendWaitlistAvailable` / `sendPackageExpiring` / `sendPackageActivated` / `sendPhoneAuditResult`

### 1.2 模板加载机制（核心链路）

```
sendByTemplateKey(openid, templateKey, bizData)
  ├─ loadTemplateFromDB(templateKey)
  │   └─ TemplateFieldMapping.findOne({ template_key: templateKey })
  │      └─ 返回 { template_id, mappings: [{wx_field, biz_field}, ...] }
  │      └─ 结果缓存到 mappingCache[templateKey] 60s
  ├─ buildWxData(mappings, bizData)
  │   └─ 遍历 mappings，按 biz_field 从 bizData 取值
  │      查找顺序:
  │      1) bizData[biz_field] 直接取
  │      2) bizFieldAliases[biz_field] → 用别名 key 再取
  │      3) 遍历 bizFieldAliases 反向查找（英文→中文→取 bizData[中文key]）
  │   └─ 根据 wx_field 类型限制字符长度
  │   └─ 组装 wxData = { thing10: {value: '...'}, ... }
  └─ sendSubscribeMessage(openid, template_id, wxData)
       └─ POST https://api.weixin.qq.com/cgi-bin/message/subscribe/send
```

### 1.3 bizFieldAliases 完整映射（V1.1.0.1c）

```javascript
const bizFieldAliases = {
  // 基础字段
  '课程名称': 'courseName',
  '课程名': 'courseName',
  '教练': 'coachName',
  '课程时间': 'courseTime',
  '上课时间': 'courseTime',
  '取消原因': 'cancelReason',
  '提示信息': 'cancelReason',
  '温馨提示': 'cancelReason',
  'tipMessage': 'cancelReason',   // ← V1.1.0.1c 新增！兼容数据库 biz_field='tipMessage'
  '门店': 'storeName',
  '门店名称': 'storeName',
  '门店地址': 'storeName',
  '上课地址': 'storeName',
  '预约时间': 'bookingTime',
  '取消时间': 'cancelTime',

  // 套餐相关
  '套餐名称': 'packageName',
  '到期日期': 'expireDate',
  '套餐类型': 'packageType',
  '套餐': 'packageName',
  '提醒类型': 'remindType',
  '提醒原因': 'remindReason',

  // 其他
  '剩余次数': 'remainCount',
  '会员昵称': 'memberNickname',
  '审核项目': 'auditItem',
  '审核结果': 'auditResult',
  '备注': 'remark',
};
```

**关键设计原则**：管理端用户可以用中文配置 `biz_field`（如"取消原因"），但代码中 `bizData` 使用英文 key（如 `cancelReason`）。`bizFieldAliases` 作为中间层桥接两者。

### 1.4 sendBookingCancel 函数逻辑

```javascript
exports.sendBookingCancel = async (user, schedule, reason, clientType, templateKey) => {
  // clientType: 'member'（会员端）
  // templateKey: 'bookingCancel'（课程被取消）or 'bookingCancelByUser'（用户主动取消）
  // bizData 构建时 key 为英文:
  const bizData = {
    courseName: schedule.course_name,
    coachName: schedule.coach_id?.name || schedule.coach_name,
    cancelReason: reason || '已取消',      // ← thing7 的取值来源
    storeName: schedule.store_id?.name,
    cancelTime: now,
    courseTime: `${schedule.date} ${schedule.start_time}`,
  };
  await sendByTemplateKey(user.openid, templateKey, bizData, page, clientType);
};
```

**重要判断**：`templateKey='bookingCancelByUser'` 时，数据库 `mappings[3].biz_field` 必须能映射到 `cancelReason`。
- 若 `biz_field='cancelReason'` → 第 1 层直接命中 ✅
- 若 `biz_field='tipMessage'` → 第 2 层 `bizFieldAliases['tipMessage']='cancelReason'` 命中 ✅（V1.1.0.1c 新增）

### 1.5 模板缓存机制

```javascript
let mappingCache = {};
const MAPPING_CACHE_TTL = 60 * 1000; // 60秒

const loadTemplateFromDB = async (templateKey) => {
  // 命中缓存 → 直接返回
  // 未命中 → 查 MongoDB TemplateFieldMapping 表
  // 存回缓存 → 返回
};

exports.clearMappingCache = () => { mappingCache = {}; };
```

**管理员修改模板后的生效方式**：
- 方法A（推荐）：`pm2 restart wuqi` —— 重启即清缓存
- 方法B：等待 60 秒 —— 缓存自动过期
- 方法C（代码中调用）：`PUT /api/v1/template-mappings/:key` 接口保存后已调用 `clearMappingCache()`

### 1.6 微信 API 错误码速查表

| errcode | 含义 | 排查方向 |
|---------|------|---------|
| 0 | 成功 | —— |
| 40037 | invalid template_id | 数据库中 template_id 与微信后台不一致 |
| 47003 | data.xxx.value is empty | biz_field 与 bizData key 不匹配 |
| 43101 | 用户未授权订阅 | 用户侧未点击授权，非代码问题 |
| 40001 | invalid credential | access_token 过期/错误 |
| 其他 | 参考微信官方文档 | —— |

---

## 二、用户取消预约业务流程（booking.service.js）

### 2.1 流程概述

文件: `wuqi-backend/src/services/booking.service.js`
入口: `exports.cancelBooking(userId, bookingId)`

```
1. 通过 bookingId 查询 Booking，populate schedule_id → coach_id, store_id
2. 校验 booking.user_id === userId
3. 判断是否在可取消时间窗内
4. 更新 booking.status = 'cancelled', cancel_type, cancel_time
5. 找到用户的 UserPackage，credits += booking.credits_deducted
6. 递减 schedule.current_bookings（原子操作）
7. 候补队列有变动 → 调用 notifyWaitlistUsers()
8. 调用 wechat-message.sendBookingCancel(user, schedule, '您已取消预约', 'member', 'bookingCancelByUser')
```

### 2.2 关键 populate 逻辑

```javascript
const booking = await Booking.findById(bookingId).populate({
  path: 'schedule_id',
  populate: [
    { path: 'coach_id', select: 'name' },   // ← 确保 coachName 有值
    { path: 'store_id', select: 'name' }    // ← 确保 storeName 有值
  ]
});
```

**作用**：如果没有 populate，`schedule.coach_id` 和 `schedule.store_id` 只是 ObjectId 对象，取不到 `.name`，导致通知中教练/门店显示空值。

### 2.3 用户豁免取消（上课后 10 分钟内）

- `booking.status = 'completed'` 且在 class 开始后 10 分钟内
- 用户有 `exemption_count > 0` → 消耗一次豁免，退还课时
- 发送通知 template_key=`bookingCancelByUser`

---

## 三、课程被取消业务流程（schedule.service.js）

### 3.1 流程概述

文件: `wuqi-backend/src/services/schedule.service.js`
入口: `exports.cancelSchedule(id, operatorId, reason, cancelType)`

```
1. Schedule.findById(id).populate('coach_id','name').populate('store_id','name')
2. 更新 schedule.status = 'cancelled', cancel_type, cancel_reason
3. 遍历所有 bookings → status='cancelled'，退还课时
4. 对每个 booking.user_id 发送通知（template_key='bookingCancel'，注意非 bookingCancelByUser）
5. 记录 operation_log
6. 清理 PendingTask
```

### 3.2 与用户取消的差异

| 维度 | 用户取消（cancelBooking） | 课程被取消（cancelSchedule） |
|------|--------------------------|---------------------------|
| template_key | `bookingCancelByUser` | `bookingCancel` |
| 触发方 | 会员端小程序用户 | 管理端管理员 / 定时任务 |
| notify 内容字段 | `bizData.cancelReason = '您已取消预约'` | `bizData.cancelReason = '人数不足' / '管理员取消' 等` |

---

## 八、会员端订阅状态展示（subscribe-settings 页面）

### 8.1 页面状态设计（V1.1.0.1c 更新）

**文件位置**：
- `wuqi-member/pages/subscribe-settings/subscribe-settings.js`
- `wuqi-member/pages/subscribe-settings/subscribe-settings.wxml`
- `wuqi-member/pages/subscribe-settings/subscribe-settings.wxss`

**核心逻辑**：调用 `wx.getSetting({ withSubscriptions: true })` 获取用户的订阅状态，与本地 `subscribe_accepted_map`（用户历史操作记录）结合展示。

### 8.2 四种状态定义

| 状态 | 判断条件 | 页面展示 | 用户动作 |
|------|---------|---------|---------|
| **已订阅（subscribed）** | `itemSettings[id] === 'accept'` | ✓ 已订阅（绿色） | 无需操作，用户勾了"总是保持" |
| **已拒绝（rejected）** | `itemSettings[id] === 'reject' or 'ban'` | 已拒绝（灰色） | 用户曾点了"拒绝并永不再询问"，需去微信设置手动开启 |
| **⚠ 请重新授权（wasAcceptedOnce）** | `itemSettings[id]` 为空，且 `localAccepted[id] === true` | ⚠ 请重新授权（橙色） | 用户曾经点过"允许"但没勾"总是保持"，一次性额度已用完 |
| **去订阅** | `itemSettings[id]` 为空，且 `localAccepted[id]` 为空 | 去订阅（默认色） | 用户从未处理过此模板 |

### 8.3 V1.1.0.1c 的关键修正

**修改前（问题）**：
```javascript
const isSubscribed = wxStatus === 'accept' || (!wxStatus && !!localAccepted[item.id]);
```
- 用本地历史记录误判"已订阅"，对一次性订阅消息不准确
- 用户看到"✓ 已订阅"但实际可能消息发不出

**修改后（正确）**：
```javascript
const isSubscribed = wxStatus === 'accept';                     // 只有勾了"总是保持"才算已订阅
const wasAcceptedOnce = !wxStatus && !!localAccepted[item.id];   // 曾经授权过，额度可能已用完
```
- `isSubscribed` 只以微信系统级记录 `itemSettings[id] === 'accept'` 为准
- `wasAcceptedOnce` 作为参考状态提示用户重新订阅
- `canSubscribe = !isSubscribed && !isRejected`：随时可重新订阅

### 8.4 订阅授权机制（会员端业务流程验证）

所有业务场景均已调用 `requestSubscribeMessage` 相关函数，授权机制健全：

| 业务操作 | 触发函数 | 文件 | 行号 |
|---------|---------|------|------|
| 预约课程 | `requestBookingSubscribe()` | booking.js | ~第 501-503 行 |
| 取消预约 | `requestCancelSubscribe()` | course-detail.js | ~第 504-506 行 |
| 候补加入 | `requestWaitlistAndBookingSubscribe()` | course-detail.js | ~第 341-344 行 |
| 预约课程（教练详情页） | `requestBookingSubscribe()` | coach-detail.js | ~第 389-391 行 |
| 激活套餐（预约页） | `requestPackageSubscribe()` | booking.js | ~第 613-615 行 |
| 激活套餐（套餐详情页） | `requestPackageSubscribe()` | package-detail.js | ~第 103-104 行 |
| 手机号审核提交 | `requestPhoneAuditSubscribe()` | profile.js | ~第 1257-1258 行 |

**授权流程**（简化）：
```
用户触发业务操作 → 先请求订阅授权 → wx.requestSubscribeMessage 弹窗 → 用户点"允许"
                                                    └─ 若勾了"总是保持"→ 以后静默授权
                                                    └─ 若没勾 → 每次操作都需弹窗
→ 继续执行实际业务（预约/取消等）
→ 后端调用 sendSubscribeMessage 发送微信消息
```

**授权不会漏掉**：所有需要消息通知的业务场景均在操作前请求授权，用户有机会选择"允许"。



---

## 四、管理端模板配置页面（wuqi-admin）

### 4.1 页面结构

| 文件 | 职责 |
|------|------|
| `pages/settings/template-edit/template-edit.wxml` | WXML 页面结构（列表 + 展开编辑） |
| `pages/settings/template-edit/template-edit.js` | 数据加载 / 表单处理 / 保存提交 |
| `pages/settings/template-edit/template-edit.json` | 小程序页面配置 |
| `pages/settings/template-edit/template-edit.wxss` | 样式 |

### 4.2 数据加载

```
onShow → loadBizFieldOptions() → GET /api/v1/template-mappings/biz-fields
       ↓
       loadTemplates() → GET /api/v1/template-mappings
         ↓
         formatTemplate(t) → 对每个模板映射成前端可编辑结构
         ↓
         渲染列表，点击展开后进入编辑模式
```

### 4.3 保存流程

```
点击"保存配置"
  ├─ validateTemplate(template) —— 校验模板名、微信字段非空、biz_field 非空、微信字段不重复
  └─ PUT /api/v1/template-mappings/:templateKey
       └─ TemplateFieldMapping.findOneAndUpdate(upsert: true)
       └─ clearMappingCache() —— 立即生效（跳过 60 秒缓存）
```

### 4.4 biz_field 选项来源

管理端的"对应业务字段"下拉框由后端 `GET /template-mappings/biz-fields` 返回：

```javascript
const BIZ_FIELD_OPTIONS = [
  { value: 'courseName',   label: '课程名称' },
  { value: 'coachName',    label: '教练' },
  { value: 'storeName',    label: '门店' },
  { value: 'courseTime',   label: '课程时间' },
  { value: 'bookingTime',  label: '预约时间' },
  { value: 'cancelTime',   label: '取消时间' },
  { value: 'cancelReason', label: '取消原因' },  // ← 温馨提示应选此项
  { value: 'packageName',  label: '套餐名称' },
  { value: 'packageType',  label: '会员卡类型' },
  { value: 'remindType',   label: '提醒类型' },
  { value: 'remindReason', label: '提醒原因' },
  { value: 'expireDate',   label: '到期日期' },
  { value: 'remainCount',  label: '剩余次数' },
  { value: 'memberNickname', label: '会员昵称' },
  { value: 'auditItem',    label: '审核事项' },
  { value: 'auditResult',  label: '审核结果' },
  { value: 'remark',       label: '备注说明' },
  { value: 'classroom',    label: '上课地点' },
  { value: 'tipMessage',   label: '提示信息' },  // ← 此值在代码中映射为 cancelReason
];
```

---

## 五、后端 API 路由

### 5.1 模板配置路由

文件: `wuqi-backend/src/routes/template-mapping.routes.js`

| Method | Path | 功能 | 鉴权 |
|--------|------|------|------|
| GET | `/api/v1/template-mappings/biz-fields` | 获取业务字段选项 | 需要 |
| GET | `/api/v1/template-mappings` | 获取所有模板映射 | 需要 |
| GET | `/api/v1/template-mappings/:key` | 获取指定模板 | 需要 |
| PUT | `/api/v1/template-mappings/:key` | 保存/更新模板 | 需要 |
| DELETE | `/api/v1/template-mappings/:key` | 删除模板 | 需要 |

### 5.2 模板自动初始化

文件: `wuqi-backend/src/services/wechat-message.service.js` 中的 `ensureTemplateMappings()`

- 启动时自动扫描 `messageConfig.getMessageTemplates()` 的所有模板
- 如果 `templatefieldmappings` 集合中不存在对应 `template_key` → 自动创建
- 如果存在但 `template_id` 为空 → 用 `messageConfig` 中的默认值补全
- 作用：首次部署时数据库不空表

---

## 六、消息配置文件（messageConfig.js）

### 6.1 配置项

```javascript
{
  bookingSuccessTemplateId:     'mVdMRIYRRDRzk789Rw3Y6xUSo6fkkbTHuA1oicTlobE',
  classReminderTemplateId:      '',   // 需在微信后台添加后填入
  bookingCancelTemplateId:      'UICX8hELSZ_TCGg1Jdnd3nGkrn9dlk6qep6H9grWLgo',
  bookingCancelByUserTemplateId: 'XqKu4CwrDfI_Ju0-I_HIBtD1j4-tm4euWsFTPTZCEPE',  // ← V1.1.0.1c 修正
  waitlistAvailableTemplateId:  '',
  packageExpiringTemplateId:    '',
  packageActivatedTemplateId:   '',
  countCardLowRemindTemplateId: '',
  memberInactiveRemindTemplateId: '',
  phoneAuditResultTemplateId:   '5XXIA0wMTBDrqMMteN80EFvvooQKTqv5p2XIESRazus',
}
```

### 6.2 注意事项

- `messageConfig.js` 中的值仅用于 **自动初始化**（首次部署），运行时以数据库为准
- 管理端小程序修改后直接写库，不会修改此文件
- 但数据库一旦丢失（删库），此文件中的值会再次作为默认值使用

---

## 七、排错流程图（用户取消预约无通知时）

```
症状: 用户取消预约后未收到微信通知
  ↓
1. 查后端日志: pm2 logs wuqi | grep -i "errcode\|WeChatMessage"
  ├─ errcode=43101 → 用户未授权订阅 → 无需修复代码
  ├─ errcode=40037 → template_id 错误 → 执行 mongosh updateOne
  ├─ errcode=47003 → 某字段值为空 → 检查 biz_field 与 bizData key 映射
  ├─ 无 errcode 但无 WeChatMessage 日志 → sendBookingCancel 未被调用 → 检查 booking.service.js
  └─ errcode=0 但用户仍未收到 → 检查用户 openid 是否正确 / 微信后台是否已发布模板
  ↓
2. 查数据库: db.templatefieldmappings.find({template_key:'bookingCancelByUser'}).pretty()
  ↓
3. 查代码: grep "bookingCancelByUser\|'tipMessage'\|cancelReason" wuqi-backend/src/
  ↓
4. 确认重启: pm2 restart wuqi（清缓存）
  ↓
5. 再次测试
```

---

## 八、关键字段速查（消息通知场景）

### bookingCancelByUser（用户主动取消）

| 微信字段 | biz_field | bizData key | 来源 |
|---------|-----------|-------------|------|
| thing10 | courseName | courseName | schedule.course_name |
| name4 | coachName | coachName | schedule.coach_id.name |
| time13 | courseTime | courseTime | `${schedule.date} ${schedule.start_time}` |
| thing7 | cancelReason / tipMessage | cancelReason | reason 参数 / 默认 '已取消' |
| thing12 | storeName | storeName | schedule.store_id.name |

### bookingCancel（课程被取消）

| 微信字段 | biz_field | bizData key | 来源 |
|---------|-----------|-------------|------|
| thing1 | courseName | courseName | schedule.course_name |
| date4 | courseTime | courseTime | `${schedule.date} ${schedule.start_time}` |
| name5 | coachName | coachName | schedule.coach_id.name |
| thing2 | cancelReason | cancelReason | reason 参数（'人数不足' / '管理员取消'） |
| thing7 | storeName | storeName | schedule.store_id.name |

---

**本文档随 V1.1.0.1c 版本发布，用于回溯消息推送与预约取消流程的核心实现。**
