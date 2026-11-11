-- Retention. The audit log stays append-only, with one narrow exception: the retention job may
-- overwrite the respondent's own words in old events, leaving the structure of the log (what was
-- asked, how it was coded, when) intact. The job announces itself with a transaction-local
-- setting; nothing else can update or delete audit events. The do-not-call list keeps the
-- original guard with no exception.
create function audit_events_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and coalesce(current_setting('verity.retention', true), '') = 'on'
     and new.attempt_id = old.attempt_id and new.seq = old.seq and new.at = old.at
     and new.body->>'type' = old.body->>'type' then
    return new;
  end if;
  raise exception 'audit_events is append-only' using errcode = 'check_violation';
end $$;

drop trigger audit_no_update on audit_events;
create trigger audit_no_update before update or delete on audit_events for each row execute function audit_events_guard();

alter table cases add column words_removed_at timestamptz;
