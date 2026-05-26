# 舞栖舞蹈社 API 文档

## 基础信息

- **Base URL**: `http://localhost:3000/api/v1`
- **认证方式**: JWT Token
- **数据格式**: JSON

## 通用响应格式

### 成功响应
```json
{
  "code": 200,
  "message": "操作成功",
  "data": {}
}
```

### 分页响应
```json
{
  "code": 200,
  "message": "查询成功",
  "data": {
    "list": [],
    "total": 100,
    "page": 1,
    "pageSize": 20
  }
}
```

### 错误响应
```json
{
  "code": 400,
  "message": "错误信息",
  "data": null
}
```

## 认证说明

所有需要认证的接口需要在请求头中携带：

```
Authorization: Bearer <token>
```

---

## API 接口列表

### 1. 认证相关

#### 1.1 微信登录 (会员端)
- **POST** `/auth/wx-login`
- **描述**: 微信小程序登录

#### 1.2 管理员登录
- **POST** `/auth/admin-login`
- **描述**: 管理端账号密码登录

#### 1.3 获取当前用户信息
- **GET** `/auth/me`
- **认证**: 需要
- **描述**: 获取当前登录用户信息

---

### 2. 会员管理

#### 2.1 获取会员列表
- **GET** `/members`
- **认证**: 需要 (管理员/店长/店员)
- **查询参数**:
  - `status`: 会员状态
  - `keyword`: 搜索关键词
  - `store_id`: 门店ID
  - `page`: 页码
  - `pageSize`: 每页数量

#### 2.2 获取会员详情
- **GET** `/members/:id`
- **认证**: 需要 (管理员/店长/店员)

#### 2.3 更新会员信息
- **PUT** `/members/:id`
- **认证**: 需要 (管理员/店长)

#### 2.4 审核会员
- **PUT** `/members/:id/review`
- **认证**: 需要 (管理员/店长/店员)
- **请求体**:
  ```json
  {
    "action": "approve|reject",
    "reason": "审核原因",
    "store_id": "门店ID"
  }
  ```

#### 2.5 设置豁免次数
- **PUT** `/members/:id/exemption`
- **认证**: 需要 (管理员/店长/店员)

#### 2.6 获取豁免记录
- **GET** `/members/:id/exemption-logs`
- **认证**: 需要 (管理员/店长/店员)

#### 2.7 停卡
- **PUT** `/members/:id/suspend`
- **认证**: 需要 (管理员/店长/店员)

#### 2.8 复卡
- **PUT** `/members/:id/unsuspend`
- **认证**: 需要 (管理员/店长/店员)

#### 2.9 分配会员编码
- **PUT** `/members/:id/assign-code`
- **认证**: 需要 (管理员/店长/店员)

#### 2.10 会员更新个人信息
- **PUT** `/members/profile/update`
- **认证**: 需要 (会员)

#### 2.11 检查信息完整度
- **GET** `/members/:id/info-status`
- **认证**: 需要

#### 2.12 申请修改预留手机号
- **POST** `/members/reserve-phone/request`
- **认证**: 需要 (会员)

#### 2.13 获取待审核手机号列表
- **GET** `/members/phone-audit/list`
- **认证**: 需要 (管理员/店长/店员)

#### 2.14 审核预留手机号
- **PUT** `/members/:id/phone-audit`
- **认证**: 需要 (管理员/店长)

#### 2.15 获取会员统计
- **GET** `/members/stats/overview`
- **认证**: 需要 (管理员/店长/店员)

---

### 3. 套餐管理

#### 3.1 获取我的套餐
- **GET** `/packages/my`
- **认证**: 需要 (会员)

#### 3.2 获取套餐模板列表
- **GET** `/packages`
- **认证**: 需要 (管理员/店长/店员)

#### 3.3 获取套餐模板详情
- **GET** `/packages/:id`
- **认证**: 需要 (管理员/店长/店员)

#### 3.4 创建套餐/录入用户套餐
- **POST** `/packages`
- **认证**: 需要 (管理员/店长/店员)
- **请求体**:
  ```json
  {
    "user_id": "用户ID(录入套餐时必填)",
    "package_id": "套餐模板ID",
    "package_type": "count_card|time_card",
    "total_credits": 10,
    "duration_value": 30,
    "duration_unit": "day|month"
  }
  ```

#### 3.5 更新套餐
- **PUT** `/packages/:id`
- **认证**: 需要 (管理员/店长/店员)

#### 3.6 删除套餐模板
- **DELETE** `/packages/:id`
- **认证**: 需要 (超级管理员)

#### 3.7 激活套餐
- **PUT** `/packages/activate`
- **认证**: 需要 (会员)

#### 3.8 删除用户套餐
- **DELETE** `/packages/user/:id`
- **认证**: 需要 (管理员/店长/店员)

#### 3.9 获取激活记录
- **GET** `/packages/activation-records`
- **认证**: 需要 (管理员/店长/店员)

#### 3.10 获取延长记录
- **GET** `/packages/extension-records`
- **认证**: 需要 (管理员/店长/店员)

#### 3.11 延长套餐
- **PUT** `/packages/:id/extend`
- **认证**: 需要 (管理员/店长/店员)

#### 3.12 撤销套餐延长
- **PUT** `/packages/extension-records/:id/revoke`
- **认证**: 需要 (管理员/店长)

#### 3.13 获取会员套餐状态
- **GET** `/packages/member-status/:user_id`
- **认证**: 需要

#### 3.14 刷新套餐状态
- **PUT** `/packages/refresh-status`
- **认证**: 需要 (管理员/店长/店员)

---

### 4. 预约管理

#### 4.1 创建预约
- **POST** `/bookings`
- **认证**: 需要 (会员)
- **请求体**:
  ```json
  {
    "schedule_id": "排课ID"
  }
  ```

#### 4.2 取消预约
- **PUT** `/bookings/:id/cancel`
- **认证**: 需要 (会员)

#### 4.3 获取我的预约
- **GET** `/bookings/my`
- **认证**: 需要 (会员)

#### 4.4 获取我的签到记录
- **GET** `/bookings/my-attendance`
- **认证**: 需要 (会员)

#### 4.5 获取预约列表
- **GET** `/bookings`
- **认证**: 需要 (管理员/店长/店员)

#### 4.6 加入候补
- **POST** `/bookings/waitlist`
- **认证**: 需要 (会员)

#### 4.7 获取我的候补列表
- **GET** `/bookings/waitlist/my`
- **认证**: 需要 (会员)

#### 4.8 取消候补
- **DELETE** `/bookings/waitlist/:id`
- **认证**: 需要 (会员)

#### 4.9 候补确认预约
- **PUT** `/bookings/waitlist/confirm/:id`
- **认证**: 需要 (会员)

#### 4.10 获取预约详情
- **GET** `/bookings/:id`
- **认证**: 需要 (管理员/店长/店员)

#### 4.11 管理员取消预约
- **PUT** `/bookings/:id/admin-cancel`
- **认证**: 需要 (管理员/店长/店员)

#### 4.12 单会员签到
- **POST** `/bookings/check-in`
- **认证**: 需要 (管理员/店长/店员)
- **请求体**:
  ```json
  {
    "schedule_id": "排课ID",
    "user_id": "会员ID"
  }
  ```

#### 4.13 批量签到
- **POST** `/bookings/batch-check-in`
- **认证**: 需要 (管理员/店长/店员)
- **请求体**:
  ```json
  {
    "schedule_id": "排课ID",
    "user_ids": ["会员ID1", "会员ID2"]
  }
  ```

#### 4.14 获取签到记录
- **GET** `/bookings/check-in-records/:schedule_id`
- **认证**: 需要 (管理员/店长/店员)

#### 4.15 检查低人数课程
- **POST** `/bookings/check-low-attendance`
- **认证**: 需要 (管理员/店长/店员)

#### 4.16 批量检查低人数课程
- **POST** `/bookings/batch-check-low-attendance`
- **认证**: 需要 (管理员/店长/店员)

---

### 5. 教练薪酬管理

#### 5.1 获取薪酬配置列表
- **GET** `/coach-salaries`
- **认证**: 需要 (管理员/店长/店员)

#### 5.2 获取薪酬配置详情
- **GET** `/coach-salaries/:id`
- **认证**: 需要 (管理员/店长/店员)

#### 5.3 创建薪酬配置
- **POST** `/coach-salaries`
- **认证**: 需要 (管理员/店长)
- **请求体**:
  ```json
  {
    "coach_id": "教练ID",
    "store_id": "门店ID",
    "duration": 60,
    "salary_rate": 100,
    "effective_from": "2026-01-01",
    "remark": "备注"
  }
  ```

#### 5.4 更新薪酬配置
- **PUT** `/coach-salaries/:id`
- **认证**: 需要 (管理员/店长)

#### 5.5 删除薪酬配置
- **DELETE** `/coach-salaries/:id`
- **认证**: 需要 (超级管理员)

#### 5.6 获取薪酬统计列表
- **GET** `/coach-salaries/stats/list`
- **认证**: 需要 (管理员/店长/店员)

#### 5.7 获取薪酬汇总
- **GET** `/coach-salaries/stats/summary`
- **认证**: 需要 (管理员/店长/店员)

#### 5.8 生成薪酬统计
- **POST** `/coach-salaries/stats/generate`
- **认证**: 需要 (管理员/店长/店员)

#### 5.9 结算薪酬
- **PUT** `/coach-salaries/stats/:id/settle`
- **认证**: 需要 (管理员/店长)

#### 5.10 取消薪酬统计
- **PUT** `/coach-salaries/stats/:id/cancel`
- **认证**: 需要 (管理员/店长)

---

### 6. 其他接口

项目还包含以下模块的接口：
- 排课管理 (`/schedules`)
- 门店管理 (`/stores`)
- 教练管理 (`/coaches`)
- 放假管理 (`/holidays`)
- 舞种管理 (`/dance-styles`)
- Banner管理 (`/banners`)
- 视频管理 (`/videos`)
- 操作日志 (`/logs`)
- 数据统计 (`/stats`)
- 文件上传 (`/upload`)

具体使用方法请参考对应路由文件。
