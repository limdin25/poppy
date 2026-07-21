// SalesScriptPane — the one-call sales script, shown live inside the
// dialer so agents read from it while they call. It renders the same
// byte-for-byte HTML we host at /script (single source in
// src/core/content) inside an iframe so the script's own styles run
// intact. Admin-controlled static content — no per-agent editing here.

import { FileText } from 'lucide-react';
import scriptHtml from '@/core/content/one-call-script.html?raw';

export default function SalesScriptPane() {
  return (
    <div className="flex flex-col h-full bg-white">
      <div className="px-4 py-2.5 border-b border-[#E5E7EB] flex items-center gap-2">
        <FileText className="w-3.5 h-3.5 text-[#3C5A87]" />
        <span className="text-[12px] font-semibold text-[#1A1A1A]">Sales script</span>
      </div>
      <iframe
        title="Sales script"
        srcDoc={scriptHtml}
        className="flex-1 w-full border-0"
      />
    </div>
  );
}
