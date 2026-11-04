# 两人食 · 双人私密伙食簿

只给两个人用的 PWA：伙食打卡、评论回复、今天吃什么、饭点推送。
Vue 3 + Tailwind CSS + Supabase + Vercel，支持 iPhone 添加到主屏幕与离线浏览。

## 功能

- **打卡时间流**：相册选图 / 现场拍照，自动压缩上传，照片私有存储
- **评论与回复**：Supabase Realtime，对方发完立刻可见
- **今天吃什么**：共享菜单、标签屏蔽、收藏、随机抽签
- **饭点提醒**：多组自定义时间 + 自定义文案，Edge Function + pg_cron 定时推送
- **留言板**：两人专属的简短留言
- **PWA**：manifest、Service Worker、iOS 启动页、离线缓存已看过的打卡
- **安全**：RLS 全表保护，仅白名单里的两个邮箱可访问，照片桶私有

## 技术栈

| 层 | 方案 |
| --- | --- |
| 前端 | Vue 3、Vue Router、Tailwind CSS 3、Vite |
| 后端 / 数据库 | Supabase（Postgres + Auth + Storage + Realtime） |
| 定时推送 | Supabase Edge Function（Deno）+ pg_cron + pg_net + Web Push |
| 托管 | Vercel（自动 HTTPS） |

## 快速开始

```bash
npm install
cp .env.example .env.local   # 填入 Supabase URL / anon key / VAPID 公钥
npm run dev
```

数据库、权限、推送、Vercel 与 iPhone 配置请按 **[DEPLOY.md](./DEPLOY.md)** 一步步执行。

## 目录

```
src/
├── views/        # 首页 / 打卡 / 吃什么 / 留言 / 设置 / 登录
├── components/   # 打卡卡片、评论、弹层、底部导航
├── lib/          # supabase、auth、push、图片压缩、离线缓存
└── router/
public/
├── sw.js         # 离线缓存 + 推送展示
├── manifest.webmanifest
├── icons/        # PWA 图标
└── splash/       # iOS 启动页
supabase/
├── setup.sql                       # 建表 + RLS + Storage + Realtime
└── functions/send-reminders/       # 定时推送
```

## 说明

- 仅支持两个预设账号；注册由数据库触发器 + 白名单拦截。
- anon key 可以公开，权限完全由 RLS 控制；service_role key 与 VAPID 私钥只存在服务端。
- iOS 需 16.4+，且必须从主屏幕图标打开才能接收通知。
