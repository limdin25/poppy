# Decisions Log

Every architectural choice and why.

---

| # | Decision | Rationale | Date |
|---|----------|-----------|------|
| 1 | New repo instead of extending Lemlin | Keeps projects isolated, avoids accidental breakage. Different target market (UK SMBs vs IG automation) means different growth paths. | 2026-05-01 |
| 2 | Copy UI primitives from Lemlin | 14 proven Radix/shadcn components already built and tested. Saves 1-2 weeks of boilerplate. | 2026-05-01 |
| 3 | Roger Roger color scheme (blue `#428EF4` CTAs, clean white) | Modern, minimal aesthetic. Blue conveys trust and professionalism for business users. | 2026-05-01 |
| 4 | Inter font | Clean, professional, widely used in SaaS. Excellent readability at all sizes. | 2026-05-01 |
| 5 | Retell AI + Twilio for voice (not building voice AI from scratch) | Months of audio engineering saved. Retell handles STT/TTS/turn-taking, Twilio handles telephony. We focus on the AI brain and UX. | 2026-05-01 |
| 6 | Claude Sonnet 4.6 as AI brain (not GPT) | Strict tool use mode guarantees valid parameters. Critical for booking appointments and generating quotes mid-call without hallucinated fields. | 2026-05-01 |
| 7 | Mobile-first design | Users (business owners) primarily check their receptionist from their phone. Desktop is secondary. | 2026-05-01 |
| 8 | Feature isolation pattern | Same modular architecture as Lemlin. Features cannot import other features (ESLint enforced). Prevents cascading breakage when one feature changes. | 2026-05-01 |
| 9 | Reuse marketplace10's Unipile credentials and pattern | Unipile account already connected and paid for hub.nfstay.com. Same token/DSN works for Poppy — no extra cost. Webhook + polling dual approach copied from marketplace10 because Unipile webhooks are unreliable (proven in production). | 2026-05-02 |
| 10 | String equality webhook auth (not HMAC) | Unipile only supports `Unipile-Auth` header with a shared secret string. No HMAC signing available. Acceptable for now; the secret is stored in Vercel env vars, not in code. | 2026-05-02 |
| 11 | ~~gpt-4o-mini~~ → Claude Sonnet 4.6 for WhatsApp auto-replies | Switched to Claude for consistency across the stack. One AI provider, one prompting style, one billing line. Claude Sonnet is fast enough for chat replies and better at following the business system prompt. | 2026-05-03 |
| 12 | Download attachments to Supabase Storage (not hotlink Unipile URLs) | Unipile attachment URLs are temporary/authenticated. Storing in our own Storage bucket gives permanent public URLs and no vendor lock-in for media display. | 2026-05-03 |
| 13 | Regex filter for reaction notification texts (not just `is_event` flag) | Unipile sends reaction notifications with `is_event=0` sometimes. Belt-and-braces: filter by both the `is_event` flag AND by detecting the text pattern `"{{phone@s.whatsapp.net}} reacted X"`. | 2026-05-03 |
| 14 | Vercel CLI deploy with `.git` hide trick | Vercel project is linked to `hrds100/poppy` repo but code lives in `limdin25/poppy`. Auto-deploy doesn't trigger. Workaround: `mv .git .git.bak && vercel deploy --prod && mv .git.bak .git`. Works reliably. | 2026-05-03 |
| 15 | Video as first-class content type | Added `'video'` to the messages content_type constraint alongside text/audio/image/file. Frontend renders `<video controls>` with the media_url. Future-proofs for WhatsApp video messages. | 2026-05-03 |
