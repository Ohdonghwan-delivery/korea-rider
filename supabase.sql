-- Supabase SQL Editor에서 실행. 기존 rider_locations 데이터는 삭제하지 않습니다.
create table if not exists public.kd_admins (
 user_id uuid primary key references auth.users(id) on delete cascade
);
create table if not exists public.rider_accounts (
 auth_uid uuid primary key references auth.users(id) on delete cascade,
 rider_id text not null unique check (rider_id ~ '^[a-z0-9_-]{3,40}$'),
 rider_name text not null,
 created_at timestamptz not null default now()
);
-- 기존 rider_locations 테이블이 존재한다는 전제입니다.
alter table public.rider_locations add column if not exists auth_uid uuid references auth.users(id) on delete set null;
create index if not exists kd_rider_locations_auth_uid_idx on public.rider_locations(auth_uid);
create index if not exists kd_rider_locations_rider_id_idx on public.rider_locations(rider_id);

-- 관리자 식별 함수. 직접 admin 테이블 SELECT 정책과 재귀하지 않도록 definer 사용.
create or replace function public.kd_is_admin() returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.kd_admins a where a.user_id=(select auth.uid()));
$$;
revoke all on function public.kd_is_admin() from public;
grant execute on function public.kd_is_admin() to authenticated;

alter table public.kd_admins enable row level security;
alter table public.rider_accounts enable row level security;
alter table public.rider_locations enable row level security;
-- 기존 공개 정책이 있다면 반드시 제거해야 합니다. 아래는 기존 정책을 모두 삭제합니다.
do $$ declare r record; begin
 for r in select policyname from pg_policies where schemaname='public' and tablename='rider_locations' loop
  execute format('drop policy if exists %I on public.rider_locations',r.policyname);
 end loop;
end $$;
create policy kd_admins_read_self on public.kd_admins for select to authenticated using (user_id=(select auth.uid()));
create policy kd_accounts_read on public.rider_accounts for select to authenticated using (auth_uid=(select auth.uid()) or public.kd_is_admin());
create policy kd_locations_read on public.rider_locations for select to authenticated using (auth_uid=(select auth.uid()) or public.kd_is_admin());
-- 기사 위치 변경은 오직 아래 RPC를 통해 수행합니다.
revoke all on public.rider_locations from anon;
revoke insert,update,delete on public.rider_locations from authenticated;
grant select on public.rider_locations to authenticated;
grant select on public.rider_accounts, public.kd_admins to authenticated;

-- 기존 테이블에는 id, rider_id, rider_name, latitude, longitude, accuracy, is_sharing, last_seen_at 열이 있어야 합니다.
-- 기존 GPS 레코드를 rider_id 기준으로 갱신합니다. 동일 ID 레코드가 없다면 새로 생성합니다.
create or replace function public.kd_update_my_location(p_latitude double precision,p_longitude double precision,p_accuracy double precision)
returns void language plpgsql security definer set search_path = '' as $$
declare a record; begin
 if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
 if p_latitude is null or p_longitude is null or p_latitude < -90 or p_latitude > 90 or p_longitude < -180 or p_longitude > 180 then raise exception 'Invalid coordinates'; end if;
 select rider_id,rider_name into a from public.rider_accounts where auth_uid=(select auth.uid());
 if not found then raise exception 'Rider account not found'; end if;
 update public.rider_locations set auth_uid=(select auth.uid()),rider_name=a.rider_name,latitude=p_latitude,longitude=p_longitude,accuracy=p_accuracy,is_sharing=true,last_seen_at=now() where rider_id=a.rider_id;
 if not found then
  insert into public.rider_locations(rider_id,rider_name,latitude,longitude,accuracy,is_sharing,last_seen_at,auth_uid)
  values(a.rider_id,a.rider_name,p_latitude,p_longitude,p_accuracy,true,now(),(select auth.uid()));
 end if;
end $$;
create or replace function public.kd_stop_my_location()
returns void language plpgsql security definer set search_path = '' as $$
declare a text;begin
 select rider_id into a from public.rider_accounts where auth_uid=(select auth.uid());
 if a is null then raise exception 'Rider account not found';end if;
 update public.rider_locations set is_sharing=false,last_seen_at=now() where rider_id=a;
end $$;
revoke all on function public.kd_update_my_location(double precision,double precision,double precision) from public;
revoke all on function public.kd_stop_my_location() from public;
grant execute on function public.kd_update_my_location(double precision,double precision,double precision) to authenticated;
grant execute on function public.kd_stop_my_location() to authenticated;

-- 관리자 최초 등록: Supabase Authentication > Users에서 관리자 계정을 만든 뒤
-- 아래 YOUR_ADMIN_USER_UUID를 실제 관리자 UUID로 변경하여 별도로 실행하세요.
-- insert into public.kd_admins(user_id) values ('YOUR_ADMIN_USER_UUID');
