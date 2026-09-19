// The auction call room: Pedro on the phone to an auction office about the
// unsold lots it holds (Auction desk, Hugo 2026-09-18).
//
// Same three columns as the property room, deliberately, so the two desks feel
// like one tool:
//   COL 1  who is on the phone, the next step, and the Lots tab
//   COL 2  the auction script, filled from the lot selected in the Lots tab
//   COL 3  Coach and Messages
//
// Its own component rather than a mode of PropertyCallRoom. That room stamps
// lead_type 'estate_agent' on the contact, reads the offer strip, the
// ballpark and the builder box, and every one of those is about an estate
// agent's house. Bending it to fit an auctioneer would put all of that one
// wrong prop away from Pedro's Houses calls.
//
// Outbound (DialerProPage) and inbound (LiveCallScreen) both mount this.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Gavel, PhoneIncoming } from 'lucide-react';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/features/crm/ui/resizable';
import DialerScriptPane from './DialerScriptPane';
import DialerRightTabs from './DialerRightTabs';
import LotsPane from './LotsPane';
import NextStepPanel from '../shared/NextStepPanel';
import { useAuctionLots, lotScriptTokens } from '../../hooks/useAuctionLots';
import type { Contact } from '../../types';

export interface AuctionCallRoomProps {
  contact: Contact | null;
  contactHeader?: ReactNode;
  emptyState?: ReactNode;
  currentCallId: string | null;
  callConnected: boolean;
  liveDurationSec?: number;
  agentFirstName: string;
  campaignId?: string | null;
  pipelineId?: string | null;
  direction: 'outbound' | 'inbound';
  autoSaveId?: string;
}

export default function AuctionCallRoom({
  contact,
  contactHeader,
  emptyState,
  currentCallId,
  callConnected,
  liveDurationSec,
  agentFirstName,
  campaignId = null,
  pipelineId = null,
  direction,
  autoSaveId,
}: AuctionCallRoomProps) {
  const { lots } = useAuctionLots(contact?.phone);
  const [selectedLotId, setSelectedLotId] = useState<string | null>(null);
  const handleSelectLot = useCallback((id: string) => setSelectedLotId(id), []);
  // A new office is a different auctioneer; its lots are not this one's.
  useEffect(() => { setSelectedLotId(null); }, [contact?.id]);

  // First live lot by default, which is the RPC's order: live before gone,
  // biggest discount on strong evidence first.
  const selectedLot = useMemo(
    () => lots.find((l) => l.id === selectedLotId) ?? lots.find((l) => !l.withdrawn) ?? lots[0] ?? null,
    [lots, selectedLotId],
  );
  const nextStep = contact?.customFields?.next_step ?? null;

  return (
    <ResizablePanelGroup
      direction="horizontal"
      autoSaveId={autoSaveId ?? 'dialer-pro-auction-layout-v1'}
      className="h-full"
    >
      <ResizablePanel defaultSize={34} minSize={18} className="bg-white border-r border-[#E5E7EB] flex flex-col overflow-hidden">
        {contact ? (
          <>
            {contactHeader}
            <NextStepPanel value={nextStep} />
            <div className="flex items-center gap-1.5 px-4 py-2 border-b border-[#E5E7EB] text-[10px] font-bold uppercase tracking-wide text-[#9CA3AF] flex-shrink-0">
              <Gavel className="w-3 h-3" />
              <span>Lots</span>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden" data-testid="dialer-lots-panel">
              <LotsPane
                contactPhone={contact.phone}
                selectedLotId={selectedLot?.id ?? null}
                onSelectLot={handleSelectLot}
                currentCallId={currentCallId}
              />
            </div>
          </>
        ) : (
          emptyState ?? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
              <Gavel className="w-8 h-8 text-[#E5E7EB]" />
              <div className="text-sm font-medium text-[#9CA3AF]">No auction office on the line</div>
              <div className="text-xs text-[#9CA3AF]">No lots in the queue</div>
            </div>
          )
        )}
      </ResizablePanel>

      <ResizableHandle withHandle />

      <ResizablePanel defaultSize={40} minSize={26} className="border-r border-[#E5E7EB] overflow-hidden">
        <div className="flex h-full flex-col">
          {direction === 'inbound' && (
            <div
              className="flex items-start gap-2 border-b border-[#F0DFB0] bg-[#FFF8EC] px-3 py-2 text-[11.5px] leading-snug text-[#5a4a20]"
              data-testid="inbound-callback-line"
            >
              <PhoneIncoming className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-[#8a6d1a]" />
              <span>
                <b>They rang you.</b> Thank them for calling back, then pick up from what you asked last time.
              </span>
            </div>
          )}
          <div className="min-h-0 flex-1">
            <DialerScriptPane
              key={selectedLot?.id ?? 'no-lot'}
              contact={contact}
              scriptKey="auction_call"
              extraTokens={lotScriptTokens(selectedLot)}
            />
          </div>
        </div>
      </ResizablePanel>

      <ResizableHandle withHandle />

      <ResizablePanel defaultSize={26} minSize={16} className="overflow-hidden">
        <DialerRightTabs
          contactId={contact?.id ?? undefined}
          contactName={contact?.name}
          contactPhone={contact?.phone}
          contactEmail={contact?.email}
          ownerName={contact?.customFields?.owner_name}
          agentFirstName={agentFirstName}
          campaignId={campaignId}
          pipelineId={pipelineId}
          currentCallId={currentCallId}
          callConnected={callConnected}
          liveDurationSec={liveDurationSec}
          auctionCall
        />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
