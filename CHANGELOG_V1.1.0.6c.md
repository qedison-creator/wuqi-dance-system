# V1.1.0.6c 版本修改记录

发布日期：2026-07-23

## 一、版本号统一

- 管理端关于页面：`wuqi-admin/package-common/pages/about/about.js` 更新为 `V1.1.0.6c`
- 会员端关于页面：`wuqi-member/package-sub/pages/about/about.js` 更新为 `V1.1.0.6c`
- 根目录 `package.json` 更新为 `1.1.0.6c`
- 后端 `wuqi-backend/package.json` 更新为 `1.1.0.6c`

## 二、管理端（wuqi-admin）

### 1. 运营管理页（pages/operations/operations.js / .wxml / .wxss）
- 课程日志统计口径统一：课程卡片数字与课程日志面板标题数字使用同一套 classifyBooking 分类逻辑
- 课程取消预约分类调整：管理员取消/人数不足/中途取消的预约，保留在已预约列表，同时出现在已取消列表记录原因
- 用户自行取消的预约：不计入已预约，只在已取消列表显示
- 已预约列表 UI 优化：课程已取消时显示"已退还X次 + 取消原因标签"，无签到/取消按钮
- 已取消列表改为上下布局，取消原因用橙色标签突出显示
- 已预约列表改为上下布局，避免内容挤压

### 2. 会员详情页（package-member/pages/members/member-detail/）
- 手机号脱敏显示：默认显示 138****1234 格式
- 非审核员角色可通过小眼睛按钮切换脱敏/全号码显示
- 审核员角色仅能查看脱敏号码，无切换按钮

### 3. 预建档管理页（package-member/pages/pre-member/pre-member-list.*）
- 手机号脱敏显示，与会员管理页保持一致
- 小眼睛按钮切换脱敏/全号码，审核员角色不可切换
- 批量删除改为循环调用单条删除接口，兼容旧版后端
- 编辑预建档修复老会员漏传 isOldMember 参数导致提示"新会员必须填写套餐有效期时长"的问题
- 布局优化，避免内容挤压

### 4. 公告管理页（package-shop/pages/announcements/announcements.wxml / .wxss）
- 列表卡片重构为左右双列布局，避免长文字导致排版混乱
- 左侧固定状态点列，右侧内容区使用 view 组件承载 flex 布局
- 标题支持 word-break 换行，内容限制 3 行省略

### 5. 会员管理页（pages/members/members.js）
- 预建档会员卡片数字字段修正：从 pending_claim_count 改为 pending_count，与后端返回字段一致

## 三、后端（wuqi-backend）

### 1. 数据脱敏中间件（src/middleware/dataMasking.js）
- 审核员角色的自身账号名称（nick_name、username 等）不脱敏显示
- 其他账号仍正常脱敏，确保信息安全

### 2. 预建档服务（src/services/preMember.service.js）
- 门店名称模糊匹配：支持全角/半角括号等价转换
- 关键词双向包含匹配：输入"固戍""固戍店"可匹配"舞栖舞蹈社（固戍店）"
- 编辑预建档时补传 isOldMember 参数，与创建逻辑保持一致

### 3. 预建档路由（src/routes/preMember.routes.js）
- cleanStoreName 函数增加括号规范化处理，与 fuzzyMatchStoreName 保持一致

### 4. 提醒服务（src/services/reminder.service.js）
- 会员不活跃提醒文案优化：从"您已超过XX天未预约课程"改为"您有XX天没有跳舞了哦"

### 5. 配置路由（src/routes/config.routes.js）
- 模板字段示例值同步更新不活跃提醒文案

## 四、会员端（wuqi-member）

### 1. 订阅设置页（package-sub/pages/subscribe-settings/subscribe-settings.wxss）
- 永久订阅（总是保持）显示"✓ 已订阅"（绿色）
- 一次性授权显示"已授权(一次性)"（橙色）
- 两种订阅状态视觉区分明确

## 五、核心业务逻辑说明

### 预约分类统一规则（classifyBooking）
- **已预约**：booked + checked_in / completed + 课程取消（admin_cancel / min_bookings_not_met / holiday / after_checkin_cancel）
- **已签到**：checked_in + completed
- **已取消**：用户自行取消 + 豁免取消 + 课程取消（记录原因）

### 课程取消场景的预约记录
- 管理员手动取消、人数不足自动取消、课程中途取消：用户保留在已预约列表，同时在已取消列表记录原因
- 用户自行取消：不计入已预约，只在已取消列表显示
- 已预约列表中课程取消的条目显示"已退还X次"和取消原因标签，不可操作

### 手机号脱敏规则
- 默认显示脱敏格式（138****1234）
- 非审核员角色可通过小眼睛按钮切换显示原始号码
- 审核员角色仅能查看脱敏号码，自身账号名称不脱敏
