// The property call room. ONE room, whether Pedro rang them or they rang him.
//
// WHY THIS FILE EXISTS (2026-08-18). Pedro, by WhatsApp:
//
//   "if someone is ringing me back regarding a property i am inquiring about,
//    I cant find the property info on hey elsie"
//   "the transition of hey elsie from dialer to when I answer an incoming call
//    is very different and its difficult to find information"
//
// He was right. Dialling out gave him the offer band, the property script, the
// Houses panel and the coach. Answering gave him a different screen with none
// of it, because every one of those panels was mounted inside DialerProPage and
// nowhere else. Bolting copies onto the inbound screen would have re-created the
// exact drift he was complaining about, so the layout moved HERE and both
// screens mount this.
//
//   outbound  DialerProPage      -> PropertyCallRoom
//   inbound   LiveCallScreen     -> PropertyCallRoom
//
// The three columns are unchanged from the room Pedro has worked in since
// 12 Aug: COL 1 next step + Houses, COL 2 offer band pinned above the script,
// COL 3 Coach / Email / Messages. The tests that used to read those columns out
// of DialerProPage.tsx now read them out of this file, so they cover both.
//
// WHAT DIFFERS BY DIRECTION, and it is deliberately only two things:
//   - which house is selected first (see defaultInboundListingId)
//   - one line above the script saying they rang us
// Everything else, including which of the two call scripts shows, is decided by
// the deal itself and is identical in both directions.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, Home, PhoneIncoming } from 'lucide-react';
import { supabase } from '@/integrations/supabase/browser';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/features/crm/ui/resizable';
import DialerScriptPane from './DialerScriptPane';
import DialerRightTabs from './DialerRightTabs';
import OfferStrip from './OfferStrip';
import PropertiesPane from './PropertiesPane';
import NextStepPanel from '../shared/NextStepPanel';
import { callModeForCard } from '../../lib/nextStep';
import { spokeWhenPhrase, propertyOpenerLine } from '../../lib/spokeWhen';
import { useBranchLastCall } from '../../hooks/useBranchLastCall';
import { useSmsV2 } from '../../store/SmsV2Store';
import {
  usePropertyListings,
  scriptTokensFor,
  discoveryScriptTokensFor,
  offerHouseFor,
  defaultInboundListingId,
} from '../../hooks/usePropertyListings';
import type { Contact } from '../../types';

export interface PropertyCallRoomProps {
  /** The branch on the phone. Null is a real state on an inbound call from a
   *  number we do not hold: the room still opens, with the search box in COL 1
   *  and the call-one script on screen, so Pedro is never left scriptless. */
  contact: Contact | null;
  /** COL 1's top card. Passed in rather than rebuilt here because the two
   *  rooms know different things about who is on the phone: the dialer can
   *  rename the lead inline and show the queue position, the inbound screen
   *  shows the caller's number and the branch search. */
  contactHeader?: ReactNode;
  /** COL 1's body when there is no contact. The inbound room puts the branch
   *  search here. */
  emptyState?: ReactNode;
  /** The live wk_calls row. Everything that files against the call needs it:
   *  the coach, the transcript, the outcome buttons, the name capture. */
  currentCallId: string | null;
  callConnected: boolean;
  liveDurationSec?: number;
  agentFirstName: string;
  campaignId?: string | null;
  pipelineId?: string | null;
  /** Who rang whom. Changes the default house and adds the callback line. */
  direction: 'outbound' | 'inbound';
  /** Saved column widths. The two rooms keep separate ones so dragging the
   *  inbound layout does not move the dialer Pedro has already set up. */
  autoSaveId?: string;
}

export default function PropertyCallRoom({
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
}: PropertyCallRoomProps) {
  const { listings } = usePropertyListings(contact?.phone);
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null);
  const handleSelectProperty = useCallback((id: string) => setSelectedPropertyId(id), []);

  // A new branch is a different agency, so the old selection is not merely
  // stale, it is another branch's house with another branch's numbers.
  useEffect(() => { setSelectedPropertyId(null); }, [contact?.id]);

  // WHICH HOUSE OPENS FIRST.
  //
  // Outbound: the best deal, which is the order the RPC already returns and the
  // reason Pedro is ringing this branch at all.
  //
  // Inbound: whatever was last discussed. They are ringing back about a
  // conversation that already happened, and on a branch with eleven listings
  // the biggest margin is almost never the one they mean. This is the whole of
  // Pedro's original complaint: "it doesnt show the property I am inquiring
  // about".
  const preferredId = useMemo(
    () => (direction === 'inbound'
      ? defaultInboundListingId(listings, contact?.customFields)
      : listings[0]?.id ?? null),
    [direction, listings, contact?.customFields],
  );
  const effectiveSelectedId = selectedPropertyId ?? preferredId;
  const selectedListing = useMemo(
    () => listings.find((l) => l.id === effectiveSelectedId) ?? listings[0] ?? null,
    [listings, effectiveSelectedId],
  );

  // Which of the two calls this branch is on. The same switch the offer strip,
  // the Email tab and the pipeline card read, so nothing on screen can think it
  // is a different call from anything else on screen. Unknown or missing steps
  // are DISCOVERY, which is the view with no money on it, so a branch we cannot
  // identify (an inbound call from a number we do not hold) is call one by
  // construction rather than by luck.
  const nextStep = contact?.customFields?.next_step ?? contact?.customFields?.deal_stage;

  // Which of the two calls this is, computed ONCE and passed down, so the
  // script pane, the offer strip, the Email tab and the SMS box can never
  // disagree. Three promote-only votes: the step tag, the confirmed ballpark
  // (both inside callModeForCard via callModeForStep), and the card's own
  // board column, because "call it from the Ready for call 2 column" IS the
  // instruction to make call two (Hugo 2026-08-18), even when a no_answer has
  // knocked the step tag back or the card was dragged there by hand.
  const { getColumn } = useSmsV2();
  const columnName = contact?.pipelineColumnId
    ? getColumn(contact.pipelineColumnId)?.name ?? null
    : null;
  const callMode = callModeForCard(nextStep, contact?.customFields, columnName);

  // The callback facts, browser-only. They ride into the script as extra
  // tokens and are NEVER persisted: the write-back below sends only listing
  // facts, so "we spoke yesterday" can never be filed onto the contact.
  const { lastSpoke } = useBranchLastCall(contact?.phone, currentCallId);
  const branchContactName =
    (((selectedListing?.qualification as Record<string, unknown> | null | undefined)
      ?.branch_contact_name as string | undefined) ?? '').trim()
    || (contact?.customFields?.branch_contact_name ?? '').trim();
  const spokeWhen = spokeWhenPhrase(lastSpoke?.at ?? selectedListing?.last_call_at ?? null);

  // The coach's opener card reads the first blue line of whichever call this
  // is, filled from the same facts as the script, so the two can never
  // disagree. Before this the card showed the PLUMBER opener on every
  // property call.
  const openerTokens: Record<string, string> = selectedListing
    ? scriptTokensFor(selectedListing)
    : discoveryScriptTokensFor(contact?.customFields);
  const propertyOpener = propertyOpenerLine({
    callMode,
    street: openerTokens.property_street,
    bedrooms: openerTokens.bedrooms,
    propertyType: openerTokens.property_type,
    contactName: branchContactName,
    spokeWhen,
  });

  // Push the selected property's figures onto the CONTACT.
  //
  // The live coach is driven by Twilio, not the browser: it rebuilds its whole
  // context from the database on every caller utterance and cannot see what is
  // on screen. Without this write the coach would coach the headline property
  // while the agent talks about the third one down, naming the wrong opening
  // figure out loud. Same reason wk_calls.script_key exists at all.
  //
  // Guarded on a SELECTED LISTING, which is what keeps it honest on an inbound
  // call: a contact with no houses on file is never stamped lead_type
  // 'estate_agent' by a room that merely happened to open for them.
  const syncedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedListing || !contact?.id) return;
    const contactId = contact.id;
    const key = `${contactId}:${selectedListing.id}`;
    if (syncedRef.current === key) return;   // only on a real change
    syncedRef.current = key;
    void (async () => {
      // Merge, never replace: custom_fields also holds who owns the lead, the
      // agency name and anything an admin typed by hand.
      const { data: row } = await supabase
        .from('wk_contacts').select('custom_fields').eq('id', contactId).maybeSingle();
      const facts: Record<string, string> = { ...scriptTokensFor(selectedListing) };
      // A CONFIRMED BALLPARK IS NEVER UNLEARNED (same law as callModeForStep).
      // Flicking to an unpriced sibling listing produces offer_open:'' by
      // design, so the coach never carries one house's figure onto another,
      // but an empty string must not blank the branch's agreed figures written
      // by applyBallpark: offer_open is the second arming signal for call two,
      // and blanking it silently demoted the deal back to the discovery
      // script on the next open.
      const existing = (row?.custom_fields ?? {}) as Record<string, string>;
      for (const k of ['offer_open', 'offer_ceiling', 'ladder'] as const) {
        if (!facts[k] && existing[k]) delete facts[k];
      }
      const merged = { ...(row?.custom_fields ?? {}), ...facts, lead_type: 'estate_agent' };
      await supabase.from('wk_contacts')
        .update({ custom_fields: merged }).eq('id', contactId);
    })();
  }, [selectedListing, contact?.id]);

  return (
    <ResizablePanelGroup
      direction="horizontal"
      autoSaveId={autoSaveId ?? 'dialer-pro-houses-layout-v1'}
      className="h-full"
    >
      {/* COL 1 — who is on the phone, what to do next, and the houses */}
      <ResizablePanel defaultSize={32} minSize={16} className="bg-white border-r border-[#E5E7EB] flex flex-col overflow-hidden">
        {contact ? (
          <>
            {contactHeader}
            {/* What to do with this one next, where the SMS fold-out used to be.
                Hugo 2026-08-12: the SMS history moved to the Messages tab on
                the right, next to the message history it belongs with, and the
                next step took its place because it is what he needs before he
                dials. */}
            <NextStepPanel value={nextStep} />
            {/* The house, underneath it, scrolling on its own so the contact
                header and the SMS strip stay put.
                Still called Houses: the coach, the training questions and the
                daily report all tell Pedro to write the figure down "in the
                Houses tab", and those words have to point at something he can
                see. */}
            <div className="flex items-center gap-1.5 px-4 py-2 border-b border-[#E5E7EB] text-[10px] font-bold uppercase tracking-wide text-[#9CA3AF] flex-shrink-0">
              <Home className="w-3 h-3" />
              <span>Houses</span>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden" data-testid="dialer-houses-panel">
              <PropertiesPane
                contactPhone={contact.phone}
                selectedPropertyId={effectiveSelectedId}
                onSelectProperty={handleSelectProperty}
                currentCallId={currentCallId}
              />
            </div>
          </>
        ) : (
          emptyState ?? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
              <Home className="w-8 h-8 text-[#E5E7EB]" />
              <div className="text-sm font-medium text-[#9CA3AF]">Contact details</div>
              <div className="text-xs text-[#9CA3AF]">No leads in queue</div>
            </div>
          )
        )}
      </ResizablePanel>

      <ResizableHandle withHandle />

      {/* COL 2 — the script, with the offer band PINNED above it, because the
          moment those three figures scroll off screen is the moment an agent
          guesses at them. */}
      <ResizablePanel defaultSize={40} minSize={26} className="border-r border-[#E5E7EB] overflow-hidden">
        <div className="flex h-full flex-col">
          <OfferStrip
            listing={selectedListing}
            total={listings.length}
            nextStep={nextStep}
            branchFields={contact?.customFields}
            callMode={callMode}
            startCollapsed
          />
          {/* They rang US. The script's opener assumes we dialled them, and
              reading a cold opener at somebody returning your call is the
              fastest way to sound like a machine. The script itself is not
              touched: this is one line above it. */}
          {direction === 'inbound' && (
            <div
              className="flex items-start gap-2 border-b border-[#F0DFB0] bg-[#FFF8EC] px-3 py-2 text-[11.5px] leading-snug text-[#5a4a20]"
              data-testid="inbound-callback-line"
            >
              <PhoneIncoming className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-[#8a6d1a]" />
              <span>
                <b>They rang you.</b> Pick up where you left off, never as a cold call.
                Thank them for calling back, then take it from the step below.
              </span>
            </div>
          )}
          {/* Call 2 script with NO armed figures. Found 2026-08-18 on Friars
              Close: the card sat in "Ready for call 2" (the disposition put it
              there) while the ballpark was never applied, so Pedro opened THE
              OFFER script and every money slot was a raw empty bracket. The
              offer strip's own warning exists but starts folded, so nothing on
              screen said stop. One line above the script, same pattern as the
              inbound banner; keyed to the SAME tokens the script fills from,
              so it shows exactly when the slots are empty. */}
          {callMode === 'offer' && !(openerTokens.offer_open ?? '').trim() && (
            <div
              className="flex items-start gap-2 border-b border-[#EBD9B4] bg-[#FDF3E3] px-3 py-2 text-[11.5px] leading-snug text-[#9A6B1E]"
              data-testid="unarmed-call2-warning"
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              <span>
                <b>No confirmed figures on this card.</b> This is the call 2
                script but the ballpark was never applied, so the money slots
                below are empty. Do not invent a number: get the facts, say the
                director is still pricing it, and book the callback. Figures are
                armed from the cockpit ballpark.
              </span>
            </div>
          )}
          <div className="min-h-0 flex-1">
            <DialerScriptPane
              contact={contact}
              scriptKey="property_call"
              // A picked house wins. With none picked, a DISCOVERY branch still
              // knows which house it is ringing about, and the facts are on the
              // contact. Without this the script showed its raw brackets on 147
              // of the 151 branches in the queue.
              extraTokens={selectedListing
                ? { ...scriptTokensFor(selectedListing), branch_contact_name: branchContactName, spoke_when: spokeWhen }
                : { ...discoveryScriptTokensFor(contact?.customFields), branch_contact_name: branchContactName, spoke_when: spokeWhen }}
              callMode={callMode}
            />
          </div>
        </div>
      </ResizablePanel>

      <ResizableHandle withHandle />

      {/* COL 3 — Coach, Email and Messages. No Calculator and no Objections:
          the Calculator sells websites and those objections answer plumbers. */}
      <ResizablePanel defaultSize={28} minSize={16} className="overflow-hidden">
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
          showHouses
          offerHouse={offerHouseFor(selectedListing)}
          // Which of the two calls this is, so the Email tab writes the video
          // request on a discovery call and the offer on call two. The
          // computed mode is the same one the script pane and the offer strip
          // received above; nextStep and branchFields still travel for the
          // mounts that receive no mode and derive their own.
          nextStep={nextStep}
          branchFields={contact?.customFields}
          callMode={callMode}
          // The first blue line of whichever call this is, for the coach's
          // opener card, so the card and the script never disagree.
          propertyOpener={propertyOpener}
          // Who he is speaking to at the branch, off the Houses checklist, so
          // the email opens with their name.
          agentPersonName={
            (selectedListing?.qualification as Record<string, unknown> | null | undefined)
              ?.branch_contact_name as string | undefined
          }
        />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
