import ReactDOM from 'react-dom';
import { X, Minus, Maximize2, Phone } from 'lucide-react';
import { useDialerProModal } from './DialerProModalContext';
import { DialerProContent } from '@/features/crm/dialer-pro/DialerProPage';

export default function DialerProModal() {
  const {
    isOpen, isMinimized, contactId, pipelineColumnId, scriptKey, autoDial,
    closeDialerPro, minimizeDialerPro, expandDialerPro, clearAutoCall,
  } = useDialerProModal();

  if (!isOpen) return null;

  if (isMinimized) {
    return ReactDOM.createPortal(
      <button
        onClick={expandDialerPro}
        className="fixed bottom-6 right-6 z-[300] flex items-center gap-2.5 px-5 py-3 bg-[#3C5A87] text-white rounded-full shadow-[0_4px_16px_rgba(30,154,128,0.35)] hover:shadow-[0_8px_24px_rgba(30,154,128,0.45)] hover:scale-105 transition-all"
      >
        <Phone className="w-5 h-5" />
        <span className="text-sm font-semibold">Open Dialer</span>
        <Maximize2 className="w-4 h-4 opacity-80" />
      </button>,
      document.body,
    );
  }

  return ReactDOM.createPortal(
    <div className="fixed inset-0 z-[300] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative bg-[#F3F3EE] rounded-2xl overflow-hidden shadow-[0_24px_64px_rgba(0,0,0,0.25)]"
        style={{ width: '85vw', height: '85vh' }}
      >
        {/* Window controls — prominent bar at top-right */}
        <div className="absolute top-0 right-0 z-10 flex items-center gap-0 rounded-bl-xl overflow-hidden shadow-sm">
          <button
            onClick={minimizeDialerPro}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-white hover:bg-[#F3F3EE] text-[#6B7280] hover:text-[#1A1A1A] border-b border-l border-[#E5E7EB] transition-colors"
            title="Minimize"
          >
            <Minus className="w-4 h-4" strokeWidth={2.5} />
            <span className="text-xs font-medium">Minimize</span>
          </button>
          <button
            onClick={closeDialerPro}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-white hover:bg-red-50 text-[#6B7280] hover:text-red-600 border-b border-l border-[#E5E7EB] transition-colors"
            title="Close dialer"
          >
            <X className="w-4 h-4" strokeWidth={2.5} />
            <span className="text-xs font-medium">Close</span>
          </button>
        </div>
        <DialerProContent
          autoCallContactId={contactId}
          pipelineColumnId={pipelineColumnId}
          scriptKey={scriptKey}
          autoDial={autoDial}
          onAutoCallConsumed={clearAutoCall}
        />
      </div>
    </div>,
    document.body,
  );
}
