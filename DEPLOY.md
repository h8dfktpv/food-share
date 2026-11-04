# 两人食 · 部署手册

从零到上线：Supabase（数据库 / 权限 / 图片 / 推送）→ Vercel（HTTPS 托管）→ iPhone / 华为添加到主屏幕。

> 这套应用只允许 **两个固定邮箱** 登录，所有数据由 RLS（行级安全）保护。任何第三方账号、匿名访问都读不到打卡、照片、留言和菜单。

---

## 0. 准备清单

| 需要 | 说明 |
| --- | --- |
| 两个邮箱 | 你和对方各自的邮箱，后面要写进白名单 |
| Supabase 账号 | 免费版足够（2 人使用量很小） |
| Vercel 账号 | 免费 Hobby 套餐即可，自带 HTTPS |
| Node.js 18+ | 本地构建，以及运行 Supabase CLI |
| Supabase CLI | `npm i -g supabase`，或用 `npx supabase` |
| 两台手机 | iPhone 需 iOS 16.4+ 才支持 Web Push；华为用 Chrome |

> 重要限制：**iOS 的 Web Push 必须把网站「添加到主屏幕」后，从桌面图标打开才能订阅通知**。Safari 网页标签页里无法接收推送。这是 Apple 的限制，不是代码问题。

---

## 1. 创建 Supabase 项目

1. 打开 [supabase.com](https://supabase.com)，新建项目。
2. 记下三个值（Project Settings → API）：
   - `Project URL`，形如 `https://abcdefgh.supabase.co`
   - `anon public` key
   - `service_role` key（**只用于服务端，绝不写进前端环境变量**）
3. 在 **Database → Extensions** 中确认 `pg_cron`、`pg_net` 已开启（后面定时推送要用）。
4. 在 **Storage** 中确认脚本执行后会出现私有桶 `checkin-photos`。

---

## 2. 建表、RLS、存储策略（完整 SQL）

打开 **SQL Editor → New query**，先把脚本开头的两个邮箱改成你们自己的：

```sql
insert into public.allowed_emails (email, display_name)
values
  ('2411347787@qq.com', '我'),
  ('1575282998@qq.com', 'TA')
```

然后整段执行下面的 SQL（与仓库里的 `supabase/setup.sql` 完全一致）：

```sql
-- =============================================================================
-- 两人食 · Supabase 初始化脚本
-- 使用方式：Supabase Dashboard → SQL Editor → New query → 粘贴全文 → Run
--
-- 执行前请先做两件事：
--   1. 把下面 allowed_emails 里的两个邮箱替换成你们自己的邮箱（必须一致）；
--   2. 确认项目已开启 pg_cron / pg_net（Database → Extensions 可一键开启）。
--
-- 权限模型：
--   只有 public.members 里的账号可以通过 RLS；其他任何账号（包括 anon）
--   读不到打卡、留言、菜品、照片，也写不进任何数据。
-- =============================================================================

create extension if not exists pgcrypto;

-- =============================================================================
-- 0. 登录白名单：只允许这两个邮箱注册
-- =============================================================================
create table if not exists public.allowed_emails (
  email text primary key,
  display_name text not null
);

insert into public.allowed_emails (email, display_name)
values
  ('2411347787@qq.com', '我'),
  ('1575282998@qq.com', 'TA')
on conflict (email) do update set display_name = excluded.display_name;

alter table public.allowed_emails enable row level security;
-- 不创建任何 policy：客户端无法读写白名单，只有 service_role 可以。

-- =============================================================================
-- 1. 成员表：空间里唯一的两名成员
-- =============================================================================
create table if not exists public.members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null default '室友',
  created_at timestamptz not null default now()
);

alter table public.members enable row level security;

-- 注册触发器：邮箱不在白名单时直接拒绝注册
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_display_name text;
begin
  select display_name into v_display_name
  from public.allowed_emails
  where lower(email) = lower(new.email);

  if v_display_name is null then
    raise exception '该邮箱不在允许名单内，无法注册';
  end if;

  insert into public.members (user_id, email, display_name)
  values (new.id, new.email, v_display_name)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- 判断当前请求是否来自空间成员（security definer 避免 RLS 递归）
create or replace function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.members where user_id = auth.uid()
  );
$$;

create policy "members_can_read_members"
on public.members for select
to authenticated
using (public.is_member());

create policy "members_can_update_own_profile"
on public.members for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- =============================================================================
-- 2. 打卡记录
-- =============================================================================
create table if not exists public.checkins (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.members(user_id) on delete cascade,
  image_path text not null,
  note text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists checkins_created_at_idx
  on public.checkins (created_at desc);

alter table public.checkins enable row level security;

create policy "members_can_read_checkins"
on public.checkins for select
to authenticated
using (public.is_member());

create policy "members_can_insert_own_checkins"
on public.checkins for insert
to authenticated
with check (public.is_member() and author_id = auth.uid());

create policy "members_can_delete_own_checkins"
on public.checkins for delete
to authenticated
using (public.is_member() and author_id = auth.uid());

-- =============================================================================
-- 3. 评论 / 回复（parent_id 为空 = 一级评论）
-- =============================================================================
create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  checkin_id uuid not null references public.checkins(id) on delete cascade,
  author_id uuid not null references public.members(user_id) on delete cascade,
  parent_id uuid references public.comments(id) on delete cascade,
  content text not null check (char_length(content) between 1 and 200),
  created_at timestamptz not null default now()
);

create index if not exists comments_checkin_idx
  on public.comments (checkin_id, created_at);

alter table public.comments enable row level security;

create policy "members_can_read_comments"
on public.comments for select
to authenticated
using (public.is_member());

create policy "members_can_insert_own_comments"
on public.comments for insert
to authenticated
with check (public.is_member() and author_id = auth.uid());

create policy "members_can_delete_own_comments"
on public.comments for delete
to authenticated
using (public.is_member() and author_id = auth.uid());

-- =============================================================================
-- 4. 菜品库 + 每人自己的收藏
-- =============================================================================
create table if not exists public.dishes (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 40),
  tags text[] not null default '{}',
  created_by uuid not null references public.members(user_id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.dishes enable row level security;

create policy "members_can_read_dishes"
on public.dishes for select
to authenticated
using (public.is_member());

create policy "members_can_insert_dishes"
on public.dishes for insert
to authenticated
with check (public.is_member() and created_by = auth.uid());

create policy "members_can_delete_dishes"
on public.dishes for delete
to authenticated
using (public.is_member());

create table if not exists public.dish_favorites (
  dish_id uuid not null references public.dishes(id) on delete cascade,
  user_id uuid not null references public.members(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (dish_id, user_id)
);

create index if not exists dish_favorites_user_idx
  on public.dish_favorites (user_id);

alter table public.dish_favorites enable row level security;

create policy "members_can_read_own_favorites"
on public.dish_favorites for select
to authenticated
using (public.is_member() and user_id = auth.uid());

create policy "members_can_insert_own_favorites"
on public.dish_favorites for insert
to authenticated
with check (public.is_member() and user_id = auth.uid());

create policy "members_can_delete_own_favorites"
on public.dish_favorites for delete
to authenticated
using (public.is_member() and user_id = auth.uid());

-- =============================================================================
-- 5. 全局留言板
-- =============================================================================
create table if not exists public.board_messages (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.members(user_id) on delete cascade,
  content text not null check (char_length(content) between 1 and 300),
  created_at timestamptz not null default now()
);

create index if not exists board_messages_created_at_idx
  on public.board_messages (created_at desc);

alter table public.board_messages enable row level security;

create policy "members_can_read_board"
on public.board_messages for select
to authenticated
using (public.is_member());

create policy "members_can_insert_own_board"
on public.board_messages for insert
to authenticated
with check (public.is_member() and author_id = auth.uid());

create policy "members_can_delete_own_board"
on public.board_messages for delete
to authenticated
using (public.is_member() and author_id = auth.uid());

-- =============================================================================
-- 6. 推送订阅（每台设备一条）
-- =============================================================================
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.members(user_id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

create policy "members_can_read_own_subscriptions"
on public.push_subscriptions for select
to authenticated
using (public.is_member() and user_id = auth.uid());

create policy "members_can_insert_own_subscriptions"
on public.push_subscriptions for insert
to authenticated
with check (public.is_member() and user_id = auth.uid());

create policy "members_can_update_own_subscriptions"
on public.push_subscriptions for update
to authenticated
using (public.is_member() and user_id = auth.uid())
with check (public.is_member() and user_id = auth.uid());

create policy "members_can_delete_own_subscriptions"
on public.push_subscriptions for delete
to authenticated
using (public.is_member() and user_id = auth.uid());

-- =============================================================================
-- 7. 饭点提醒（每条提醒归属于创建者，到点推送给对方）
-- =============================================================================
create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.members(user_id) on delete cascade,
  label text not null default '饭点',
  remind_at time not null,
  message text not null default '到饭点啦，记得上传你的伙食打卡～',
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists reminders_time_idx
  on public.reminders (remind_at);

alter table public.reminders enable row level security;

create policy "members_can_read_reminders"
on public.reminders for select
to authenticated
using (public.is_member());

create policy "members_can_insert_own_reminders"
on public.reminders for insert
to authenticated
with check (public.is_member() and owner_id = auth.uid());

create policy "members_can_update_own_reminders"
on public.reminders for update
to authenticated
using (public.is_member() and owner_id = auth.uid())
with check (public.is_member() and owner_id = auth.uid());

create policy "members_can_delete_own_reminders"
on public.reminders for delete
to authenticated
using (public.is_member() and owner_id = auth.uid());

-- 发送日志：保证同一提醒每天只推一次；仅 Edge Function(service_role) 可写
create table if not exists public.reminder_logs (
  reminder_id uuid not null references public.reminders(id) on delete cascade,
  sent_date date not null,
  sent_at timestamptz not null default now(),
  primary key (reminder_id, sent_date)
);

alter table public.reminder_logs enable row level security;
-- 不创建 policy，客户端不可见。

-- =============================================================================
-- 8. 私有照片桶 + 存储策略
-- =============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'checkin-photos',
  'checkin-photos',
  false,
  20971520,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update
set public = false, file_size_limit = excluded.file_size_limit;

create policy "members_can_read_checkin_photos"
on storage.objects for select
to authenticated
using (
  bucket_id = 'checkin-photos'
  and public.is_member()
);

create policy "members_can_upload_own_checkin_photos"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'checkin-photos'
  and public.is_member()
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "members_can_delete_own_checkin_photos"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'checkin-photos'
  and public.is_member()
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

-- =============================================================================
-- 9. Realtime：打卡、评论、菜品、收藏、留言、提醒
-- =============================================================================
do $$
declare
  table_name text;
begin
  foreach table_name in array[
    'checkins', 'comments', 'dishes', 'dish_favorites',
    'board_messages', 'reminders', 'members'
  ]
  loop
    begin
      execute format(
        'alter publication supabase_realtime add table public.%I',
        table_name
      );
    exception
      when duplicate_object then null;
      when others then null;
    end;
  end loop;
end;
$$;

-- =============================================================================
-- 10. 权限收口：anon 完全无表权限；authenticated 仍受 RLS 约束
-- =============================================================================
revoke all on all tables in schema public from anon;
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;

-- =============================================================================
-- 11. 补录（可选）：如果账号在跑本脚本之前已经创建，执行下面这句
-- =============================================================================
insert into public.members (user_id, email, display_name)
select u.id, u.email, a.display_name
from auth.users u
join public.allowed_emails a on lower(u.email) = lower(a.email)
on conflict (user_id) do nothing;

-- =============================================================================
-- 12. 定时推送（需要先开启 pg_cron 与 pg_net）
--     把下面三段占位符替换后取消注释执行：
--       <PROJECT_REF>        Supabase 项目 ref
--       <CRON_SECRET>        与 Edge Function 环境变量一致的随机字符串
--
-- 建议先执行 JWT 验证：可以直接用浏览器访问函数 URL 看是否返回 401
-- =============================================================================
-- create extension if not exists pg_cron with schema extensions;
-- create extension if not exists pg_net with schema extensions;
--
-- select cron.schedule(
--   'liangrenshi-reminders',
--   '* * * * *',
--   $$
--     select net.http_post(
--       url := 'https://<PROJECT_REF>.supabase.co/functions/v1/send-reminders',
--       headers := jsonb_build_object(
--         'Content-Type', 'application/json',
--         'x-cron-secret', '<CRON_SECRET>'
--       ),
--       body := '{}'::jsonb,
--       timeout_milliseconds := 5000
--     );
--   $$
-- );
--
-- 查看执行情况：
-- select * from cron.job;
-- select * from cron.job_run_details order by start_time desc limit 10;

-- =============================================================================
-- 完成。可以用下面的语句快速自检 RLS 是否生效：
--   select * from public.checkins;  -- 登录状态下就能看到两条账号的数据
-- 未登录（anon）访问 REST 接口会得到空数组或 0 行。
-- =============================================================================
```

### 执行后检查

```sql
-- 应该能看到 2 条白名单
select * from public.allowed_emails;

-- 应该都是 row level security = true
select relname, relrowsecurity
from pg_class
where relnamespace = 'public'::regnamespace
  and relkind = 'r';
```

RLS 的核心规则：

| 表 | 读 | 写 |
| --- | --- | --- |
| `members` | 仅成员 | 仅能改自己的称呼 |
| `checkins` | 仅成员 | 仅能建/删自己的打卡 |
| `comments` | 仅成员 | 仅能建/删自己的评论 |
| `dishes` | 仅成员 | 两人都可新增；两人都可删（共享菜单） |
| `dish_favorites` | 仅自己的收藏 | 仅自己的收藏 |
| `board_messages` | 仅成员 | 仅能建/删自己的留言 |
| `reminders` | 仅成员 | 仅能改删自己创建的提醒 |
| `push_subscriptions` | 仅自己的设备 | 仅自己的设备 |
| `reminder_logs` / `allowed_emails` | 客户端不可见 | 仅 service_role |

所有策略都带有 `public.is_member()` 判断，匿名角色 `anon` 已在脚本末尾被 `revoke`，即使拿到 anon key 也无法读取任何业务表。

---

## 3. 创建两个账号

**注意顺序**：先执行第 2 步的 SQL（白名单 + 触发器），再创建账号，这样 `members` 表才会自动补上成员记录。

1. **Authentication → Users → Add user → Create new user**
2. 填写第一个邮箱和密码，打开 **Auto Confirm User**（跳过邮件确认，私人使用最省事）。
3. 重复一次，创建对方账号。
4. 回到 SQL Editor 验证：

```sql
select user_id, email, display_name from public.members;
```

应该正好两条。如果账号建早了没进 `members`，重新执行 `setup.sql` 末尾的补录语句即可。

> 注册触发器会拒绝任何不在白名单里的邮箱，即使有人找到登录页也注册不进来。

---

## 4. 关闭公开注册（双保险）

**Authentication → Providers → Email**：

- 关闭 **Allow new users to sign up**（不同版本叫法略有差异：Enable signups / Allow signups）。
- 保留 Email + Password 登录方式即可，不需要配置邮件服务器。

这样即便触发器被绕过，也不会有第三个账号产生。

---

## 5. 生成 VAPID 密钥

Web Push 需要一对 VAPID 密钥（公钥给前端，私钥只放服务端）：

```bash
npx web-push generate-vapid-keys
```

输出示例：

```
Public Key:
BEl6...（约 87 个字符）

Private Key:
xYz1...（约 43 个字符）
```

记下来：

- **Public Key** → 前端环境变量 `VITE_VAPID_PUBLIC_KEY`
- **Private Key** → 只放 Supabase Edge Function 的 secret，永远不要提交到 Git

> 换密钥后，旧订阅会失效。需要用户在设置页重新开启一次通知（或先清空 `push_subscriptions` 表）。

---

## 6. 部署 Edge Function（定时推送）

函数代码在 `supabase/functions/send-reminders/index.ts`，全文见[附录 A](#附录-aedge-function-完整代码)。

### 6.1 安装 / 登录 CLI

```bash
npm i -g supabase
supabase login
```

（也可以全程用 `npx supabase ...`，不需要全局安装。）

### 6.2 初始化并关联项目

在项目根目录执行：

```bash
# 如果项目里还没有 supabase/config.toml，先初始化（已存在则跳过）
supabase init

supabase link --project-ref <你的-project-ref>
```

`project-ref` 就是 `https://<project-ref>.supabase.co` 里的那一段。`supabase init` 只会生成配置文件，不会覆盖 `setup.sql`。

### 6.3 设置服务端密钥

```bash
supabase secrets set \
  VAPID_PUBLIC_KEY=<Public Key> \
  VAPID_PRIVATE_KEY=<Private Key> \
  VAPID_SUBJECT=mailto:2411347787@qq.com \
  CRON_SECRET=<自己生成的一串随机字符> \
  REMINDER_TIMEZONE=Asia/Shanghai
```

`CRON_SECRET` 可以用下面命令生成：

```bash
openssl rand -hex 24
```

`SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY` 由 Supabase 自动注入，不需要手动设置。

### 6.4 部署

```bash
supabase functions deploy send-reminders --no-verify-jwt
```

说明：

- `send-reminders` 必须与代码目录同名。
- `--no-verify-jwt` 是必须的：pg_cron 调用时没有用户 JWT，函数内部用 `x-cron-secret` 校验定时调用；测试推送则单独校验用户 JWT。
- 部署完成后地址是：
  `https://<project-ref>.supabase.co/functions/v1/send-reminders`

### 6.5 手动验证

```bash
curl -i -X POST \
  "https://<project-ref>.supabase.co/functions/v1/send-reminders" \
  -H "Content-Type: application/json" \
  -H "x-cron-secret: <你的 CRON_SECRET>" \
  -d '{}'
```

期望返回 `{"ok":true,"time":"HH:MM","reminders":0,"sent":0,...}`。
如果返回 `401`，说明 secret 不一致；返回 `500 VAPID 密钥未配置`，说明第 6.3 步没生效。

---

## 7. 配置每分钟定时任务（pg_cron + pg_net）

在 SQL Editor 执行（替换两个占位符）：

```sql
-- 如果扩展还没开，先在 Dashboard → Database → Extensions 打开
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'liangrenshi-reminders',
  '* * * * *',
  $$
    select net.http_post(
      url := 'https://<project-ref>.supabase.co/functions/v1/send-reminders',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', '<你的 CRON_SECRET>'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 5000
    );
  $$
);
```

检查任务：

```sql
select jobid, jobname, schedule, active from cron.job;
select status, start_time, return_message
from cron.job_run_details
order by start_time desc
limit 10;
```

看到 `status = succeeded` 即表示每分钟都在调用 Edge Function。

> 时区：函数默认按 `Asia/Shanghai` 计算当前 HH:mm，所以 `reminders.remind_at` 直接填北京时间即可。改时区请修改 `REMINDER_TIMEZONE` secret 后重新部署。

---

## 8. 本地运行

```bash
npm install
cp .env.example .env.local
```

编辑 `.env.local`：

```dotenv
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon public key>
VITE_VAPID_PUBLIC_KEY=<VAPID Public Key>
```

```bash
npm run dev       # http://localhost:5173
npm run build     # 产物在 dist/
npm run preview   # 本地预览生产构建
```

> Service Worker 只在生产构建中注册（`npm run build` + `npm run preview`），开发模式不注册，避免缓存干扰热更新。

---

## 9. 部署到 Vercel（自动 HTTPS）

1. 把项目推到 GitHub（**不要提交 `.env.local`**）。
2. Vercel → **Add New → Project** → 选择仓库。
3. Framework Preset 选 **Vite**，Build Command `npm run build`，Output Directory `dist`。
4. 在 **Environment Variables** 添加（Production + Preview）：

```
VITE_SUPABASE_URL        = https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY   = <anon public key>
VITE_VAPID_PUBLIC_KEY    = <VAPID Public Key>
```

5. Deploy。Vercel 会自动签发 HTTPS 证书，无需额外配置。
6. 打开 `https://<你的域名>.vercel.app`，用两个账号之一登录验证。

仓库已包含 `vercel.json`：

- SPA 路由回退到 `index.html`（`/checkin` 等路径不会 404）
- `sw.js` 强制 `max-age=0`，保证更新后能拿到新 Service Worker
- manifest 使用正确的 `application/manifest+json` Content-Type

---

## 10. iPhone 添加到主屏幕 + 开启通知

**必须在 iPhone 上操作，Safari 浏览器。**

### 10.1 添加到主屏幕

1. 用 **Safari** 打开 `https://<你的域名>.vercel.app`。
2. 点底部中间的「分享」按钮（方框 + 向上箭头）。
3. 向下滑，点 **「添加到主屏幕」**。
4. 名称会自动填成「两人食」，点右上角「添加」。
5. 回到桌面，从 **「两人食」图标** 打开（不要继续用 Safari 标签页）。

### 10.2 登录

首次从桌面图标打开后，输入邮箱 + 密码登录。登录状态会保存在应用内，下次打开无需重复登录。

### 10.3 开启通知

1. 进入底部 **设置**。
2. 找到 **系统通知**，状态显示「未开启」。
3. 点 **开启通知** → iOS 弹窗点 **允许**。
4. 状态变为「已开启」后，点 **发送测试通知**。
5. 把手机锁屏，几秒内应看到锁屏通知「两人食 · 测试通知」。

### 10.4 验证饭点提醒

1. 设置页 **新增** 一个提醒，时间设为**当前时间之后 1～2 分钟**（例如现在 12:28，就设 12:30）。
2. 用**对方账号**登录的设备接收（提醒只推给创建者的对方）。
3. 保持 App 在后台或锁屏，到点后应收到推送。
4. 首次没收到，等下一个饭点；也可以查看 Supabase → Edge Functions → Logs 的调用记录。

> iPhone 的通知设置路径：**设置 → 通知 → 两人食 → 允许通知**（横幅、声音、锁屏都要打开）。

---

## 11. 华为 / Android

### 11.1 华为 Web Push 的实情（重要）

国内华为手机（含鸿蒙）即使添加到主屏幕，**锁屏 Web Push 也经常收不到**，原因：

- 没有 FCM（谷歌推送通道），国内版华为用的是「华为推送 HMS」，浏览器走不到这条通道；
- 鸿蒙省电策略会冻结后台应用，定时心跳被掐断；
- 华为自带浏览器对标准 Web Push 支持也不完整。

**iPhone 不受影响**（iOS 16.4+，从桌面图标打开，可正常收锁屏推送）。本应用的推送链路对 iPhone 完全有效。

### 11.2 兜底方案：网页内计时器提醒

针对华为收不到系统通知的情况，应用内置了**网页内计时提醒**，无需任何额外配置：

- 只要应用**保持打开**（前台，或从后台切回前台），到点会在网页顶部弹出一条饭点提醒（带铃铛图标，停留约 9 秒）；
- 提醒内容就是你或对方设置的饭点文案；
- 不依赖系统通知权限，开着网页就能看到。

> ⚠️ 局限：网页被系统杀掉或完全后台时不会弹。但你打开应用看打卡/抽签/留言时，正好能收到提醒，满足日常使用。

### 11.3 华为操作步骤

1. 用 **Chrome** 打开站点（自带浏览器不行就装 Chrome）。
2. 地址栏右侧菜单 → **安装应用**（或「添加到主屏幕」）。
3. 从桌面图标打开应用并登录。
4. （可选）设置页 → 开启通知，看看系统通知能否收到；收不到也没关系，网页内提醒会兜底。
5. （可选）把应用加入电池优化白名单：华为「设置 → 应用 → Chrome → 电池 → 允许后台活动」，能让网页后台存活更久。

---

## 12. 上线验收清单

- [ ] 两个账号都能登录，第三个邮箱无法注册
- [ ] 未登录调用 REST API 返回空数组 / 无权限
- [ ] 打卡上传后，另一个账号首页实时看到（无需刷新）
- [ ] 评论、回复实时出现在对方页面
- [ ] 删除自己的打卡，照片从 Storage 消失
- [ ] 菜品新增、收藏、删除、抽签、标签屏蔽都正常
- [ ] 断网后重新打开，仍能看到上次加载的打卡和图片
- [ ] iPhone 主屏幕图标、启动页正常
- [ ] 设置页「发送测试通知」能收到系统通知
- [ ] 到点提醒只推给对方，不推给自己
- [ ] 华为设备开着应用，到点网页顶部弹出饭点提醒（网页内兜底，无需系统通知权限）
- [ ] `cron.job_run_details` 每分钟有成功记录

---

## 13. 常见问题

### 收不到推送

按顺序排查：

1. iPhone 是否从**主屏幕图标**打开（不是 Safari 标签页）；
2. iOS 是否 ≥ 16.4；
3. 设置页状态是否为「已开启」，系统通知是否允许；
4. Supabase 表 `push_subscriptions` 是否有当前账号的记录；
5. Edge Function 日志有没有 `push` 相关错误；
6. `cron.job_run_details` 是否每分钟成功；
7. `CRON_SECRET` 是否与 cron SQL 一致；
8. VAPID 公私钥是否成对，`VAPID_SUBJECT` 是否为 `mailto:` 格式。

### 返回 401 / `unauthorized`

- 定时调用：`x-cron-secret` 与 Edge Function 的 `CRON_SECRET` 不一致。
- 测试推送：用户登录态失效，重新登录。

### 推送返回 403 / UnauthorizedSubscription

VAPID 公钥与订阅时使用的公钥不一致。换过密钥的话，清空 `push_subscriptions`，两台设备重新开启通知。

### 登录提示「Invalid login credentials」

- 邮箱是否在白名单里、是否执行了触发器；
- 创建用户时是否勾选 Auto Confirm；
- 密码是否复制错了（Supabase 后台可重置）。

### 看不到照片 / 图片 403

- bucket 必须是 **private**；
- Storage 的三条 policy 是否执行成功；
- 上传路径必须是 `<user_id>/xxx.jpg`（代码已按此规则）。

### 实时不更新

- SQL 是否把表加入 `supabase_realtime` publication；
- 两个账号是否都已登录；
- 网络断开时不会实时，恢复后会自动重连。

### `npm:web-push` 导入失败

不同版本的 Edge Runtime 对 npm 包兼容性略有差异。若日志出现模块加载错误：

1. 将 `npm:web-push@3.6.7` 改为 `npm:web-push@3.6.6` 重新部署；
2. 或把导入改为 `https://esm.sh/web-push@3.6.7`。

函数其它逻辑无需改动。

---

## 14. 安全自检（建议上线后跑一次）

用 **anon key** 模拟陌生人访问（把 `<anon>` 换成 anon public key）：

```bash
curl -s "https://<project-ref>.supabase.co/rest/v1/checkins?select=*" \
  -H "apikey: <anon>" \
  -H "Authorization: Bearer <anon>"
```

期望：`[]`（0 行）。同理测试 `comments`、`dishes`、`board_messages`。

用带签名的照片地址之外的方式访问 Storage：

```bash
curl -i "https://<project-ref>.supabase.co/storage/v1/object/checkin-photos/<user_id>/xxx.jpg"
```

期望：`400/403`，不会返回图片。

最后确认：前端产物里只有 `VITE_SUPABASE_ANON_KEY`，没有 service_role key，也没有 VAPID 私钥。

---

## 附录 A：Edge Function 完整代码

文件路径：`supabase/functions/send-reminders/index.ts`

```ts
// @ts-nocheck
/**
 * 两人食 · 定时饭点提醒 / 测试推送
 *
 * 触发方式：
 *   1. pg_cron 每分钟调用一次（带 x-cron-secret 请求头）；
 *   2. 设置页「发送测试通知」按钮调用（带用户 JWT，body: { mode: "test" }）。
 *
 * 需要的环境变量（supabase secrets set ...）：
 *   VAPID_PUBLIC_KEY    Web Push 公钥
 *   VAPID_PRIVATE_KEY   Web Push 私钥（只放服务端）
 *   VAPID_SUBJECT       mailto:你的邮箱
 *   CRON_SECRET         自定义随机串，与 cron SQL 中一致
 *   REMINDER_TIMEZONE   可选，默认 Asia/Shanghai
 *
 * SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 由 Supabase 自动注入。
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import webpush from 'npm:web-push@3.6.7'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

const env = {
  url: Deno.env.get('SUPABASE_URL') ?? '',
  serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  cronSecret: Deno.env.get('CRON_SECRET') ?? '',
  vapidPublic: Deno.env.get('VAPID_PUBLIC_KEY') ?? '',
  vapidPrivate: Deno.env.get('VAPID_PRIVATE_KEY') ?? '',
  vapidSubject: Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com',
  timezone: Deno.env.get('REMINDER_TIMEZONE') ?? 'Asia/Shanghai'
}

const admin = createClient(env.url, env.serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false }
})

if (env.vapidPublic && env.vapidPrivate) {
  webpush.setVapidDetails(env.vapidSubject, env.vapidPublic, env.vapidPrivate)
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}

/** 取指定时区的当前日期与 HH:mm，避免依赖服务器 UTC 时间 */
function nowInTimezone(timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date())

  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}:00`,
    display: `${get('hour')}:${get('minute')}`
  }
}

type SubscriptionRow = {
  id: string
  endpoint: string
  p256dh: string
  auth: string
}

type Payload = {
  title: string
  body: string
  url: string
  tag: string
}

/** 向一组订阅发送通知；404/410 说明设备已注销，顺手清理 */
async function sendToSubscriptions(subscriptions: SubscriptionRow[], payload: Payload) {
  let sent = 0
  let removed = 0
  let failed = 0

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth }
          },
          JSON.stringify(payload),
          { TTL: 60 * 60, urgency: 'high' }
        )
        sent += 1
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode
        if (statusCode === 404 || statusCode === 410) {
          await admin.from('push_subscriptions').delete().eq('id', sub.id)
          removed += 1
        } else {
          failed += 1
          console.error('[push] 发送失败', sub.id, statusCode, error)
        }
      }
    })
  )

  return { sent, removed, failed }
}

/** 测试推送：只发给调用者自己，验证订阅链路 */
async function handleTest(req: Request) {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return json({ error: '缺少登录凭证' }, 401)

  const { data, error } = await admin.auth.getUser(token)
  if (error || !data?.user) return json({ error: '登录凭证无效' }, 401)

  const { data: subscriptions } = await admin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', data.user.id)

  if (!subscriptions?.length) {
    return json({ ok: true, sent: 0, message: '该账号还没有推送订阅' })
  }

  const result = await sendToSubscriptions(subscriptions, {
    title: '两人食 · 测试通知',
    body: '通知已开启，饭点会准时提醒你～',
    url: '/',
    tag: 'liangrenshi-test'
  })

  return json({ ok: true, ...result })
}

/** 定时任务：找出当前分钟启用的提醒，推送给创建者的对方 */
async function handleCron(req: Request) {
  if (!env.cronSecret) {
    return json({ error: 'CRON_SECRET 未配置' }, 500)
  }
  if (req.headers.get('x-cron-secret') !== env.cronSecret) {
    return json({ error: 'unauthorized' }, 401)
  }

  const now = nowInTimezone(env.timezone)

  const { data: reminders, error } = await admin
    .from('reminders')
    .select('id, owner_id, label, message, remind_at')
    .eq('enabled', true)
    .eq('remind_at', now.time)

  if (error) throw error
  if (!reminders?.length) {
    return json({ ok: true, time: now.display, reminders: 0, sent: 0 })
  }

  const { data: members } = await admin.from('members').select('user_id')
  const allMemberIds = (members ?? []).map((member) => member.user_id)

  let sent = 0
  let skipped = 0
  let remindersReceived = 0

  for (const reminder of reminders) {
    // 每条提醒只提醒「对方」，不打扰设置提醒的人
    const targetIds = allMemberIds.filter((id) => id !== reminder.owner_id)
    if (!targetIds.length) {
      skipped += 1
      continue
    }

    const { data: subscriptions } = await admin
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .in('user_id', targetIds)

    if (!subscriptions?.length) {
      skipped += 1
      continue
    }

    // 同一提醒每天只发一次；并发/重复调用时唯一约束会拦住
    const { error: logError } = await admin
      .from('reminder_logs')
      .insert({ reminder_id: reminder.id, sent_date: now.date })

    if (logError) {
      if (logError.code !== '23505') {
        console.error('[push] 写入发送日志失败', reminder.id, logError)
      }
      skipped += 1
      continue
    }

    remindersReceived += 1
    const result = await sendToSubscriptions(subscriptions, {
      title: `${reminder.label} · 饭点提醒`,
      body: reminder.message,
      url: '/',
      tag: `reminder-${reminder.id}`
    })
    sent += result.sent
  }

  // 清理 30 天前的发送日志，避免表无限增长
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  await admin.from('reminder_logs').delete().lt('sent_date', cutoff)

  return json({
    ok: true,
    time: now.display,
    reminders: reminders.length,
    remindersReceived,
    sent,
    skipped
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return json({ error: 'method not allowed' }, 405)
  }
  if (!env.vapidPublic || !env.vapidPrivate) {
    return json({ error: 'VAPID 密钥未配置' }, 500)
  }

  let body: { mode?: string } = {}
  try {
    body = await req.json()
  } catch {
    body = {}
  }

  try {
    if (body.mode === 'test') return await handleTest(req)
    return await handleCron(req)
  } catch (error) {
    console.error('[send-reminders] 未捕获错误', error)
    return json({ error: (error as Error)?.message ?? 'internal error' }, 500)
  }
})
```

---

## 附录 B：项目结构

```
food-share/
├── index.html                       # PWA meta、iOS 启动页、manifest
├── vercel.json                      # SPA 回退 + sw.js 缓存头
├── public/
│   ├── manifest.webmanifest
│   ├── sw.js                        # 离线缓存 + Web Push 接收
│   ├── favicon.svg
│   ├── icons/                       # 192 / 512 / maskable / apple-touch
│   └── splash/                      # iPhone 各尺寸启动页
├── scripts/generate-assets.py       # 可重新生成图标与启动页
├── src/
│   ├── main.js
│   ├── App.vue
│   ├── router/index.js
│   ├── lib/                         # supabase / auth / push / 图片压缩 / 缓存
│   ├── components/                  # 卡片、评论、弹层、底部导航
│   └── views/                       # 首页、打卡、吃什么、留言、设置、登录
├── supabase/
│   ├── setup.sql                    # 建表 + RLS + Storage + Realtime
│   └── functions/send-reminders/    # 定时推送 Edge Function
└── DEPLOY.md                        # 本文档
```
