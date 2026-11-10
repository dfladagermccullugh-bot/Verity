-- Verity Voice schema. Separate database from the legacy Verity app.

create table campaigns (
  id          text primary key,
  name        text not null,
  status      text not null default 'draft' check (status in ('draft', 'running', 'paused', 'closed')),
  instrument  jsonb not null,
  wording     jsonb not null,
  policy      jsonb not null,
  settings    jsonb not null,
  speech_hash text not null,
  created_at  timestamptz not null default now()
);

create table cases (
  id              text primary key,
  campaign_id     text not null references campaigns (id),
  phone           text not null,
  external_ref    text,
  timezone        text,
  state_code      text,
  -- Proof of consent. Null means none on file, and such a case can never be called.
  consent         jsonb,
  status          text not null default 'pending' check (status in ('pending', 'in_call', 'final')),
  attempts        integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz,
  interview       jsonb not null default '{"answers":{},"heard":[]}',
  review          jsonb not null default '[]',
  final_outcome   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (campaign_id, phone)
);
create index cases_due on cases (campaign_id, status, next_attempt_at);

create table attempts (
  id                text primary key,
  case_id           text not null references cases (id),
  number            integer not null check (number >= 1),
  transport         text not null,
  started_at        timestamptz not null,
  ended_at          timestamptz,
  outcome           text,
  recording_consent boolean,
  unique (case_id, number)
);
-- A person is never on two calls at once.
create unique index attempts_one_open on attempts (case_id) where ended_at is null;

create table audit_events (
  attempt_id text not null references attempts (id),
  seq        integer not null check (seq >= 1),
  at         timestamptz not null,
  body       jsonb not null,
  primary key (attempt_id, seq)
);

create table do_not_call (
  phone    text primary key,
  reason   text not null,
  source   text not null,
  added_at timestamptz not null default now()
);

-- Compliance in the database itself, so no code path can get round it.

-- 1. No call attempt can exist for a case without consent, or for a number on the do-not-call list.
create function attempts_guard() returns trigger language plpgsql as $$
declare
  c cases%rowtype;
begin
  select * into c from cases where id = new.case_id;
  if c.consent is null then
    raise exception 'no consent on file for case %', new.case_id using errcode = 'check_violation';
  end if;
  if exists (select 1 from do_not_call d where d.phone = c.phone) then
    raise exception 'number for case % is on the do-not-call list', new.case_id using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger attempts_guard before insert on attempts for each row execute function attempts_guard();

-- 2. The audit log is append-only.
create function audit_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'audit_events is append-only' using errcode = 'check_violation';
end $$;
create trigger audit_no_update before update or delete on audit_events for each row execute function audit_append_only();

-- 3. The do-not-call list only grows.
create trigger dnc_no_delete before update or delete on do_not_call for each row execute function audit_append_only();
