// The text of one message in the inbox thread.
//
// Hugo, 2026-08-11: "emaisl is not nicelly formated".
//
// Two separate things were wrong and only one of them was the email itself.
// The webhook now stores clean paragraphed text, but the bubble rendered it as
// a bare `{m.body}` expression with no whitespace rule, so React handed the
// browser a string full of newlines and CSS collapsed every one of them. A
// nine-paragraph estate agency email arrived as a single unbroken wall. That
// hit multi-line SMS and WhatsApp too, it was just least survivable on email,
// which is the only channel people write paragraphs in.
//
// What this adds beyond preserving the newlines:
//
//   * Long messages fold. An agency reply is three useful lines followed by a
//     confidentiality notice longer than the message itself, and that
//     boilerplate was pushing the actual words off the top of the thread.
//   * URLs and email addresses become links. Keaze's reply says "contact them
//     on sales@platformhg.com" and Pedro should not have to retype it.
//
// Links are built by splitting the string into React nodes. Deliberately NOT
// dangerouslySetInnerHTML: this text arrives from strangers, by email.
//
// The matching and cutting live in ../lib/messageText.ts so they can be tested
// in node, this repo having no jsdom wired into vitest.

import { useState } from 'react';
import { cn } from '@/core/lib/cn';
import { linkPieces, isLong, previewCut } from '../../lib/messageText';

export default function MessageBody({
  body,
  tone = 'light',
  className,
}: {
  body: string;
  /** Outbound bubbles are tinted, so links need a colour that survives it. */
  tone?: 'light' | 'dark';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const text = body ?? '';
  const long = isLong(text);
  const shown = long && !open ? previewCut(text) : text;
  const linkCls = tone === 'dark'
    ? 'underline underline-offset-2 hover:opacity-80'
    : 'text-[#3C5A87] underline underline-offset-2 hover:opacity-80';

  return (
    <div className={className}>
      {/* The whole point: keep the newlines the sender wrote, and break long
          unbroken strings (a tracking link that survived) rather than letting
          them stretch the bubble. */}
      <div className="whitespace-pre-wrap break-words">
        {linkPieces(shown).map((p, i) =>
          p.href ? (
            <a
              key={i}
              href={p.href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className={linkCls}
            >
              {p.text}
            </a>
          ) : (
            <span key={i}>{p.text}</span>
          ),
        )}
        {long && !open && <span className="text-[#9CA3AF]">...</span>}
      </div>
      {long && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpen((v) => !v);
          }}
          className={cn(
            'mt-1 text-[11px] font-semibold underline underline-offset-2',
            tone === 'dark' ? 'opacity-80 hover:opacity-100' : 'text-[#3C5A87] hover:opacity-80',
          )}
        >
          {open ? 'Show less' : `Show full message (${text.length.toLocaleString('en-GB')} characters)`}
        </button>
      )}
    </div>
  );
}
