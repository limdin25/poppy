# Build Phases

---

## Phase 1: Voice MVP (Weeks 1-4)

- [ ] Project scaffolding (Vite + React 19 + Tailwind + UI primitives)
- [ ] Supabase project creation + schema migration (all 14 tables)
- [ ] Auth flow (email sign-up, magic link, session management)
- [ ] Onboarding wizard (business details, Google Places lookup, greeting setup)
- [ ] Twilio number provisioning + SIP trunk to Retell
- [ ] Retell AI agent configuration (voice, prompt, tools)
- [ ] Retell webhook handler (call events, transcript ingestion)
- [ ] Dashboard home (call stats, recent activity)
- [ ] Calls page (list, detail view with transcript + summary)
- [ ] Agent setup page (greeting, behaviour prompt, FAQs, services, call info types)
- [ ] Stripe integration (trial, checkout, subscription management)
- [ ] Account settings (business info, team members, notification prefs)
- [ ] Contact auto-creation from inbound calls
- [ ] Basic notification emails (missed calls via Resend)

## Phase 2: Unified Inbox + WhatsApp + SMS (Weeks 5-8)

- [ ] Inbox UI (conversation list, message thread, real-time updates)
- [ ] SMS channel (Twilio inbound/outbound)
- [ ] WhatsApp channel (Unipile integration)
- [ ] AI-powered auto-replies across text channels
- [ ] Human takeover flow (assign conversation, disable AI)
- [ ] Contact management page (list, search, tags, merge)
- [ ] Conversation search and filters
- [ ] Unread badges and presence indicators

## Phase 3: Email + Booking (Weeks 9-12)

- [ ] Email channel (Unipile integration)
- [ ] Cal.com integration (availability, booking during calls)
- [ ] Appointments page (calendar view, list view)
- [ ] AI books appointments during voice calls (tool use)
- [ ] Appointment confirmation/reminder emails
- [ ] Service management page
- [ ] Business hours configuration

## Phase 4: Quotes and Invoices (Weeks 13-16)

- [ ] Quote generation (AI creates from call data)
- [ ] Quote builder UI (edit items, preview, send)
- [ ] PDF generation for quotes
- [ ] Invoice creation (from quote or standalone)
- [ ] Stripe payment links on invoices
- [ ] Invoice status tracking (sent, viewed, paid)
- [ ] PDF generation for invoices
- [ ] Financial dashboard (revenue, outstanding)

## Phase 5: Mobile App + Polish (Weeks 17-20)

- [ ] PWA configuration (manifest, service worker, offline)
- [ ] Push notifications (mobile + desktop)
- [ ] Performance optimisation (lazy loading, code splitting)
- [ ] Onboarding improvements (video walkthrough, tooltips)
- [ ] Analytics dashboard enhancements
- [ ] Multi-language support (if needed)
- [ ] Production hardening (rate limiting, abuse prevention)
- [ ] Documentation and help centre content
- [ ] Beta launch to initial UK businesses
