# 舞栖舞蹈社系统 V1.1.0.1c 版本修改记录

**版本号**: V1.1.0.1c
**发布日期**: 2026-06-18
**修改主题**: 消息推送模板配置修复（微信订阅消息：用户取消预约通知 & 模板ID管理页面输入框截断问题）
**修改人**: qedison-creator (Trae Solo CN 辅助开发)

---

## 一、修改背景

V1.1.0.1 版本中发现消息推送存在以下问题：

1. **会员端小程序用户取消预约后收不到通知**：
   - `bookingCancelByUser` 模板的 `thing7` 字段（温馨提示）在 `templatefieldmappings` 数据库中 `biz_field` 配置为 `tipMessage`，但代码中构建通知数据时使用的 key 是 `cancelReason`，导致 `data.thing7.value is empty`，微信接口返回 `errcode: 47003`。
   - `bookingCancelByUser` 的 `template_id` 在数据库中保存后被截断（末尾 `EPE` 丢失），导致微信接口返回 `errcode: 40037 invalid template_id`。

2. **管理端消息推送模板管理页面模板ID输入框可能被截断**：
   - `<input>` 未显式设置 `maxlength`，且代码中未做 `.trim()` 处理，粘贴后首尾空白或默认长度限制导致 `template_id` 不完整。

3. **管理端小程序与数据库中 template_id 不一致**：
   - 微信后台实际 template_id: `XqKu4CwrDfI_Ju0-I_HIBtD1j4-tm4euWsFTPTZCEPE`
   - 数据库中曾错误保存为: `XqKu4CwrDf1_Ju0-I_HIBtD1j4-tm4euWsFTPTZC`

---

## 二、代码文件修改清单

### 2.1 wuqi-backend/src/services/wechat-message.service.js

**修改点**: `bizFieldAliases` 对象中新增 `'tipMessage': 'cancelReason'` 映射。

**修改前**:
```javascript
const bizFieldAliases = {
  '取消原因': 'cancelReason',
  '提示信息': 'cancelReason',
  '温馨提示': 'cancelReason',
  // ...
};
```

**修改后**:
```javascript
const bizFieldAliases = {
  '取消原因': 'cancelReason',
  '提示信息': 'cancelReason',
  '温馨提示': 'cancelReason',
  'tipMessage': 'cancelReason',
  // ...
};
```

**目的**: 兼容管理端 `templatefieldmappings` 中 `mappings[i].biz_field = 'tipMessage'` 的配置，使 `buildWxData` 能正确从 `bizData.cancelReason` 取值。

**代码位置**: `wuqi-backend/src/services/wechat-message.service.js`, 约第 105-108 行

---

### 2.2 wuqi-backend/src/config/messageConfig.js

**修改点**: `bookingCancelByUserTemplateId` 更新为微信后台实际 template_id。

**修改前**:
```javascript
bookingCancelByUserTemplateId: 'XqKu4CwrDf1_Ju0-L_HIBtD1j4-tm4euWsFTPTZC',
```

**修改后**:
```javascript
bookingCancelByUserTemplateId: 'XqKu4CwrDfI_Ju0-I_HIBtD1j4-tm4euWsFTPTZCEPE',
```

**目的**: 使 `ensureTemplateMappings` 自动初始化时使用正确的 template_id（虽然实际以数据库 `templatefieldmappings` 表为准，但保持配置一致可避免后续初次部署时再次出现错误 ID）。

**代码位置**: `wuqi-backend/src/config/messageConfig.js`, 约第 10 行

---

### 2.3 wuqi-backend/src/routes/template-mapping.routes.js

**修改点**: `PUT /api/v1/template-mappings/:templateKey` 接口的 `template_id` 保存前加 `.trim()`。

**修改前**:
```javascript
template_id: template_id || '',
```

**修改后**:
```javascript
template_id: (template_id || '').trim(),
```

**目的**: 后端对模板ID做二次 trim 防护，避免管理端提交值首尾带空格/换行导致微信接口 40037。

**代码位置**: `wuqi-backend/src/routes/template-mapping.routes.js`, 约第 87 行

---

### 2.4 wuqi-admin/pages/settings/template-edit/template-edit.wxml

**修改点**: 模板ID输入框加 `maxlength="200"`，并新增 `bindblur="onIdBlur"`。

**修改前**:
```xml
<input class="input-field-mono" placeholder="请粘贴微信后台模板ID" value="{{item.template_id}}" data-index="{{index}}" catchtap="" bindinput="onIdInput" />
```

**修改后**:
```xml
<input class="input-field-mono" maxlength="200" placeholder="请粘贴微信后台模板ID" value="{{item.template_id}}" data-index="{{index}}" catchtap="" bindinput="onIdInput" bindblur="onIdBlur" />
```

**目的**: 明确声明 200 字符长度，避免微信小程序默认截断；失焦后再次确认值完整。

**代码位置**: `wuqi-admin/pages/settings/template-edit/template-edit.wxml`, 约第 55 行

---

### 2.5 wuqi-admin/pages/settings/template-edit/template-edit.js

**修改点1**: `onIdInput` 增加 `.trim()` 处理。

**修改前**:
```javascript
onIdInput(e) {
  const idx = e.currentTarget.dataset.index;
  this.setData({ [`templates[${idx}].template_id`]: e.detail.value });
},
```

**修改后**:
```javascript
onIdInput(e) {
  const idx = e.currentTarget.dataset.index;
  const val = (e.detail.value || '').trim();
  this.setData({ [`templates[${idx}].template_id`]: val });
},

onIdBlur(e) {
  const idx = e.currentTarget.dataset.index;
  const val = (e.detail.value || '').trim();
  this.setData({ [`templates[${idx}].template_id`]: val });
},
```

**修改点2**: `saveTemplate` 中发送的 `template_id` 加 `.trim()`。

**修改前**:
```javascript
template_id: template.template_id,
```

**修改后**:
```javascript
template_id: (template.template_id || '').trim(),
```

**目的**: 三重 trim 防护（输入时 / 失焦时 / 发送时），确保提交到后端的模板ID完整无空格。

**代码位置**: `wuqi-admin/pages/settings/template-edit/template-edit.js`, 约第 140-150 行（onIdInput/onIdBlur）+ 约第 218 行（saveTemplate）

---

### 2.6 package.json

**修改点**: `version` 从 `1.1.0.1` 更新为 `1.1.0.1c`。

```javascript
"version": "1.1.0.1c",
```

**目的**: 版本号标记此次修复发布，便于回溯。

**代码位置**: 项目根目录 `package.json`, 第 3 行

---

## 三、数据库修改清单

### 3.1 templatefieldmappings 集合

**操作**: 更新 `bookingCancelByUser` 的 `template_id` 和 `mappings[3].biz_field`。

**执行的 MongoDB 命令**:

```bash
mongosh
use wuqi_dance

# 1. 修正 template_id（完整正确值）
db.templatefieldmappings.updateOne(
  { template_key: 'bookingCancelByUser' },
  { $set: { template_id: 'XqKu4CwrDfI_Ju0-I_HIBtD1j4-tm4euWsFTPTZCEPE' } }
)

# 2. 修正 thing7 的 biz_field 映射（tipMessage -> cancelReason）
db.templatefieldmappings.updateOne(
  { template_key: 'bookingCancelByUser' },
  { $set: { 'mappings.3.biz_field': 'cancelReason' } }
)

# 验证
db.templatefieldmappings.find({template_key: 'bookingCancelByUser'}).pretty()
```

**预期验证结果**:
```
{
  template_key: 'bookingCancelByUser',
  template_id: 'XqKu4CwrDfI_Ju0-I_HIBtD1j4-tm4euWsFTPTZCEPE',
  template_name: '预约取消通知',
  mappings: [
    { field_name: '课程名称', wx_field: 'thing10', biz_field: 'courseName' },
    { field_name: '预约教练', wx_field: 'name4',  biz_field: 'coachName' },
    { field_name: '上课时间', wx_field: 'time13', biz_field: 'courseTime' },
    { field_name: '温馨提示', wx_field: 'thing7', biz_field: 'cancelReason' },
    { field_name: '上课地址', wx_field: 'thing12', biz_field: 'storeName' }
  ]
}
```

---

## 四、业务流程与调用链（消息推送核心链路）

### 4.1 用户取消预约 → 微信通知发送的完整调用链

```
会员端小程序 → 点击"取消预约"
  ↓
booking.service.js: exports.cancelBooking(userId, bookingId)
  ├─ 查询 booking（populate schedule_id → coach_id/store_id）
  ├─ 更新 booking.status = 'cancelled'
  ├─ 恢复会员课时（userpackages）
  └─ 调用 wechat-message.service.js: sendBookingCancel(user, schedule, reason, 'member', 'bookingCancelByUser')
       ↓
wechat-message.service.js: sendByTemplateKey(openid, 'bookingCancelByUser', bizData, ...)
  ├─ loadTemplateFromDB('bookingCancelByUser') → 从 templatefieldmappings 读取
  │    └─ 返回 { template_id, mappings: [{wx_field, biz_field}, ...] }
  ├─ buildWxData(mappings, bizData) → 组装 thing10/name4/time13/thing7/thing12
  │    └─ bizFieldAliases 中 'tipMessage' → 'cancelReason' 映射保障 thing7 有值
  └─ sendSubscribeMessage(openid, template_id, wxData, ...) → 调用微信 API
       ↓
微信接口: https://api.weixin.qq.com/cgi-bin/message/subscribe/send
  └─ 返回 { errcode: 0, errmsg: 'ok' }（成功）
```

### 4.2 课程被管理员取消 → 微信通知发送的完整调用链

```
管理端小程序 → 排课管理 → 取消排课
  ↓
schedule.service.js: exports.cancelSchedule(id, operatorId, reason)
  ├─ Schedule.findById(id).populate('coach_id', 'name').populate('store_id', 'name')
  ├─ 更新 schedule.status = 'cancelled'
  ├─ 遍历所有 bookings → 退还课时
  └─ 对每个 booking.user_id 调用 wechat-message.service.sendBookingCancel(...)
       └─ 使用 template_key: 'bookingCancel'（注意与 bookingCancelByUser 不同）
```

---

## 五、验证步骤与结果

### 5.1 前置条件

- 后端服务已重启: `pm2 restart wuqi`（清理模板缓存）
- 会员端小程序已在微信后台配置"订阅消息"模板并获取用户授权
- 数据库 `templatefieldmappings.bookingCancelByUser.template_id` 已修正为正确值

### 5.2 测试步骤

1. **会员端小程序**: 预约一门课程
2. **会员端小程序**: 在预约列表中点击"取消预约"
3. **微信聊天列表**: 观察是否收到"预约取消通知"消息
4. **查看后端日志**: `pm2 logs wuqi --lines 50 --nostream 2>&1 | grep -i "errcode\|cancel\|WeChatMessage"`

### 5.3 测试结果（2026-06-18）

✅ 用户取消预约后能正常收到微信订阅消息通知
✅ `errcode: 0` 正常返回（不再出现 47003 / 40037）
✅ 通知中显示正确的课程名称、教练、上课时间、温馨提示、门店地址

---

## 六、根因分析与修复逻辑总结

| 问题 | 根因 | 修复方案 |
|------|------|---------|
| `errcode: 47003 data.thing7.value is empty` | `mappings[3].biz_field='tipMessage'`，但 `bizData` 中 key 是 `cancelReason`；`bizFieldAliases` 缺少 'tipMessage' 的英文映射 | `wechat-message.service.js` 中 `bizFieldAliases` 新增 `'tipMessage': 'cancelReason'` |
| `errcode: 40037 invalid template_id` | 数据库中 `template_id` 末尾 `EPE` 丢失（曾为 `FTPTZC`） | 手动用 mongosh `updateOne` 修正为 `XqKu4CwrDfI_Ju0-I_HIBtD1j4-tm4euWsFTPTZCEPE` |
| 管理端模板ID输入框可能被截断 | `<input>` 未声明 `maxlength`，且未 trim | WXML 加 `maxlength="200"`，JS 中 onIdInput/onIdBlur/saveTemplate 均加 `.trim()` |
| 后端模板ID保存不一致 | `PUT /template-mappings/:key` 接口未对 template_id 做 trim | `template-mapping.routes.js` 中加 `(template_id || '').trim()` |
| messageConfig.js 中默认值错误 | `bookingCancelByUserTemplateId` 含数字1和旧末尾 | 更新为 `XqKu4CwrDfI_Ju0-I_HIBtD1j4-tm4euWsFTPTZCEPE` |

---

## 七、下次修改回溯指南

1. **若用户取消预约后收不到通知**:
   - 先查 `pm2 logs wuqi` 中的 `errcode`
   - `47003 = 字段值为空` → 查 `templatefieldmappings` 中 `biz_field` 与代码中 `bizData` key 是否匹配
   - `40037 = template_id无效` → 查数据库中 `template_id` 是否与微信后台一致
   - `43101 = 用户未授权` → 用户侧未订阅，非代码问题

2. **修改微信模板字段映射时**:
   - 在管理端"消息推送模板管理"页面修改 → 保存后 `pm2 restart wuqi`（或等待 60 秒缓存过期）
   - 关键判断：管理端配置的 `biz_field` 必须与 `wechat-message.service.js` 中 `buildWxData` 能取到的 key 一致，或在 `bizFieldAliases` 中配置别名

3. **核心文件索引**:
   - 业务数据构建: `wuqi-backend/src/services/wechat-message.service.js`（`sendBookingCancel` 等方法）
   - 字段映射别名: `wechat-message.service.js` 中 `bizFieldAliases` 对象
   - 默认模板ID: `wuqi-backend/src/config/messageConfig.js`
   - 管理端模板配置页面: `wuqi-admin/pages/settings/template-edit/`
   - 管理端模板保存 API: `wuqi-backend/src/routes/template-mapping.routes.js`
   - 数据库模型: `wuqi-backend/src/models/TemplateFieldMapping.js`
