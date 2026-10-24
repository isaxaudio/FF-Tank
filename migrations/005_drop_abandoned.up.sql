-- 005_drop_abandoned: remove tables with no CRM role and no writes since September 2026.
-- Run scripts/export-tables.js first; it writes a JSON copy of each table to backups/.
-- Reversal (005 down) recreates the tables from the backup files via scripts/restore-tables.js.
drop table if exists public.account_leader_snapshots;
drop table if exists public.account_snapshot_seed;
drop table if exists public.agent_runs;
drop table if exists public.agent_audit_log;
drop table if exists public.approvals;
drop table if exists public.artifacts;
drop table if exists public.brief_deliveries;
drop table if exists public.content;
drop table if exists public.content_library;
drop table if exists public.flex_venues;
drop table if exists public.jobs;
drop table if exists public.notifications;
drop table if exists public.outreach;
drop table if exists public.performance_insights;
drop table if exists public.sales_notes;
drop table if exists public.sales_briefs;
drop table if exists public.strategy_briefs;
drop table if exists public.agent_memory;
drop table if exists public.chat_messages;
drop table if exists public.chat_threads;
drop table if exists public.competitor_signals;
drop table if exists public.industry_signals;
drop table if exists public.account_signals;
drop table if exists public.weekly_briefs;
