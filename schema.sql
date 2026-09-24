-- IGNIS school portal schema. Apply this complete file in the Supabase SQL editor.
-- Browser clients use only the publishable/anon key. Never expose service_role.

create table if not exists public.profiles (
    user_id uuid primary key references auth.users(id) on delete cascade,
    email text not null unique,
    full_name text not null,
    role text not null check (role in ('Headteacher', 'Manager', 'Teacher', 'Parent', 'Parent / Student', 'Student')),
    linked_student_id text,
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.classes (
    id uuid primary key default gen_random_uuid(),
    name text not null unique,
    level text not null,
    teacher_user_id uuid references public.profiles(user_id) on delete set null,
    created_at timestamptz not null default now()
);

create table if not exists public.timetable_entries (
    id uuid primary key default gen_random_uuid(),
    class_id uuid not null references public.classes(id) on delete cascade,
    weekday smallint not null check (weekday between 1 and 5),
    start_time time not null,
    end_time time not null,
    subject text not null,
    teacher_user_id uuid references public.profiles(user_id) on delete set null,
    created_by uuid not null references public.profiles(user_id),
    created_at timestamptz not null default now(),
    check (end_time > start_time),
    unique (class_id, weekday, start_time)
);

create table if not exists public.students (
    id text primary key,
    full_name text not null,
    class_id uuid references public.classes(id) on delete set null,
    guardian_name text,
    guardian_phone text,
    guardian_email text,
    status text not null default 'Active' check (status in ('Active', 'Inactive', 'Graduated')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.profiles drop constraint if exists profiles_linked_student_id_fkey;
alter table public.profiles add constraint profiles_linked_student_id_fkey
    foreign key (linked_student_id) references public.students(id) on delete set null;

create table if not exists public.parent_student_links (
    parent_user_id uuid not null references public.profiles(user_id) on delete cascade,
    student_id text not null references public.students(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (parent_user_id, student_id)
);

create table if not exists public.staff_attendance (
    staff_user_id uuid not null references public.profiles(user_id) on delete cascade,
    attendance_date date not null,
    status text not null check (status in ('present', 'late', 'absent')),
    recorded_at timestamptz not null default now(),
    latitude double precision,
    longitude double precision,
    zone_name text,
    distance_meters integer,
    primary key (staff_user_id, attendance_date)
);

create table if not exists public.student_attendance (
    student_id text not null references public.students(id) on delete cascade,
    attendance_date date not null,
    status text not null check (status in ('present', 'late', 'absent')),
    marked_by uuid not null references public.profiles(user_id),
    recorded_at timestamptz not null default now(),
    primary key (student_id, attendance_date)
);

create table if not exists public.assignments (
    id uuid primary key default gen_random_uuid(),
    title text not null,
    subject text not null default '',
    description text not null default '',
    class_id uuid references public.classes(id) on delete cascade,
    due_at timestamptz,
    created_by uuid not null references public.profiles(user_id),
    created_at timestamptz not null default now()
);

create table if not exists public.assignment_submissions (
    assignment_id uuid not null references public.assignments(id) on delete cascade,
    student_id text not null references public.students(id) on delete cascade,
    submitted_at timestamptz not null default now(),
    content text not null default '',
    primary key (assignment_id, student_id)
);

create table if not exists public.scores (
    id uuid primary key default gen_random_uuid(),
    student_id text not null references public.students(id) on delete cascade,
    subject text not null,
    term text not null,
    class_score numeric(5,2) not null default 0 check (class_score between 0 and 100),
    exam_score numeric(5,2) not null default 0 check (exam_score between 0 and 100),
    recorded_by uuid not null references public.profiles(user_id),
    updated_at timestamptz not null default now(),
    unique (student_id, subject, term)
);

create table if not exists public.fees (
    student_id text not null references public.students(id) on delete cascade,
    term text not null,
    amount numeric(12,2) not null default 0 check (amount >= 0),
    paid numeric(12,2) not null default 0 check (paid >= 0 and paid <= amount),
    updated_at timestamptz not null default now(),
    primary key (student_id, term)
);

create table if not exists public.payments (
    id uuid primary key default gen_random_uuid(),
    student_id text not null references public.students(id),
    amount numeric(12,2) not null check (amount > 0),
    method text not null,
    reference text not null unique,
    status text not null default 'pending' check (status in ('pending', 'confirmed', 'failed', 'refunded')),
    received_by uuid references public.profiles(user_id),
    created_at timestamptz not null default now()
);

create table if not exists public.notices (
    id uuid primary key default gen_random_uuid(),
    title text not null,
    body text not null,
    audience text not null default 'All' check (audience in ('All', 'Staff', 'Parents')),
    published_by uuid not null references public.profiles(user_id),
    published_at timestamptz not null default now()
);

create table if not exists public.school_settings (
    setting_key text primary key,
    setting_value jsonb not null default '{}'::jsonb,
    updated_by uuid not null references public.profiles(user_id),
    updated_at timestamptz not null default now()
);

create table if not exists public.geofences (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    latitude double precision not null check (latitude between -90 and 90),
    longitude double precision not null check (longitude between -180 and 180),
    radius_meters integer not null check (radius_meters between 25 and 2000),
    enabled boolean not null default true,
    created_at timestamptz not null default now()
);

create or replace function public.is_school_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.profiles where user_id = auth.uid() and is_active and role in ('Headteacher', 'Manager')) $$;

create or replace function public.is_school_staff()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.profiles where user_id = auth.uid() and is_active and role in ('Headteacher', 'Manager', 'Teacher')) $$;

create or replace function public.is_school_parent()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.profiles where user_id = auth.uid() and is_active and role in ('Parent', 'Parent / Student', 'Student')) $$;

create or replace function public.can_access_student(student_key text)
returns boolean language sql stable security definer set search_path = public
as $$
    select public.is_school_admin()
        or exists (
            select 1 from public.students s join public.classes c on c.id = s.class_id
            where s.id = student_key and c.teacher_user_id = auth.uid()
        )
        or exists (select 1 from public.profiles where user_id = auth.uid() and is_active and linked_student_id = student_key)
        or exists (select 1 from public.parent_student_links l join public.profiles p on p.user_id = l.parent_user_id where l.parent_user_id = auth.uid() and p.is_active and l.student_id = student_key)
$$;

create or replace function public.can_access_class(class_key uuid)
returns boolean language sql stable security definer set search_path = public
as $$
    select public.is_school_admin()
        or exists (select 1 from public.classes c where c.id = class_key and c.teacher_user_id = auth.uid())
        or exists (
            select 1 from public.students s
            where s.class_id = class_key and public.can_access_student(s.id)
        )
$$;

create or replace function public.can_manage_class(class_key uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select public.is_school_admin() or exists (select 1 from public.classes c join public.profiles p on p.user_id = c.teacher_user_id where c.id = class_key and c.teacher_user_id = auth.uid() and p.is_active) $$;

revoke all on function public.is_school_admin(), public.is_school_staff(), public.is_school_parent() from public, anon;
revoke all on function public.can_access_student(text), public.can_access_class(uuid), public.can_manage_class(uuid) from public, anon;
grant execute on function public.is_school_admin(), public.is_school_staff(), public.is_school_parent() to authenticated;
grant execute on function public.can_access_student(text), public.can_access_class(uuid), public.can_manage_class(uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.classes enable row level security;
alter table public.timetable_entries enable row level security;
alter table public.students enable row level security;
alter table public.parent_student_links enable row level security;
alter table public.staff_attendance enable row level security;
alter table public.student_attendance enable row level security;
alter table public.assignments enable row level security;
alter table public.assignment_submissions enable row level security;
alter table public.scores enable row level security;
alter table public.fees enable row level security;
alter table public.payments enable row level security;
alter table public.notices enable row level security;
alter table public.school_settings enable row level security;
alter table public.geofences enable row level security;

revoke all on public.profiles, public.classes, public.timetable_entries, public.students, public.parent_student_links,
    public.staff_attendance, public.student_attendance, public.assignments,
    public.assignment_submissions, public.scores, public.fees, public.payments,
    public.notices, public.school_settings, public.geofences from anon;
grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.classes, public.timetable_entries, public.students,
    public.parent_student_links, public.staff_attendance, public.student_attendance,
    public.assignments, public.assignment_submissions, public.scores, public.fees,
    public.payments, public.notices, public.school_settings, public.geofences to authenticated;

create policy "profiles read self or by school administrators" on public.profiles for select to authenticated
    using (user_id = auth.uid() or public.is_school_admin());
create policy "administrators update profiles" on public.profiles for update to authenticated
    using (public.is_school_admin()) with check (public.is_school_admin());

create policy "authenticated users read classes" on public.classes for select to authenticated using (true);
create policy "administrators manage classes" on public.classes for all to authenticated
    using (public.is_school_admin()) with check (public.is_school_admin());
create policy "users read accessible timetables" on public.timetable_entries for select to authenticated
    using (public.can_access_class(class_id));
create policy "teachers manage assigned timetables" on public.timetable_entries for insert to authenticated
    with check (public.can_manage_class(class_id) and created_by = auth.uid());
create policy "teachers update assigned timetables" on public.timetable_entries for update to authenticated
    using (public.can_manage_class(class_id)) with check (public.can_manage_class(class_id));
create policy "teachers remove assigned timetable entries" on public.timetable_entries for delete to authenticated
    using (public.can_manage_class(class_id));

create policy "staff or linked family read student records" on public.students for select to authenticated
    using (public.can_access_student(id));
create policy "administrators manage student records" on public.students for all to authenticated
    using (public.is_school_admin()) with check (public.is_school_admin());
create policy "families read own links" on public.parent_student_links for select to authenticated
    using (parent_user_id = auth.uid() or public.is_school_admin());
create policy "administrators manage family links" on public.parent_student_links for all to authenticated
    using (public.is_school_admin()) with check (public.is_school_admin());

create policy "administrators and staff see appropriate staff attendance" on public.staff_attendance for select to authenticated
    using (public.is_school_admin() or staff_user_id = auth.uid());
create policy "administrators update staff attendance" on public.staff_attendance for update to authenticated
    using (public.is_school_admin()) with check (public.is_school_admin());
create policy "staff or linked family read student attendance" on public.student_attendance for select to authenticated
    using (public.can_access_student(student_id));
create policy "staff mark student attendance" on public.student_attendance for insert to authenticated
    with check (
        marked_by = auth.uid() and (
            public.is_school_admin() or exists (
                select 1 from public.students s where s.id = student_id and public.can_manage_class(s.class_id)
            )
        )
    );
create policy "staff update student attendance" on public.student_attendance for update to authenticated
    using (public.is_school_admin() or exists (select 1 from public.students s where s.id = student_id and public.can_manage_class(s.class_id)))
    with check (public.is_school_admin() or exists (select 1 from public.students s where s.id = student_id and public.can_manage_class(s.class_id)));

create policy "users read assignments for their classes" on public.assignments for select to authenticated
    using (public.can_access_class(class_id));
create policy "staff manage assignments" on public.assignments for all to authenticated
    using (public.can_manage_class(class_id)) with check (public.can_manage_class(class_id) and created_by = auth.uid());
create policy "staff or linked family read submissions" on public.assignment_submissions for select to authenticated
    using (public.is_school_staff() or public.can_access_student(student_id));
create policy "students submit own work" on public.assignment_submissions for insert to authenticated
    with check (
        (public.is_school_parent() and public.can_access_student(student_id))
        or exists (select 1 from public.assignments a where a.id = assignment_id and public.can_manage_class(a.class_id))
    );
create policy "students update own submissions" on public.assignment_submissions for update to authenticated
    using (
        (public.is_school_parent() and public.can_access_student(student_id))
        or exists (select 1 from public.assignments a where a.id = assignment_id and public.can_manage_class(a.class_id))
    )
    with check (
        (public.is_school_parent() and public.can_access_student(student_id))
        or exists (select 1 from public.assignments a where a.id = assignment_id and public.can_manage_class(a.class_id))
    );
create policy "staff remove submission marks" on public.assignment_submissions for delete to authenticated
    using (exists (select 1 from public.assignments a where a.id = assignment_id and public.can_manage_class(a.class_id)));
create policy "staff or linked family read scores" on public.scores for select to authenticated
    using (public.can_access_student(student_id));
create policy "staff manage scores" on public.scores for all to authenticated
    using (public.is_school_admin() or exists (select 1 from public.students s where s.id = student_id and public.can_manage_class(s.class_id)))
    with check (recorded_by = auth.uid() and (public.is_school_admin() or exists (select 1 from public.students s where s.id = student_id and public.can_manage_class(s.class_id))));
create policy "staff or linked family read fees" on public.fees for select to authenticated
    using (public.can_access_student(student_id));
create policy "administrators manage fees" on public.fees for all to authenticated
    using (public.is_school_admin()) with check (public.is_school_admin());
create policy "staff or linked family read payments" on public.payments for select to authenticated
    using (public.is_school_staff() or public.can_access_student(student_id));
create policy "parents create pending payments" on public.payments for insert to authenticated
    with check (public.can_access_student(student_id) and status = 'pending');
create policy "administrators update payments" on public.payments for update to authenticated
    using (public.is_school_admin()) with check (public.is_school_admin());
create policy "administrators record payments" on public.payments for insert to authenticated
    with check (public.is_school_admin());

create policy "users read notices for their audience" on public.notices for select to authenticated
    using (audience = 'All' or (audience = 'Staff' and public.is_school_staff()) or (audience = 'Parents' and public.is_school_parent()));
create policy "staff manage notices" on public.notices for all to authenticated
    using (public.is_school_staff()) with check (public.is_school_staff() and published_by = auth.uid());
create policy "authenticated read public settings" on public.school_settings for select to authenticated using (true);
create policy "administrators manage settings" on public.school_settings for all to authenticated
    using (public.is_school_admin()) with check (public.is_school_admin() and updated_by = auth.uid());
create policy "staff read enabled geofences" on public.geofences for select to authenticated
    using (enabled and public.is_school_staff());
create policy "administrators manage geofences" on public.geofences for all to authenticated
    using (public.is_school_admin()) with check (public.is_school_admin());

create or replace function public.record_school_payment(p_student_id text, p_term text, p_amount numeric, p_method text)
returns text language plpgsql security definer set search_path = public
as $$
declare
    v_amount numeric(12,2);
    v_paid numeric(12,2);
    v_reference text := 'IGN-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
begin
    if not public.is_school_admin() then raise exception 'Only administrators can record received payments.'; end if;
    if p_amount <= 0 then raise exception 'Payment amount must be greater than zero.'; end if;
    select amount, paid into v_amount, v_paid from public.fees
        where student_id = p_student_id and term = p_term for update;
    if not found then raise exception 'No fee ledger exists for this student and term.'; end if;
    if p_amount > v_amount - v_paid then raise exception 'Payment exceeds the outstanding balance.'; end if;
    insert into public.payments (student_id, amount, method, reference, status, received_by)
        values (p_student_id, p_amount, p_method, v_reference, 'confirmed', auth.uid());
    update public.fees set paid = v_paid + p_amount, updated_at = now()
        where student_id = p_student_id and term = p_term;
    return v_reference;
end;
$$;
revoke all on function public.record_school_payment(text, text, numeric, text) from public, anon;
grant execute on function public.record_school_payment(text, text, numeric, text) to authenticated;
