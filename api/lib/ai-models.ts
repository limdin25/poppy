// Which model each job runs on. One file, so moving a job is one line.
//
// Hugo, 7 Oct 2026: "use Gemini instead of Anthropic for the reports and for the
// house desk tools." Each job names a Gemini model and the Claude it used to run
// on. Gemini answers when GEMINI_API_KEY is set and the Google account has
// credit. Until then, or the moment it runs dry, the old Claude answers exactly
// as before (callLLM, opts.fallbackModel), so nothing goes quiet and a Gemini
// outage costs what the call cost yesterday. Admin, AI Costs shows which model
// really answered.
//
// Pick Gemini ids from Google's list (gemini-*). "google/gemini-*" would go
// through OpenRouter instead, with a fee on top.

/** House desk tools: call review, offer emails, call listener, ballpark,
 *  follow-up notes, photo reading (careful reader). Read a transcript or a
 *  listing and answer in a few hundred tokens. */
export const HOUSES_MODEL = 'gemini-3.8-flash';
export const HOUSES_FALLBACK = 'claude-sonnet-5';

/** The cheap, blunt second reader and the money auditor. Both used Haiku. */
export const HOUSES_LIGHT_MODEL = 'gemini-3.5-flash-lite';
export const HOUSES_LIGHT_FALLBACK = 'claude-haiku-4-5-20251001';

/** The daily coaching reports. They read a whole day of transcripts and write
 *  a long, careful card, so they get the strong model. Opus 4.8 is the fallback. */
export const REPORT_MODEL = 'gemini-3.1-pro-preview';
export const REPORT_FALLBACK = 'claude-opus-4-8';
