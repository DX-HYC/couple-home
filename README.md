# 💑 情侣小屋 · Couple Home

> 一个给情侣用的微信小程序：把两个人的小日子都记在一起 —— 纪念日、日记、相册、实时定位、点菜做饭、日程、喜好、愿望清单、经期记录……

*A WeChat Mini Program for couples to record their life together.*

---

## ✨ 功能特性

首页按三类组织共 **13 个页面**：

| 分组 | 功能 | 说明 |
|---|---|---|
| **记录我们** | 纪念日 | 支持阳历 / 农历，自动倒计时与到期提醒 |
| | 情侣日记 | 图文日记，支持心情、天气、定位标记，图片三列瀑布流 |
| | 情侣相册 | 分类相册，双方共享，支持批量上传 |
| **一起生活** | 点菜做饭 | 内置 **416 道**家常菜谱（带用量与分步做法）+ 自定义菜谱 + 互相点菜 |
| | 日程 | 约定日程，到点强提醒 |
| | 愿望清单 | 双方各写各的心愿，共享给对方 |
| **关心与日常** | TA 的喜好 | 记录对方爱吃的 / 想去的，点菜时一键标记 |
| | 实时位置 | 查看双方的实时位置与距离 |
| | 经期记录 | 经期记录与周期预测 |
| | 天气 | 实时本地天气与穿衣建议 |
| 其它 | 绑定情侣 | 邀请码绑定 / 解除，自动计算「在一起」天数 |
| | 我的 | 昵称、头像、登录状态管理 |

- **游客可先逛**：未登录也能看到首页品牌与天气，登录后再解锁情侣功能（符合审核合规）。
- **实时天气**基于 [Open-Meteo](https://open-meteo.com)，**完全免费、无需 API key**。
- **内置菜谱**源自开源项目 [HowToCook](https://github.com/Anduin2017/HowToCook)（The Unlicense，公共领域），共 416 道，离线可用。

---

## 🛠 技术架构

```
┌─────────────────────────────────────────────┐
│            微信小程序（前端）                  │
│  原生 WXML / WXSS / JS，无第三方 UI 框架       │
│  pages/* 13 个页面 · utils/* 工具与数据访问层   │
└───────────────┬─────────────────────────────┘
                │ @tencent-ai/workbuddy-cloud-sdk
                ▼
┌─────────────────────────────────────────────┐
│         WorkBuddy Cloud（后端）               │
│  · 身份认证：微信登录 (wx.login + signIn…)     │
│  · 数据库：PostgreSQL + PostgREST             │
│  · 行级安全：RLS（couple_id 隔离，二次校验）    │
│  · 文件存储：相册图片 / 视频                   │
└─────────────────────────────────────────────┘
```

- **前端**：原生微信小程序，UI 采用粉色系主题（`#ff6b81` 导航条、`#fff5f7` 背景）。
- **后端**：[WorkBuddy Cloud SDK](https://www.workbuddy.cn) —— 提供基于 PostgreSQL 的数据库、身份认证与文件存储，接口风格类似 Supabase（`cloud.database.from('表').select()`）。
- **数据隔离**：每一张情侣表都强制带 `couple_id` 查询条件，并由数据库 **RLS（行级安全）二次校验**，`couple_id` 必须属于当前用户所在的 `couples` 行，保证情侣之间互不可见。
- **天气**：`utils/weather.js` 直接请求 Open-Meteo 公开接口，无需后端中转、无需密钥。
- **订阅消息**：纪念日、点菜、愿望三类微信订阅消息，模板字段组装见 `utils/message.js`。

---

## 📁 目录结构

```
情侣小屋/
├── app.js / app.json / app.wxss      # 小程序入口与全局配置
├── project.config.json               # 项目配置（含 appid）
├── pages/                            # 13 个页面，每个含 .js/.wxml/.wxss/.json
│   ├── index/        # 首页（Hero + 天气 + 最近纪念日 + 功能网格）
│   ├── bind/         # 绑定 / 解绑情侣
│   ├── anniversary/  # 纪念日
│   ├── diary/        # 情侣日记
│   ├── album/        # 情侣相册
│   ├── location/     # 实时位置
│   ├── recipe/       # 点菜做饭（菜谱库）
│   ├── mine/         # 我的
│   ├── weather/      # 天气
│   ├── schedule/     # 日程
│   ├── preference/   # TA 的喜好
│   ├── cycle/        # 经期记录
│   └── wish/         # 愿望清单
├── utils/                            # 工具与数据访问层（核心逻辑）
│   ├── cloud.js      # 云服务初始化（endpoint + publishableKey）
│   ├── api.js        # 数据访问层：所有表的 CRUD 与 RLS 约定
│   ├── features.js   # 首页功能入口清单（分组 / 文案）
│   ├── recipes.js    # 内置 416 道菜谱（生成产物，勿手改）
│   ├── weather.js    # Open-Meteo 天气封装
│   ├── message.js    # 订阅消息内容组装
│   └── …             # 倒计时、农历、定位、上传、日志等
├── scripts/
│   └── build-recipes-from-howtocook.py  # 从 HowToCook 重新生成菜谱库
├── docs/                             # 更细的配置文档（域名 / 订阅消息 / 菜谱）
│   ├── 菜谱库说明.md
│   ├── 订阅消息配置指南.md
│   ├── 订阅消息服务端对接.md
│   ├── 平台后台域名配置.md
│   ├── 天气域名配置.md
│   └── 定位地名配置说明.md
└── tests/                            # Node 单元测试（18 套件）
    ├── project.test.js               # 全量静态检查（0 错误 0 警告）
    └── recipes.test.js 等
```

---

## 🚀 部署与配置（面向开发者）

### 1. 前置条件

- **微信开发者工具**（最新版）
- 一个**微信小程序 AppID**（在 [微信公众平台](https://mp.weixin.qq.com) 注册）
- 一个 **WorkBuddy Cloud** 云服务实例（在 WorkBuddy 平台为当前小程序开通云服务，得到 `endpoint` 与 `publishableKey`）

### 2. 获取代码

```bash
git clone <你的仓库地址>
cd <项目目录>
```

### 3. 配置云服务（必须）

编辑 `utils/cloud.js`，把示例值替换成你在 WorkBuddy 云平台开通云服务后得到的配置：

```js
const publicConfig = {
  endpoint: 'https://你的云服务地址',
  publishableKey: '你的 publishableKey'
}
```

> ⚠️ **切勿把真实的生产 `publishableKey` 提交到公开仓库**（见下方「开源前检查清单」）。

### 4. 配置小程序 AppID（必须）

编辑 `project.config.json`，将 `appid` 改为你自己的小程序 AppID：

```json
{ "appid": "你自己的小程序AppID" }
```

### 5. 配置服务器域名（必须）

在 **微信公众平台 → 开发 → 开发管理 → 开发设置 → 服务器域名** 中，把以下域名加入 **request 合法域名**：

| 域名 | 用途 |
|---|---|
| `https://mp-api.app.workbuddy.host` | WorkBuddy Cloud 接口 |
| `https://api.open-meteo.com` | 实时天气 |

> 本地调试可在「微信开发者工具 → 详情 → 本地设置」勾选「不校验合法域名」。详细见 `docs/平台后台域名配置.md`、`docs/天气域名配置.md`。

### 6. 配置订阅消息（可选）

若需要纪念日 / 点菜 / 愿望的微信订阅消息推送，需在公众平台「订阅消息 → 我的模板」中申请对应模板，并把模板 ID 填入 `utils/subscribe.config.js`。字段组装规则见 `utils/message.js` 与 `docs/订阅消息配置指南.md`。

### 7. 定位权限（可选）

`app.json` 已声明 `scope.userLocation` 与 `requiredPrivateInfos`（getLocation / chooseLocation）。首次使用定位功能时小程序会向用户申请授权。

### 8. 编译运行

用微信开发者工具打开项目根目录，编译即可预览。上传发布在微信开发者工具或 WorkBuddy 平台完成。

---

## 🗄 数据库表结构参考（需在云平台自行创建）

本仓库提供**数据访问层**（`utils/api.js`），其中约定了以下表与字段。它们需在你的 WorkBuddy Cloud 实例中创建，并配置对应的 **RLS 行级安全策略**。

| 表名 | 关键字段 | 说明 |
|---|---|---|
| `profiles` | `owner_id`(用户) · `owner_name` · `avatar_url` · `couple_id` · `couple_role` | 用户档案；更新策略只允许改自己的行 |
| `couples` | `user_a` · `user_b` · `invite_code` · `relation_date` · `relation_at` | 情侣关系；`user_a/user_b` 可为空表示待绑定 |
| `anniversaries` | `couple_id` · `title` · `calendar_type`(阳/农历) · `month` · `day` · `start_year` · `emoji` · `repeat_yearly` · `remind_days` | 纪念日 |
| `diaries` | `couple_id` · `owner_name` · `content` · `images`(数组) · `mood` · `weather` · `location_name` · `latitude` · `longitude` | 情侣日记 |
| `albums` | `couple_id` · `name` · `emoji` · `sort_order` | 相册分类 |
| `album_items` | `couple_id` · `album_id` · `media_type` · `file_path` · `thumb_path` · `width` · `height` · `remark` | 相册内容 |
| `locations` | `couple_id` · `owner_id` · `latitude` · `longitude` · `address` · `city` · `precision_m` · `address_manual` | 实时位置 |
| `recipe_orders` | `couple_id` · `recipe_id` · `dish_name` · `note` · `servings` · `status`(pending/done) · `done_at` · `cooker_id` | 互相点菜 |
| `recipes_custom` | `couple_id` · `name` · `emoji` · `category` · `taste` · `duration` · `servings` · `ingredients`(JSON) · `steps`(JSON) · `tips` | 双方自定义菜谱 |
| `reminders` | `couple_id` · `kind` · `title` · `body` · `link` · `remind_at` · `is_read` | 应用内提醒 |
| `subscriptions` | `owner_id` · `couple_id` · `template_id` · `subscribed` | 订阅消息开关 |
| `schedules` | `couple_id` · `title` · `category` · `event_date` · `event_time` · `repeat_rule` · `priority` · `remind_before` · `is_done` | 日程 |
| `preferences` | `couple_id` · `owner_name` · `category` · `title` · `detail` · `is_favorite` | 对方喜好 |
| `wishes` | `couple_id` · `owner_id` · `title` · `category` · `detail` · `target_date` · `status`(open/done) · `notified` | 愿望清单 |
| `cycles` | `couple_id` · `owner_name` · `start_date` · `end_date` · `cycle_length` · `period_length` · `flow` · `symptom` · `note` | 经期记录 |

**安全相关的服务端对象**（被 `api.js` 调用，但 SQL 不在本仓库，需在云平台以 `SECURITY DEFINER` 函数提供）：

- `find_couple_by_invite(p_code)` —— 绑定前绕过 RLS 查找邀请码
- `accept_invite(p_code)` —— 绑定动作，绕过 RLS 写入 `couples`
- `couples` 表的更新策略 `couples_update_member` —— 仅关系成员可更新

> 所有情侣表务必配置 RLS：**每行查询强制 `couple_id` 条件 + 数据库层二次校验**，且 `couple_id` 必须属于当前用户所在的 `couples` 行。这是数据隔离的底线，务必在云控制台核对。

---

## 🔐 安全与隐私

- **数据隔离**：情侣数据通过 `couple_id` 在应用层与数据库层（RLS）双重隔离，情侣之间互不可见。
- **凭据管理**：`utils/cloud.js` 的 `publishableKey` 属于**可公开**的发布密钥（publishable key），但为安全起见，开源时仍建议替换为占位符或自建实例的密钥；`project.config.json` 的 `appid` 务必替换为你自己的。
- **位置信息**：仅在用户明确授权后采集，用于展示双方距离与日记定位，不上传无关信息。

---

## 📖 使用说明

面向最终用户的详细使用指南见 **[docs/使用说明.md](docs/使用说明.md)**，涵盖：如何登录与绑定情侣、各功能模块怎么用、常见问题。

---

## 🧪 测试

项目自带 Node 单元测试（纯逻辑层，不依赖微信运行时）：

```bash
node --test tests/*.test.js      # 运行全部 18 套件
node tests/recipes.test.js       # 仅校验菜谱库数据完整性
node tests/project.test.js       # 全量静态检查（应 0 错误 0 警告）
```

测试覆盖：数据访问层字段映射、菜谱库完整性（字段齐全 / id 与菜名唯一 / 分类合法 / 分页逻辑）、首页功能清单一致性、各工具模块等。

---

## 🍳 重新生成菜谱库（可选）

内置菜谱来自 [HowToCook](https://github.com/Anduin2017/HowToCook)（The Unlicense）。`utils/recipes.js` 是**生成产物，不要手改**，改了会被重新生成覆盖。如需更新菜谱：

```bash
git clone --depth 1 https://github.com/Anduin2017/HowToCook.git
python scripts/build-recipes-from-howtocook.py <HowToCook路径> utils/recipes.js
node tests/recipes.test.js       # 生成后务必跑一次校验
```

生成规则与字段映射详见 `docs/菜谱库说明.md`。

---

## 📦 开源前检查清单

将本项目发布到公开仓库前，请确认：

- [ ] `utils/cloud.js` 中的 `publishableKey` 与 `endpoint` 已替换为占位符或你自己的实例配置
- [ ] `project.config.json` 中的 `appid` 已替换为你自己的小程序 AppID
- [ ] 已在 WorkBuddy Cloud 实例中创建上述数据表并配置 RLS 策略（或已在文档中说明）
- [ ] 微信公众平台已配置服务器域名（`mp-api.app.workbuddy.host`、 `api.open-meteo.com`）
- [ ] 如需订阅消息，已配置模板 ID（见 `utils/subscribe.config.js`）
- [ ] 添加 `.gitignore` 忽略 `node_modules/`、`miniprogram_npm/` 等
- [ ] 在仓库根目录放置 `LICENSE` 文件

---

## 📄 许可证与致谢

- **本项目代码**：采用 **MIT License**（见 [LICENSE](LICENSE)）。
- **内置菜谱数据**：来自 [HowToCook](https://github.com/Anduin2017/HowToCook)，许可为 **The Unlicense**（公共领域），可自由使用、修改、商用，无署名义务。菜谱页底部已标注来源。
- **天气数据**：来自 [Open-Meteo](https://open-meteo.com)，免费公开气象数据。
- 感谢以上开源项目与数据服务，让这个小工具得以快速成型。

---

Made with 💗 for couples.
