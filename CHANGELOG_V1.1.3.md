# V1.1.3 版本修改记录

发布日期：2026-09-24

## 一、版本号统一

- 管理端关于页面：`wuqi-admin/package-common/pages/about/about.js` 更新为 `V1.1.3`
- 会员端关于页面：`wuqi-member/package-sub/pages/about/about.js` 更新为 `V1.1.3`
- 根目录 `package.json`、后端 `wuqi-backend/package.json` 更新为 `1.1.3`

## 二、功能说明：教练按门店排序与任教管理（资源库模式）

**核心模型**：「多门店执教教练管理」定位为全平台共享的**教练资源库**（仅维护基础资料，仅超管可操作，不提供排序功能）；各门店管理员在「门店教练」页对**本店教练 + 资源库共享教练的合并列表**统一管理：

- **显示顺序**（上移/下移）：调整结果即时反映在该门店会员端首页「舞栖教练」与教练列表页
- **是否在本店任教**（开关）：关闭后该教练不再出现在该门店会员端（首页/教练列表），管理端列表沉底显示、可随时恢复

## 三、后端（wuqi-backend）

### 1. 教练模型（src/models/Coach.js）
- 新增内嵌数组 `store_configs: [{ store_id, sort_order, is_teaching, updated_at, updated_by }]`，按门店存储展示配置
- 某门店无配置元素时回退教练级全局值（`sort_order` / `is_teaching` 默认 true），存量数据无需迁移

### 2. 教练服务（src/services/coach.service.js）
- 新增 `resolveStoreConfig`：解析教练在某门店的有效展示配置（门店值覆盖、全局值回退）
- 新增 `upsertStoreConfig`：两步原子写（定位元素 `$set` → 未命中 `$push`，含并发兜底）
- 新增 `reorderStoreConfigs`：按传入完整顺序批量重写某门店的教练排序（sort=序号）
- 权限校验 `assertCanManageStoreConfig`：超管不限、店长需 ∈ store_ids、员工需 === store_id；教练需为该店独占或资源库共享教练
- `getCoachList` 管理端分支：支持 `store_id` 参数，每条教练附带解析后的 `store_config`
- `getCoachList` 会员端分支：过滤 `is_teaching=false` 与全局 `show_on_home=false` 的教练，按门店有效排序，`select('-phone')` 防手机号泄漏

### 3. 教练路由（src/routes/coach.routes.js）
- 新增 `PUT /coaches/:id/store-config`：更新教练在某门店的任教状态/排序
- 新增 `PUT /coaches/store-configs/reorder`：按门店批量重排教练展示顺序

### 4. 首页教练接口（src/routes/home.routes.js `GET /home/coaches`）
- 取全量（上限 200）后按门店展示配置过滤与排序（原先仅在 DB 层按全局 sort_order 截取）
- **顺带修复历史遗留缺陷**：教练资料上的全局「首页展示」开关（`show_on_home`）此前在会员端从未生效，本版本起真正生效——设为关闭的教练将从所有门店会员端隐藏
- 响应不再返回教练手机号

## 四、管理端（wuqi-admin）

### 1. 门店教练页（package-shop/pages/coaches/）— 核心改造
- 列表改为**合并列表**：本店教练 + 资源库共享教练（多门店执教）一起展示，按本店有效排序显示「第 n 位」（所见即会员端顺序）
- 每张教练卡新增**本店任教开关**（关闭即会员端隐藏，卡片沉底弱化显示「未在本店任教·会员端隐藏」）与**上移/下移排序按钮**
- 排序与任教开关对本店所有有教练权限的角色开放（含多门店执教教练）；教练资料编辑/删除/启停权限不变（多门店执教教练仍仅超管）
- 审核员（reviewer）只读：排序与开关禁用
- 顶部提示当前门店；未选门店时明确提示；编辑弹窗中全局排序/全平台展示字段补充说明文案
- 原「首页展示」标签改为「全平台展示」，与门店级任教开关区分

### 2. 多门店执教教练页（package-shop/pages/public-coaches/）
- 定位为纯资源库：顶部新增说明「各门店的显示顺序与是否任教，请在『店务管理 → 门店教练』页按门店调整」，功能不变

## 五、会员端（wuqi-member）

- 无代码改动：排序与任教可见性全部由后端 `/home/coaches` 接口层实现

## 六、验证

- `node --check` 全部通过
- 本地 MongoDB 冒烟测试（`wuqi-backend/scripts/smoke-store-config.js`，独立测试库 wuqi_dance_smoke_test）：19/19 通过
  - 覆盖：合并列表与 store_config 回退、跨店权限拒绝、任教开关保存、会员端隐藏/排序/全局开关生效、门店间配置隔离、批量重排、管理端配置状态回显
