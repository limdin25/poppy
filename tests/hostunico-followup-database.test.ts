import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
const { Client } = createRequire(import.meta.url)('pg');
const adminUrl = process.env.PHONE_TEST_DATABASE_URL;
describe.skipIf(!adminUrl)('reviewed report follow-ups in PostgreSQL', () => {
  let admin: any, db: any;
  const database = `report_followups_test_${process.pid}`;
  const agent = randomUUID();
  const connect = async () => { const u = new URL(adminUrl!); u.pathname = '/' + database; const c = new Client({ connectionString: u.toString() }); await c.connect(); return c; };
  beforeAll(async () => {
    if (!['localhost', '127.0.0.1'].includes(new URL(adminUrl!).hostname)) throw new Error('Local tests only');
    admin = new Client({ connectionString: adminUrl }); await admin.connect();
    await admin.query(`create database ${database}`); db = await connect();
    await db.query(readFileSync('tests/sql/phone-dedupe-fixture.sql', 'utf8'));
    await db.query(`create table wk_contact_tags(contact_id uuid,tag text,primary key(contact_id,tag));
      create table wk_sms_messages(id uuid default gen_random_uuid() primary key,contact_id uuid,direction text,channel text,body text,status text,created_at timestamptz default now());
      create table sa_property_reports(listing_id uuid primary key,remote_id uuid default gen_random_uuid(),report_url text,sms_sid text);
      create publication supabase_realtime;`);
    await db.query(readFileSync('supabase/migrations/20260930000004_hostunico_followups.sql', 'utf8'));
    await db.query(readFileSync('supabase/migrations/20261006000004_reviewed_report_followups.sql', 'utf8'));
  });
  afterAll(async () => { await db?.end(); if (admin) { await admin.query(`drop database if exists ${database}`); await admin.end(); } });
  async function fixture() {
    const contact = randomUUID(), listing = randomUUID();
    await db.query("insert into wk_contacts(id,name,phone,desk,owner_agent_id) values($1,'Test', $2,'sa',$3)", [contact, '+' + Date.now() + Math.floor(Math.random()*1000), agent]);
    await db.query("insert into sa_listings(id,rightmove_id,agency,agency_phone,wk_contact_id) values($1::uuid,$1::text,'Test','',$2)", [listing,contact]);
    await db.query("insert into sa_property_reports(listing_id,report_url) values($1,'https://hostunico.com/r/test')",[listing]);
    const at = (await db.query("select ((now() at time zone 'Europe/London')::date+1+time '10:00') at time zone 'Europe/London' as at")).rows[0].at.toISOString();
    const items = [1,2,3].map(i=>({step_key:`step${i}`,channel:'sms',body:`Test message ${i}`,subject:'',scheduled_for:at,enabled:true,version:0}));
    const save = (plan=items) => db.query('select sa_save_report_followup_plan($1,$2,$3,$4,$5::jsonb,$6)', [contact,listing,'sms','+447700900999',JSON.stringify(plan),agent]);
    await save();
    return {contact,listing,items,save};
  }
  it('saves exact edited text and time, skips individually and skips all', async () => {
    const f = await fixture();
    let rows = (await db.query('select * from sa_report_followup_items where contact_id=$1 order by step_key',[f.contact])).rows;
    expect(rows.every((r:any)=>r.status==='scheduled' && r.armed_at===null)).toBe(true);
    const edits = f.items.map((i,n)=>({...i,version:rows[n].version,body:n===0?'My exact edit':i.body,enabled:n!==1}));
    await f.save(edits);
    rows = (await db.query('select * from sa_report_followup_items where contact_id=$1 order by step_key',[f.contact])).rows;
    expect(rows[0].body).toBe('My exact edit'); expect(rows[0].status).toBe('edited'); expect(rows[1].status).toBe('skipped');
    await f.save(edits.map((i,n)=>({...i,version:rows[n].version,enabled:false})));
    expect((await db.query("select count(*)::int n from sa_report_followup_items where contact_id=$1 and status='skipped'",[f.contact])).rows[0].n).toBe(3);
  });
  it('rejects past dates, night dates and stale edits', async () => {
    const f = await fixture();
    await expect(f.save(f.items.map(i=>({...i,version:1,scheduled_for:'2020-01-01T10:00:00Z'})))).rejects.toThrow(/future/i);
    await expect(f.save(f.items.map(i=>({...i,version:1,scheduled_for:'2030-01-01T22:00:00Z'})))).rejects.toThrow(/London/i);
    await expect(f.save()).rejects.toThrow(/changed/i);
  });
  it.each(['Not interested','Do not contact','Onboarded'])('cancels immediately for stage %s', async (name) => {
    const f = await fixture(); const stage=randomUUID();
    await db.query('insert into wk_pipeline_columns(id,pipeline_id,name,position) values($1,$2,$3,0)',[stage,randomUUID(),name]);
    await db.query('update wk_contacts set pipeline_column_id=$1 where id=$2',[stage,f.contact]);
    expect((await db.query("select count(*)::int n from sa_report_followup_items where contact_id=$1 and status='cancelled'",[f.contact])).rows[0].n).toBe(3);
  });
  it.each(['sms','email'])('any %s reply cancels all remaining items', async channel => {
    const f=await fixture();
    await db.query("insert into wk_sms_messages(contact_id,direction,channel,body,status) values($1,'inbound',$2,'Sounds good','received')",[f.contact,channel]);
    expect((await db.query("select count(*)::int n from sa_report_followup_items where contact_id=$1 and status='cancelled'",[f.contact])).rows[0].n).toBe(3);
  });
  it('booking a callback cancels all pending items', async()=>{
    const f=await fixture();
    await db.query("insert into wk_contact_followups(contact_id,agent_id,due_at) values($1,$2,now()+interval '2 days')",[f.contact,agent]);
    expect((await db.query("select count(*)::int n from sa_report_followup_items where contact_id=$1 and status='cancelled'",[f.contact])).rows[0].n).toBe(3);
  });
  it('only one concurrent sender can claim, and never before arming', async()=>{
    const f=await fixture();
    const item=(await db.query('select * from sa_report_followup_items where contact_id=$1 order by step_key limit 1',[f.contact])).rows[0];
    expect((await db.query('select sa_claim_report_followup($1,$2) ok',[item.id,item.version])).rows[0].ok).toBe(false);
    // The clock is injectable only in this local database so the night gate is exercised deterministically.
    await db.query("create or replace function sa_followup_now() returns timestamptz language sql volatile as $$select '2030-01-01T12:00:00Z'::timestamptz$$");
    await db.query("update sa_report_followup_items set armed_at=now(),scheduled_for='2030-01-01T11:00:00Z' where id=$1",[item.id]);
    const a=await connect(),b=await connect();
    try { const results=await Promise.all([a.query('select sa_claim_report_followup($1,$2) ok',[item.id,item.version]),b.query('select sa_claim_report_followup($1,$2) ok',[item.id,item.version])]); expect(results.map(r=>r.rows[0].ok).sort()).toEqual([false,true]); }
    finally { await a.end();await b.end(); }
    expect((await db.query('select sa_claim_report_followup($1,$2) ok',[item.id,item.version])).rows[0].ok).toBe(false);
    await db.query('create or replace function sa_followup_now() returns timestamptz language sql volatile as $$select clock_timestamp()$$');
  });
});
