import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { HOSTUNICO_COMPANY } from '../supabase/functions/_shared/hostunico-company';
import { hostunicoOutreachAllowed, HOSTUNICO_UPLIFT_PENDING } from '../supabase/functions/_shared/hostunico-uplift';
import { reportPhoneKind } from '../supabase/functions/_shared/hostunico-phone';
import { loadReviewedFollowup, claimReviewedFollowup, finishReviewedFollowup } from '../supabase/functions/_shared/hostunico-followup-delivery';

let tables: Record<string, any[]>, canClaim: boolean;
class Query {
  filters: ((r:any)=>boolean)[]=[];one=false;patch:any;
  constructor(private table:string){}
  select(){return this;} order(){return this;} limit(){return this;}
  eq(key:string,value:any){this.filters.push(r=>r[key]===value);return this;}
  maybeSingle(){this.one=true;return this;} single(){this.one=true;return this;}
  update(p:any){this.patch=p;return this;}
  insert(p:any){(tables[this.table]||=[]).push({id:'message',...p});return this;}
  then(resolve:any){const rows=(tables[this.table]||[]).filter(r=>this.filters.every(f=>f(r)));if(this.patch)rows.forEach(r=>Object.assign(r,this.patch));return Promise.resolve({data:this.one?rows[0]?{...rows[0]}:null:rows.map(r=>({...r})),error:null}).then(resolve);}
}
function load(channel: 'sms'|'email') {
  let handler!: (req:Request)=>Promise<Response>;
  const createClient=()=>({auth:{getUser:async()=>({data:{user:null},error:null})},from:(t:string)=>new Query(t),rpc:async(name:string)=>{
    if(name==='sa_claim_report_followup'){
      const item=tables.sa_report_followup_items[0];const allowed=canClaim && ['scheduled','edited'].includes(item.status);if(allowed)item.status='sending';return {data:allowed,error:null};
    }
    return {data:name==='wk_outbound_sms_allowed'?{allowed:true}:name==='wk_contact_locked_agent'?'agent':true,error:null};
  }});
  const code=readFileSync(`supabase/functions/wk-${channel}-send/index.ts`,'utf8').replace(/^import .*;\n/gm,'');
  const js=ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
  new Function('serve','createClient','Deno','HOSTUNICO_COMPANY','hostunicoOutreachAllowed','HOSTUNICO_UPLIFT_PENDING','reportPhoneKind','loadReviewedFollowup','claimReviewedFollowup','finishReviewedFollowup',js)(
    (fn:typeof handler)=>{handler=fn;},createClient,{env:{get:()=> 'internal-test-key'}},HOSTUNICO_COMPANY,hostunicoOutreachAllowed,HOSTUNICO_UPLIFT_PENDING,reportPhoneKind,loadReviewedFollowup,claimReviewedFollowup,finishReviewedFollowup);
  return handler;
}
beforeEach(()=>{
  canClaim=true;
  tables={
    wk_contacts:[{id:'contact',desk:'sa',owner_agent_id:'agent',phone:'+447700900986',email:'test@example.invalid',do_not_call:false}],
    profiles:[{id:'agent',workspace_role:'agent'}],
    wk_numbers:[{id:'email',e164:'hello@hostunico.com',channel:'email',provider:'resend',is_active:true},{id:'sms',e164:'+447700900987',channel:'sms',sms_enabled:true,is_active:true}],
    sa_report_followup_items:[],
  };
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({id:'email-receipt',sid:'sms-receipt',status:'queued'})));
  vi.spyOn(console,'error').mockImplementation(()=>{});
});
describe.each(['sms','email'] as const)('real %s handler with fake provider',channel=>{
  function setup(){tables.sa_report_followup_items=[{id:'item',contact_id:'contact',agent_id:'agent',channel,recipient:channel==='sms'?'+447700900986':'delivered@resend.dev',subject:'Exact subject',body:'Exact reviewed message https://hostunico.com/r/test',version:1,status:'edited',armed_at:'2026-10-01T10:00:00Z'}];return load(channel);}
  const request=()=>new Request('https://test.invalid/send',{method:'POST',headers:{Authorization:'Bearer internal-test-key'},body:JSON.stringify({report_followup_id:'item',body:'Do not use this',to_email:'wrong@example.invalid'})});
  it('sends the stored message once across simultaneous dispatches',async()=>{
    const handler=setup();await Promise.all([handler(request()),handler(request())]);
    expect(fetch).toHaveBeenCalledTimes(1);expect(tables.sa_report_followup_items[0].status).toBe('sent');
    const payload=String(vi.mocked(fetch).mock.calls[0][1]?.body);
    expect(payload).not.toContain('Do not use this');expect(payload).not.toContain('wrong@example.invalid');
    expect(tables.wk_sms_messages[0].body).toBe(tables.sa_report_followup_items[0].body);
    await handler(request());expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('does not reach the provider after a reply, booking or stage change',async()=>{
    const handler=setup();canClaim=false;await handler(request());expect(fetch).not.toHaveBeenCalled();
  });
  it('does not retry an uncertain provider timeout',async()=>{
    const handler=setup();vi.stubGlobal('fetch',vi.fn(async()=>{throw new Error('Timeout after provider accepted');}));
    await handler(request());await handler(request());expect(fetch).toHaveBeenCalledTimes(1);expect(tables.sa_report_followup_items[0].status).toBe('sending');
  });
});
