import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@/index.css';
import ReportFollowupsDialog from '@/features/crm/components/followups/ReportFollowupsDialog';
import { buildFollowupPlan } from '@/core/hostunicoFollowupPlan';
import { HOSTUNICO_FOLLOWUP } from '@/core/hostunicoFollowup';

function Test() {
  const [open,setOpen]=useState(false);
  const [result,setResult]=useState('');
  const [plan]=useState(()=>({name:'Alex Morgan',items:buildFollowupPlan(HOSTUNICO_FOLLOWUP,{name:'Alex Morgan',property:'24 Test Street, London',reportUrl:'https://hostunico.com/r/test-preview',channel:'sms'})}));
  return <main className="min-h-screen bg-slate-50 p-10"><h1 className="text-2xl font-semibold">Hostunico</h1><p className="my-3 text-sm text-slate-500">Synthetic contact. This test cannot send messages.</p><button onClick={()=>setOpen(true)} className="rounded-xl bg-slate-950 px-5 py-3 text-white">Review report</button><output data-testid="submitted">{result}</output><ReportFollowupsDialog open={open} onClose={()=>setOpen(false)} plan={plan} onConfirm={async items=>{setResult(JSON.stringify(items));}} /></main>;
}
createRoot(document.getElementById('root')!).render(<Test />);
