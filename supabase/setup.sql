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
