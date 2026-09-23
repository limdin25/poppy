// The Serviced Accommodation call room: Pedro on the phone to a letting agent
// about a city-centre flat to rent (SA desk, Hugo 2026-09-23).
//
// Same three columns as the property and auction rooms, so the desks feel like
// one tool:
//   COL 1  who is on the phone, the next step, and the Flat tab
//   COL 2  the SA script, filled from the flat
//   COL 3  Coach, Email and Messages
//
// Its own component rather than a mode of AuctionCallRoom or PropertyCallRoom:
// each of those reads facts that mean nothing for a rental (lots, offers,
// ballparks, builders), one wrong prop away from Pedro's other desks.
//
// Outbound (DialerProPage) and inbound (LiveCallScreen) both mount this.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Building2, PhoneIncoming } from 'lucide-react';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/features/crm/ui/resizable';
import DialerScriptPane from './DialerScriptPane';
import DialerRightTabs from './DialerRightTabs';
import SaListingPane from './SaListingPane';
import NextStepPanel from '../shared/NextStepPanel';
import { useSaListings, saScriptTokens } from '../../hooks/useSaListings';
import type { Contact } from '../../types';

export interface SaCallRoomProps {
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

export default function SaCallRoom({
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
}: SaCallRoomProps) {
  const { listings } = useSaListings(contact?.id);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const handleSelect = useCallback((id: string) => setSelectedId(id), []);
  // A new agency is a different flat.
  useEffect(() => { setSelectedId(null); }, [contact?.id]);

  // Newest flat by default: it is the one this call is about.
  const selected = useMemo(
    () => listings.find((l) => l.id === selectedId) ?? listings[0] ?? null,
    [listings, selectedId],
  );
  const nextStep = contact?.customFields?.next_step ?? null;

  return (
    <ResizablePanelGroup
      direction="horizontal"
      autoSaveId={autoSaveId ?? 'dialer-pro-sa-layout-v1'}
      className="h-full"
    >
      <ResizablePanel defaultSize={34} minSize={18} className="bg-white border-r border-[#E5E7EB] flex flex-col overflow-hidden">
        {contact ? (
          <>
            {contactHeader}
            <NextStepPanel value={nextStep} />
            <div className="flex items-center gap-1.5 px-4 py-2 border-b border-[#E5E7EB] text-[10px] font-bold uppercase tracking-wide text-[#9CA3AF] flex-shrink-0">
              <Building2 className="w-3 h-3" />
              <span>The flat</span>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden" data-testid="dialer-sa-panel">
              <SaListingPane
                contactId={contact.id}
                selectedId={selected?.id ?? null}
                onSelect={handleSelect}
                currentCallId={currentCallId}
              />
            </div>
          </>
        ) : (
          emptyState ?? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
              <Building2 className="w-8 h-8 text-[#E5E7EB]" />
              <div className="text-sm font-medium text-[#9CA3AF]">No letting agent on the line</div>
              <div className="text-xs text-[#9CA3AF]">No flats in the queue</div>
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
                <b>They rang you.</b> Thank them for calling back, then ask what the landlord said.
              </span>
            </div>
          )}
          <div className="min-h-0 flex-1">
            <DialerScriptPane
              key={selected?.id ?? 'no-flat'}
              contact={contact}
              scriptKey="sa_call"
              extraTokens={saScriptTokens(selected)}
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
          saCall
          saListing={selected}
        />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
