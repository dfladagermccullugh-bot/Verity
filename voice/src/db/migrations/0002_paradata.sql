-- Response timing per question (milliseconds from the end of the question audio to the start
-- of the reply), kept with the case so quality checks do not need to replay the audit log.
alter table cases add column latency_ms jsonb not null default '{}';
