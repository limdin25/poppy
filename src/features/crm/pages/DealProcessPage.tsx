// Deal process — its own item in the CRM menu, sitting under Templates.
//
// Hugo 2026-08-12: "it should not be inside the templates, it should be below
// the templates on the menu."
//
// It is a page rather than a tab because Pedro opens it while he is on a call
// and needs it to survive a refresh at its own URL.

import PropertyDealProcess from '../components/templates/PropertyDealProcess';

export default function DealProcessPage() {
  return (
    <div className="h-full flex flex-col bg-[#F3F3EE]">
      <div className="bg-white border-b border-[#E5E7EB] px-6 py-4">
        <h1 className="text-[20px] font-bold text-[#1A1A1A]">Deal process</h1>
        <p className="text-[12px] text-[#6B7280] mt-0.5">
          Every step from the first call to getting paid, and the message to send at each one.
        </p>
      </div>
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-3xl mx-auto">
          <PropertyDealProcess />
        </div>
      </div>
    </div>
  );
}
