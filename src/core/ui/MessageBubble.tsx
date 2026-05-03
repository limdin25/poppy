import { Paperclip, ExternalLink } from 'lucide-react'
import { cn } from '@/core/lib/cn'
import { EmailRenderer } from './EmailRenderer'

interface Attachment {
  id: string
  name: string
  extension: string
  size: number
  mime_type: string
}

interface EmailMeta {
  subject?: string
  sender_email?: string
  sender_name?: string
  has_attachments?: boolean
  attachments?: Attachment[]
  external_id?: string
  body_html?: string
}

interface MessageBubbleProps {
  sender: 'ai' | 'customer' | 'user'
  text: string
  timestamp?: string
  className?: string
  metadata?: EmailMeta
  contactLabel?: string
  mediaUrl?: string | null
  contentType?: 'text' | 'image' | 'file' | 'audio' | 'call_summary'
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

function cleanWhatsAppIds(text: string): string {
  return text.replace(/\{\{?\d+@(lid|s\.whatsapp\.net)\}?\}?/g, '').trim()
}

function stripQuotedReply(text: string): string {
  // First: cut inline "On ... wrote:" (e.g. "oiiii On Sat, 2 May 2026 at 20:12, Hugo wrote:")
  const inlineMatch = text.match(/\s+On\s.{5,120}\swrote:\s*/i)
  if (inlineMatch && inlineMatch.index !== undefined) {
    text = text.substring(0, inlineMatch.index)
  }

  const lines = text.split('\n')
  const cutPatterns = [
    /^On .{5,80} wrote:\s*$/i,
    /^-{3,}\s*Original Message\s*-{3,}/i,
    /^_{3,}/,
    /^>{3,}/,
    /^\*{3,}/,
  ]
  let cutIndex = lines.length
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (cutPatterns.some((p) => p.test(line))) { cutIndex = i; break }
    if (line.startsWith('>') && i > 0 && lines[i - 1].trim() === '') { cutIndex = i; break }
  }
  return lines.slice(0, cutIndex).join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

interface TextSegment {
  type: 'text' | 'link'
  content: string
  label?: string
  url?: string
}

function parseTextWithLinks(text: string): TextSegment[] {
  // Match markdown-style [label](url) or named links "Label ( url )" or bare URLs
  const segments: TextSegment[] = []
  // Pattern: text followed by ( long-url ) — common in plain-text emails
  const namedLinkPattern = /([A-Za-z][A-Za-z0-9 ]{1,40})\s*\(\s*(https?:\/\/\S{20,}?)\s*\)/g
  const bareUrlPattern = /https?:\/\/\S{80,}/g

  let processed = text
  const links: { start: number; end: number; label: string; url: string }[] = []

  // Find named links first
  let match: RegExpExecArray | null
  while ((match = namedLinkPattern.exec(text)) !== null) {
    links.push({ start: match.index, end: match.index + match[0].length, label: match[1].trim(), url: match[2] })
  }

  // Find remaining bare long URLs (not already inside a named link)
  while ((match = bareUrlPattern.exec(text)) !== null) {
    const inLink = links.some(l => match!.index >= l.start && match!.index < l.end)
    if (!inLink) {
      links.push({ start: match.index, end: match.index + match[0].length, label: 'View link', url: match[0] })
    }
  }

  if (links.length === 0) {
    return [{ type: 'text', content: text }]
  }

  links.sort((a, b) => a.start - b.start)
  let cursor = 0
  for (const link of links) {
    if (link.start > cursor) {
      const chunk = processed.substring(cursor, link.start).trim()
      if (chunk) segments.push({ type: 'text', content: chunk })
    }
    segments.push({ type: 'link', content: link.label, label: link.label, url: link.url })
    cursor = link.end
  }
  if (cursor < processed.length) {
    const chunk = processed.substring(cursor).trim()
    if (chunk) segments.push({ type: 'text', content: chunk })
  }
  return segments
}

export function MessageBubble({ sender, text, timestamp, className, metadata, contactLabel, mediaUrl, contentType }: MessageBubbleProps) {
  const isInbound = sender === 'customer'
  const hasAttachments = metadata?.has_attachments && metadata?.attachments && metadata.attachments.length > 0
  const hasHtml = isInbound && metadata?.body_html
  const isImage = contentType === 'image' && mediaUrl
  const isAudio = contentType === 'audio' && mediaUrl

  const cleanText = cleanWhatsAppIds(stripQuotedReply(text))
  const segments = parseTextWithLinks(cleanText)

  if (hasHtml) {
    return (
      <div className={cn('flex justify-start', className)}>
        <div className="max-w-[85%] w-full rounded-2xl rounded-bl-md bg-white border border-border overflow-hidden">
          {contactLabel && (
            <div className="px-3.5 pt-2">
              <p className="text-[10px] font-semibold text-ink-subtle">{contactLabel}</p>
            </div>
          )}
          <EmailRenderer html={metadata.body_html!} />

          {hasAttachments && (
            <div className="border-t border-border px-3.5 py-2 space-y-1">
              {metadata!.attachments!.map((att) => (
                <a
                  key={att.id}
                  href={`/api/messages/attachment?emailId=${metadata!.external_id}&attachmentId=${att.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 rounded-md bg-elevated px-2 py-1 text-[11px] text-brand transition hover:bg-brand/10"
                >
                  <Paperclip size={11} className="shrink-0" />
                  <span className="truncate font-medium">{att.name}.{att.extension}</span>
                  <span className="shrink-0 text-ink-subtle">({formatFileSize(att.size)})</span>
                </a>
              ))}
            </div>
          )}

          {timestamp && (
            <div className="px-3.5 pb-2">
              <p className="text-[9px] text-ink-subtle/60">{formatTime(timestamp)}</p>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className={cn('flex', isInbound ? 'justify-start' : 'justify-end', className)}>
      <div
        className={cn(
          'max-w-[75%] rounded-2xl px-3.5 py-2 text-[13.5px] leading-relaxed',
          isInbound
            ? 'rounded-bl-md bg-elevated text-ink'
            : 'rounded-br-md bg-brand text-white'
        )}
      >
        {sender === 'ai' && (
          <p className="mb-0.5 text-[10px] font-semibold opacity-70">Poppy AI</p>
        )}
        {isInbound && contactLabel && (
          <p className="mb-0.5 text-[10px] font-semibold text-ink-subtle">{contactLabel}</p>
        )}

        {isImage && (
          <a href={mediaUrl!} target="_blank" rel="noopener noreferrer" className="block mb-1">
            <img
              src={mediaUrl!}
              alt="Shared image"
              className="max-w-full max-h-[300px] rounded-lg object-cover"
              loading="lazy"
            />
          </a>
        )}

        {isAudio && (
          <div className="mb-1">
            <audio controls preload="metadata" className="max-w-full h-9" style={{ minWidth: '200px' }}>
              <source src={mediaUrl!} />
            </audio>
          </div>
        )}

        {segments.map((seg, i) =>
          seg.type === 'text' ? (
            <p key={i} className="whitespace-pre-wrap">{seg.content}</p>
          ) : (
            <a
              key={i}
              href={seg.url}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                'mt-1 inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition',
                isInbound
                  ? 'bg-white/60 text-brand hover:bg-white/80'
                  : 'bg-white/20 text-white hover:bg-white/30'
              )}
            >
              <ExternalLink size={10} className="shrink-0" />
              {seg.label}
            </a>
          )
        )}

        {hasAttachments && (
          <div className="mt-1.5 space-y-1">
            {metadata!.attachments!.map((att) => (
              <a
                key={att.id}
                href={`/api/messages/attachment?emailId=${metadata!.external_id}&attachmentId=${att.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] transition',
                  isInbound
                    ? 'bg-white/60 text-brand hover:bg-white/80'
                    : 'bg-white/20 text-white hover:bg-white/30'
                )}
              >
                <Paperclip size={11} className="shrink-0" />
                <span className="truncate font-medium">{att.name}.{att.extension}</span>
                <span className="shrink-0 opacity-70">({formatFileSize(att.size)})</span>
              </a>
            ))}
          </div>
        )}

        {timestamp && (
          <p className={cn(
            'mt-1 text-[9px]',
            isInbound ? 'text-ink-subtle/60' : 'text-white/50'
          )}>
            {formatTime(timestamp)}
          </p>
        )}
      </div>
    </div>
  )
}
