import { useState } from 'react';
import { Phone } from 'lucide-react';
import { cn } from '@/core/lib/cn';

interface DialPadProps {
  onCall: (number: string) => void;
}

const KEYS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['*', '0', '#'],
];

export default function DialPad({ onCall }: DialPadProps) {
  const [number, setNumber] = useState('');

  return (
    <div className="space-y-2">
      <input
        value={number}
        onChange={(e) => setNumber(e.target.value)}
        placeholder="+44 7XXX XXX XXX"
        className="w-full px-3 py-2 text-sm bg-white border border-[#E5E5E5] rounded-[10px] text-center font-medium text-[#0A0A0A] tabular-nums focus:outline-none focus:ring-2 focus:ring-[#3C5A87]/30 focus:border-[#3C5A87]"
      />
      <div className="grid grid-cols-3 gap-1.5">
        {KEYS.flat().map((k) => (
          <button
            key={k}
            onClick={() => setNumber((n) => n + k)}
            className="h-10 rounded-[10px] bg-[#F3F3EE] hover:bg-[#3C5A87]/10 hover:text-[#3C5A87] text-base font-medium text-[#1A1A1A] transition-colors"
          >
            {k}
          </button>
        ))}
      </div>
      <button
        onClick={() => number && onCall(number)}
        disabled={!number}
        className={cn(
          'w-full h-10 rounded-[10px] flex items-center justify-center gap-2 text-sm font-semibold transition-all',
          number
            ? 'bg-[#3C5A87] text-white hover:bg-[#3C5A87]/90 shadow-[0_4px_12px_rgba(30,154,128,0.35)]'
            : 'bg-[#E5E7EB] text-[#9CA3AF] cursor-not-allowed'
        )}
      >
        <Phone className="w-4 h-4" strokeWidth={2.2} />
        Call
      </button>
    </div>
  );
}
