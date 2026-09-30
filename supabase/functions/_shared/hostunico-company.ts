// Verified 30 September 2026 against Hostunico owner release 4e51e24:
// src/core/hostunico/domain.ts, apps/hostunico/src/legal.ts and report copy.
// Experience, payouts and coverage: Hostunico University curriculum, release
// 41eefb3. Hugo's current pricing and call instructions override older copy.
export const HOSTUNICO_COMPANY = {
  brand: 'Hostunico',
  legalName: 'ULINC UNICO GROUP LTD.',
  companyNumber: '11197856',
  registeredAddress: '483 Green Lanes, London, England, N13 4BS',
  website: 'https://hostunico.com',
  supportEmail: 'hello@unicohost.com',
  registry: 'https://find-and-update.company-information.service.gov.uk/company/11197856',
} as const;

export const HOSTUNICO_COMPANY_ANSWERS = [
  { key: 'company-registration', title: 'Company details', match: /\b(company (?:name|number|registration)|registration number|registered company|legal (?:name|entity)|companies house)\b/i, say: `${HOSTUNICO_COMPANY.brand} is a trading name of ${HOSTUNICO_COMPANY.legalName} Our company number is ${HOSTUNICO_COMPANY.companyNumber}.` },
  { key: 'company-address', title: 'Our registered address', match: /\b(?:(?:your|company|registered|office|business) address|where are you (?:based|located)|where is your office)\b/i, say: `Our registered address is ${HOSTUNICO_COMPANY.registeredAddress}.` },
  { key: 'company-website', title: 'Our website', match: /\b(your website|company website|web address|find you online)\b/i, say: 'Our website is hostunico.com.' },
  { key: 'company-email', title: 'Contact the team', match: /\b(your email(?: address)?|company email|contact email|email (?:you|your team)|contact your team)\b/i, say: `You can reach our team at ${HOSTUNICO_COMPANY.supportEmail}.` },
  { key: 'company-experience', title: 'Our experience', match: /\b(your experience|how experienced|track record|how long have you|how many properties have you managed)\b/i, say: 'Our team has managed 200 properties over four years.' },
  { key: 'company-coverage', title: 'Where we operate', match: /\b(which cities|what areas do you cover|where do you operate|do you cover (?:manchester|liverpool))\b/i, say: 'Our confirmed operating cities are Manchester and Liverpool. We can check the arrangements for your specific property.' },
  { key: 'owner-payouts', title: 'Who receives the money', match: /\b(who (?:gets|receives) (?:the )?(?:money|payouts?|booking (?:money|payments))|hold my money|paid directly|pay me directly)\b/i, say: 'Normally the booking platform pays you directly. Our management fee is handled separately, sometimes through an agreed Airbnb co-host payout.' },
] as const;

export const HOSTUNICO_COMPANY_KNOWLEDGE = `Verified Hostunico company knowledge. Use only the relevant fact to answer the caller, not a recital of this page.
${HOSTUNICO_COMPANY_ANSWERS.map((fact) => `${fact.title}: ${fact.say}`).join('\n')}
The London address is the registered address. Do not call it a staffed walk-in office or claim an office in each operating city. Company verification: ${HOSTUNICO_COMPANY.registry}.
Experience means historical team experience, not 200 currently managed homes, verified reviews or a current occupancy result. Current portfolio count, individual references, opening hours, named local staff and a public telephone number are not supplied. Check with Hugo rather than inventing any of these.
Services: pricing and listing operations, booking/calendar coordination, guest communication and arrival guidance, cleaning/changeover coordination, agreed maintenance arrangements and owner reporting. The owner is buying a managed service supported by our system. Actual cleaners, linen, repairs, supplies, utilities, insurance and platform charges are separate costs. Pedro handles sales; Elsie and operations coordinate delivery; Hugo oversees the business and grants owner access.
Account and money: the owner keeps their Airbnb account; start with Airbnb and consider other channels later. Connecting Airbnb does not authorise a co-host payout. Booking payouts normally go to the owner. Confirmed co-host fee receipts are credited once against management fees. Do not promise a payout date. Pricing and VAT follow the current offer rules, not old website claims that software is free forever.
Onboarding: confirm property facts, authority and permissions; prepare furnishing, room essentials and photos; choose and test access; agree cleaning, linen and an emergency contact; accept the management agreement; submit for team review. Checklist completion alone is not approval to launch. Hugo grants portal access and the team confirms readiness and start date. Owner portal covers property preparation, evidence, agreement, bookings, income and operational updates. Management agreement: https://hostunico.com/management-agreement. Do not use /agreement, which is the consultant agreement.
Operations: cleaners work to agreed prices; routine supplies follow that arrangement. Elsie reviews cleaning photos and aims to finish at least one hour before agreed check-in. Physical service and spending authority depend on the property's recorded arrangements. Owner personal-use requests need team confirmation. Never promise unconfirmed 24/7 staff, universal geography or a launch date.
Property permissions: check lease, mortgage, building rules, local short-let requirements, insurance and safety evidence. Do not promise a legal workaround or that an earnings estimate establishes permission. Report assumptions, studio proxy methodology, fee basis and annual limits are in the report; explain them accurately if asked, without adding them to the short first-call pitch.
Airbnb protection: published report refers to up to US$3 million host damage protection and US$1 million host liability insurance for eligible stays, separate programmes with terms and exclusions. Do not describe all damage as covered or sell this as Hostunico insurance.
Ending service: the published agreement allows cancellation within 14 days after acceptance by email or a portal offboarding request. If an early start was separately requested, proportionate agreed services provided may be payable. After that period, the team agrees the effective date, booking handover and final fees. Termination does not automatically cancel guest bookings. Do not invent a fixed notice period or promise a refund.
Complaints and privacy: contact ${HOSTUNICO_COMPANY.supportEmail} or use the owner portal; include the property and issue. The team records and reviews it, with management review if unresolved. Urgent safety/access incidents use the property's agreed urgent contact, not the complaints form. Shared report activity follows its published privacy controls and tracks the link, not a verified individual.
When a prospect corrects a fact or adds detail, answer their latest meaning and discard earlier assumptions. If your earlier suggestion no longer fits, give a fresh usable line. Keep company facts separate from facts about the prospect's property. Never fill an unknown with a plausible company claim.`;
