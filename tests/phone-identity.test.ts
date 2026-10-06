import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
const require = createRequire(import.meta.url);
const { Client } = require('pg');
const migration = readFileSync('supabase/migrations/20261006000003_phone_identity_and_cooldown.sql', 'utf8');

describe('phone identity database contract', () => {
  it('guards table writes and keeps the other dialler fix intact', () => {
    expect(migration).toContain('create unique index wk_contacts_normalized_phone_uniq');
    expect(migration).toContain('create unique index wk_queue_one_active_phone');
    expect(migration).toContain('before insert or update on public.wk_dialer_queue');
    expect(migration).not.toMatch(/delete from (?:public\.)?wk_calls/i);
    expect(migration).not.toMatch(/create or replace function public.wk_(pick_next_lead|claim_queue_row|apply_outcome)/i);
  });
  it('does not discard repeated CSV property rows', () => {
    const upload = readFileSync('src/features/crm/components/contacts/BulkUploadModal.tsx', 'utf8');
    expect(upload).toContain("rpc('wk_ingest_contacts'");
    expect(upload).not.toContain('seen.has(phone)');
  });
});

// Supply a LOCAL PostgreSQL admin URL to exercise the real triggers and races.
// Creates a separate database; production hosts are explicitly rejected.
const adminUrl = process.env.PHONE_TEST_DATABASE_URL;
describe.skipIf(!adminUrl)('PostgreSQL phone identity integration', () => {
  let admin: any, db: any;
  const database = `phone_dedupe_test_${process.pid}`;
  const oldest = randomUUID(), extra = randomUUID(), call = randomUUID(), followup = randomUUID();
  const connect = async () => {
    const url = new URL(adminUrl!); url.pathname = '/' + database;
    const client = new Client({ connectionString: url.toString() });
    await client.connect(); return client;
  };
  beforeAll(async () => {
    const host = new URL(adminUrl!).hostname;
    if (!['localhost', '127.0.0.1'].includes(host)) throw new Error('Only local test databases are allowed');
    admin = new Client({ connectionString: adminUrl }); await admin.connect();
    for (const role of ['anon','authenticated','service_role']) {
      if (!(await admin.query('select 1 from pg_roles where rolname=$1',[role])).rowCount) await admin.query(`create role ${role}`);
    }
    await admin.query(`create database ${database}`);
    db = await connect();
    await db.query(readFileSync('tests/sql/phone-dedupe-fixture.sql', 'utf8'));
    await db.query(`insert into wk_contacts(id,name,phone,created_at,custom_fields) values
      ($1,'Original','07700 900991',now()-interval '40 days','{"notes":"Keep first"}'),
      ($2,'Duplicate','+447700900991',now()-interval '20 days','{"notes":"Keep second"}')`, [oldest,extra]);
    await db.query(`insert into wk_calls(id,contact_id,direction) values($1,$2,'outbound')`, [call,extra]);
    await db.query(`insert into wk_contact_followups(id,contact_id,agent_id,due_at,note) values($1,$2,$3,now(),'Keep follow-up')`, [followup,extra,randomUUID()]);
    await db.query(`insert into wk_dialer_queue(campaign_id,contact_id) values($1,$2),($3,$4)`, [randomUUID(),oldest,randomUUID(),extra]);
    await db.query(migration);
  }, 30000);
  afterAll(async () => {
    await db?.end();
    if(admin) { await admin.query(`drop database if exists ${database}`); await admin.end(); }
  });
  it('merges into the oldest id, moves calls/follow-ups and closes the extra queue', async () => {
    expect((await db.query('select contact_id from wk_calls where id=$1',[call])).rows[0].contact_id).toBe(oldest);
    expect((await db.query('select contact_id,note from wk_contact_followups where id=$1',[followup])).rows[0]).toEqual({contact_id:oldest,note:'Keep follow-up'});
    expect((await db.query('select count(*)::int n from wk_contacts where id=$1',[extra])).rows[0].n).toBe(0);
    expect((await db.query("select count(*)::int n from wk_dialer_queue where contact_id=$1 and status='pending'",[oldest])).rows[0].n).toBe(1);
    expect((await db.query("select count(*)::int n from wk_activities where contact_id=$1 and body='Keep second'",[oldest])).rows[0].n).toBe(1);
  });
  it('normalizes, preserves property facts, enforces 30 days and closed/DNC states', async () => {
    await db.query(readFileSync('tests/sql/phone-dedupe.sql','utf8'));
  });
  it('serializes simultaneous imports and campaigns', async () => {
    const a=await connect(), b=await connect();
    try {
      await a.query('begin');
      const first=await a.query("select id from wk_ingest_contacts('[{\"name\":\"Race one\",\"phone\":\"07700900992\"}]')");
      const second=b.query("select id from wk_ingest_contacts('[{\"name\":\"Race two\",\"phone\":\"+44 7700-900992\"}]')");
      await a.query('commit');
      expect((await second).rows[0].id).toBe(first.rows[0].id);
      const id=first.rows[0].id;
      await a.query('begin');
      await a.query('insert into wk_dialer_queue(campaign_id,contact_id) values($1,$2)',[randomUUID(),id]);
      const queued=b.query('insert into wk_dialer_queue(campaign_id,contact_id) values($1,$2)',[randomUUID(),id]);
      await a.query('commit'); await queued;
      expect((await db.query("select count(*)::int n from wk_dialer_queue where contact_id=$1 and status='pending'",[id])).rows[0].n).toBe(1);
    } finally { await a.end(); await b.end(); }
  });
});
