import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
const { Client } = createRequire(import.meta.url)('pg');
import { prepareSpareRoomImport } from '../scripts/lib/hostunico-spareroom.mjs';

// Hugo, 2026-10-14: a phone number is never added twice to the CRM.
const migration = readFileSync('supabase/migrations/20261014000002_phone_never_duplicated.sql', 'utf8');
describe('phone never duplicated, contract', () => {
  it('registers past calls, refuses direct duplicates and offers a strict import door', () => {
    expect(migration).toContain('create trigger zz_wk_calls_register_phone');
    expect(migration).toContain("raise exception 'Phone number already belongs to another contact' using errcode='23505'");
    expect(migration).toContain('create or replace function public.wk_admit_new_contact');
    expect(migration).toContain('add constraint wk_contacts_phone_normalized_new');
    expect(migration).not.toMatch(/delete from (?:public\.)?wk_(calls|contacts)/i);
  });
});

describe('one import groups by normalised phone', () => {
  const row = (id: number, number: string) => ({ Number: number, Link: `https://www.spareroom.co.uk/flatshare/flatshare_detail.pl?flatshare_id=${id}`, Price: '900 pcm', Name: `Flat ${id}`, Location: 'Leeds', 'Advertiser Name': 'Agency' });
  it('the same number in three formats yields one contact', () => {
    const plan = prepareSpareRoomImport([row(1, '07700 900701'), row(2, '+447700900701'), row(3, '447700900701')]);
    expect(plan.contacts).toHaveLength(1);
    expect(plan.contacts[0].phone).toBe('+447700900701');
  });
  it('an agency with three listings gives one contact and three listings', () => {
    const plan = prepareSpareRoomImport([row(11, '07700900702'), row(12, '07700 900 702'), row(13, '+44 7700 900702')]);
    expect(plan.contacts).toHaveLength(1);
    expect(plan.contacts[0].properties).toHaveLength(3);
    expect(plan.properties).toHaveLength(3);
  });
});

const adminUrl = process.env.PHONE_TEST_DATABASE_URL;
describe.skipIf(!adminUrl)('phone never duplicated, PostgreSQL', () => {
  let admin: any, db: any;
  const database = `phone_never_dup_${process.pid}`;
  beforeAll(async () => {
    if (!['localhost', '127.0.0.1'].includes(new URL(adminUrl!).hostname)) throw new Error('Local tests only');
    admin = new Client({ connectionString: adminUrl }); await admin.connect();
    for (const role of ['anon', 'authenticated', 'service_role']) {
      if (!(await admin.query('select 1 from pg_roles where rolname=$1', [role])).rowCount) await admin.query(`create role ${role}`);
    }
    await admin.query(`create database ${database}`);
    const u = new URL(adminUrl!); u.pathname = '/' + database;
    db = new Client({ connectionString: u.toString() }); await db.connect();
    await db.query(readFileSync('tests/sql/phone-dedupe-fixture.sql', 'utf8'));
    // A call made before this migration, to a number with no contact any more.
    await db.query("insert into wk_calls(direction,from_e164,to_e164) values('outbound','+447462167894','+447700900500')");
    await db.query(readFileSync('supabase/migrations/20261006000003_phone_identity_and_cooldown.sql', 'utf8'));
    await db.query(migration);
  }, 30000);
  afterAll(async () => { await db?.end(); if (admin) { await admin.query(`drop database if exists ${database}`); await admin.end(); } });
  const admit = async (phone: string, desk = 'sa') => (await db.query('select wk_admit_new_contact($1::jsonb) id', [JSON.stringify({ name: 'Agency', phone, desk })])).rows[0].id as string | null;

  it('the same number in three formats yields one contact', async () => {
    const first = await admit('07700 900601');
    expect(first).toBeTruthy();
    expect(await admit('+447700900601')).toBeNull();
    expect(await admit('447700900601')).toBeNull();
    expect((await db.query("select count(*)::int n from wk_contacts where normalized_phone='+447700900601'")).rows[0].n).toBe(1);
  });
  it('skips a number on another desk, in a past call or on do-not-call', async () => {
    await db.query("select wk_ingest_contacts('[{\"name\":\"Houses lead\",\"phone\":\"07700900602\",\"desk\":\"houses\"}]')");
    expect(await admit('+44 7700 900602')).toBeNull();
    expect(await admit('07700900500')).toBeNull();
    await db.query("insert into wk_calls(direction,from_e164,to_e164) values('inbound','+447700900603','+447462167894')");
    expect(await admit('07700900603')).toBeNull();
    const dnc = randomUUID();
    await db.query("insert into wk_contacts(id,name,phone,do_not_call) values($1,'Stop','07700900604',true)", [dnc]);
    await db.query('delete from wk_contacts where id=$1', [dnc]);
    expect(await admit('07700900604')).toBeNull();
    expect((await db.query("select count(*)::int n from wk_contacts where normalized_phone in ('+447700900500','+447700900603','+447700900604')")).rows[0].n).toBe(0);
  });
  it('a direct duplicate insert fails at the database', async () => {
    await expect(db.query("insert into wk_contacts(name,phone) values('Direct','+447700900601')")).rejects.toMatchObject({ code: '23505' });
    await expect(db.query("insert into wk_contacts(name,phone) values('Direct','07700900500')")).rejects.toMatchObject({ code: '23505' });
    await expect(db.query("insert into wk_contacts(name,phone) values('Bad','12')")).rejects.toThrow();
  });
  it('wk_ingest_contacts still folds an incoming lead into its existing contact', async () => {
    const id = (await db.query("select id from wk_ingest_contacts('[{\"name\":\"Again\",\"phone\":\"07700900602\"}]')")).rows[0].id;
    expect((await db.query("select id from wk_contacts where normalized_phone='+447700900602'")).rows[0].id).toBe(id);
    expect((await db.query("select count(*)::int n from wk_contacts where normalized_phone='+447700900602'")).rows[0].n).toBe(1);
  });
});
