# V1.1.0.8 版本修改记录

发布日期：2026-08-04

## 一、版本号统一

- 管理端关于页面：`wuqi-admin/package-common/pages/about/about.js` 更新为 `V1.1.0.8`
- 会员端关于页面：`wuqi-member/package-sub/pages/about/about.js` 更新为 `1.1.0.8`
- 根目录 `package.json` 更新为 `1.1.0.8`
- 后端 `wuqi-backend/package.json` 更新为 `1.1.0.8`

## 二、后端（wuqi-backend）

### 1. 微信推送修复（src/services/booking.service.js、src/utils/scheduler.js）
- **取消预约门店名称修复**：`adminCancelBooking` 函数添加 `.populate('store_id', 'name')`，确保取消通知正确显示门店名称（原先显示"门店信息"）
- **清理定时提醒任务**：`adminCancelBooking` 函数添加 `PendingTask.deleteMany` 主动清理，避免会员被取消预约后仍收到开课提醒
- **调度器兜底校验**：`scheduler.js` 发送开课提醒前，查询用户是否仍有 `status: 'booked'` 的有效预约，无有效预约则跳过发送

### 2. 门店隔离中间件（src/middleware/storeFilter.js、src/middleware/auth.js）
- 完善 `storeFilter` 中间件，支持单门店角色（store_manager/staff）的数据隔离
- 单门店角色仅能查看、访问、操作所属门店的数据
- 超级管理员、审核员权限不受影响
- 新增 `src/middleware/checkRecordOwnership.js` 和 `src/utils/storeOwnership.js` 用于记录归属校验

### 3. 教练薪酬服务（src/services/coach-salary.service.js、src/routes/coach-salary.routes.js）
- **保存失败修复**：`createCoachSalary` 方法检查到已存在（含软删除）相同配置时恢复而非新建，避免唯一索引 `{ coach_id, store_id, duration }` 冲突
- **批量删除功能**：新增 `batchDeleteCoachSalary` 方法和 `POST /coach-salaries/batch-delete` 路由，支持一次性删除教练的所有薪酬配置
- **门店维度区分**：CoachSalary 唯一索引支持同教练不同门店不同薪酬配置
- 修复 `getMonthlySalaryBreakdown` 中 `rateMap` 未定义的 bug

### 4. 会员服务（src/services/member.service.js、src/services/package.service.js）
- 会员删除时将所有 active UserPackage 标记为 expired，避免悬空记录
- 会员删除前将快照信息回填到 UserPackage、PackageActivation、PackageExtension 表
- 提醒服务三个函数过滤 `member_status` 为 'official' 的会员
- 套餐记录查询采用 populate 失败回退 snapshot 策略，标记 `user_deleted`
- 套餐录入记录直接从 UserPackage 表查询，清理历史遗留虚假记录

### 5. 其他后端修改
- **教练服务**（src/services/coach.service.js）：支持门店维度区分，存量教练为多门店执教
- **图片服务**（src/services/image.service.js）：新增 `gallery_type` 参数，区分公共/门店画册，单门店角色不可转移图片到非所属门店
- **放假管理**（src/services/holiday.service.js）：单门店角色权限开放
- **排课服务**（src/services/schedule.service.js）：冲突检测排除模板预览项，下线课程过滤
- **WebSocket 服务**（src/services/websocket.service.js）：账号在线状态实时推送
- **配置路由**（src/routes/config.routes.js）：预约开放设置 `booking_window_days` 为全局配置

## 三、管理端（wuqi-admin）

### 1. 店务管理门店区分（pages/shop/、package-shop/）
- 店务管理主页顶部增加统一门店选择器（单门店角色不显示）
- 子页面从全局状态 `app.globalData.shopStoreId` 读取选中门店ID
- 移除子页面内部门店筛选，统一通过全局门店选择器
- 涉及页面：轮播图管理、公告管理、教练管理、薪酬管理、图片管理、门店维护、放假管理、豁免设置

### 2. 教练管理页面（package-shop/pages/coaches/）
- **移除"门店管理"入口**：仅保留店务管理页面系统设置分类下的"门店维护"入口
- 单门店角色操作多门店执教教练时，前端提前禁用相关操作按钮
- 单门店角色页面明确显示教练是否为多门店执教状态

### 3. 教练薪酬配置（package-shop/pages/salary/）
- **保存失败修复**：配合后端恢复软删除记录逻辑
- **删除整教练配置**：`onDeleteConfig` 方法收集教练所有配置ID，调用批量删除接口
- 删除按钮数据绑定从 `data-id` 改为 `data-item`，传递整个教练组对象
- 单门店角色仅能查看所属门店的教练课时及薪酬统计数据

### 4. 会员详情页（package-member/pages/members/member-detail/）
- **TAB 布局**：新增"预约记录"与"上课记录"TAB，默认选中预约记录
- **上课记录**：包含累计上课总量统计及按年月折叠分组的卡片列表
- 懒加载策略，仅在首次切换到该TAB时请求数据
- 通过 `GET /attendance/member/:user_id` 接口获取数据
- 复用门店隔离校验逻辑，单门店角色仅能查看所属门店会员记录

### 5. 排课设置页面（package-schedule/pages/schedule/）
- **间距修复**：月视图新增排课按钮添加 `margin-bottom: 20rpx`，增加与下方课程卡片的间距
- **卡片间距优化**：`schedule-list` 的 `gap` 从 `20rpx` 减小到 `16rpx`
- 星期视图批量排课使用单弹窗完成，无多步导航
- 没有排课的星期不可选中（视觉变灰 + 点击提示）

### 6. 门店选择器统一（pages/dashboard/、pages/operations/、pages/shop/）
- 门店选择器仅在3个入口显示：首页、运营管理、店务管理
- 单门店角色不显示门店选择器，点击保持不变
- 单门店角色管理端首页待办事项、数据看板、预约记录仅显示所属门店数据

### 7. 账号管理页（package-settings/pages/settings/accounts/）
- WebSocket 推送方案实时更新在线状态
- 在线状态小圆点颜色：在线 #52C41A（绿色），离线 #D9D9D9（灰色），0.3s 过渡动画
- 状态变化时仅局部更新，不影响列表分页、搜索筛选、编辑弹窗状态及滚动位置

### 8. 套餐记录查询（package-shop/pages/package-logs/）
- 已删除会员/套餐的激活记录、套餐录入记录完整显示原始信息，标注"已删除"
- 分页加载：每次显示5条，点击"查看更多"按钮加载下5条
- 显示≥10条时右下角显示圆形返回顶部按钮
- 顶部筛选区域使用 `position: sticky` 固定

### 9. 其他管理端修改
- **会员管理/预建档管理**：手机号脱敏显示，分页加载，sticky 筛选区
- **预约开放设置**：单门店角色访问返回403时显示"权限不足"而非"网络连接失败"
- **扫码签到**：单门店角色仅查看所属门店课程，扫码非所属门店会员提示无权限
- **request.js**：400业务错误判断 `isHandledBusinessError`，避免重复提示
- **个人中心**：可管理门店标签与角色标签同行显示
- **豁免设置**：单门店角色开放权限，仅能设置所属门店及会员

## 四、会员端（wuqi-member）

### 1. WebSocket 连接优化（utils/websocket-client.js）
- 连接建立前调用 `_closeSocketTask()` 关闭旧连接，避免"未完成的操作"错误
- 10秒超时保护，超时后主动关闭并重连
- `connectionId` 连接代次机制，旧连接回调直接忽略
- 心跳超时/发送失败时先关闭无响应连接再重连
- `_handleDisconnect()` 仅置空引用不调用 close()
- `isDisconnecting` 防重入标志，确保重连逻辑仅执行一次
- `onError` 仅记录日志，断连处理统一由 `onClose` 触发

### 2. 首页数据刷新（pages/index/）
- 门店切换时刷新画册图片，传递 `store_id` 参数
- 重置画册加载标志

### 3. 个人中心（pages/profile/）
- WebSocket 推送方案即时更新审核结果
- 新注册已审核通过用户预留手机号未提交时显示"未录入"而非"未绑定"

### 4. 场次预约（pages/booking/）
- 查询课程过滤条件为 `$nin: ['deleted', 'offline']`，下线课程不显示

## 五、业务逻辑要点

### 1. 门店隔离规则
- 单门店角色（store_manager/staff）：仅能操作所属门店数据，无门店选择器
- 超级管理员、审核员：权限不受影响，可操作所有门店
- 存量教练为多门店执教，仅超管可删除/编辑
- 后期店长可自行添加所属门店教练

### 2. 课程下线功能
- 已完成课程无论有无预约/签到记录，均允许"下线"
- 可预约/进行中课程有预约时仅允许"取消"
- "下线"仅修改 `schedule.status` 为 'offline'，不影响任何数据
- 会员端场次预约过滤下线课程
- 管理端生成课程表过滤下线/取消课程

### 3. 预约状态保留
- 管理端课程预约名单保留原始状态
- 已预约显示在"已预约"标签页，已签到显示在"已签到"标签页
- 不自动转换状态

### 4. 数据完整性
- 会员删除时所有 UserPackage 标记为 expired
- 会员快照信息回填到相关记录表
- 已删除会员的记录完整显示原始信息，标注"已删除"
