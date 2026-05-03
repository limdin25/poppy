import { useRef, useEffect, useState } from 'react'

interface EmailRendererProps {
  html: string
  className?: string
}

export function EmailRenderer({ html, className }: EmailRendererProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(200)

  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe) return

    const wrapped = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body {
            margin: 0;
            padding: 12px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 14px;
            line-height: 1.5;
            color: #1a1a1a;
            word-wrap: break-word;
            overflow-wrap: break-word;
          }
          img { max-width: 100%; height: auto; }
          a { color: #4f46e5; }
          table { max-width: 100% !important; }
          pre, code { white-space: pre-wrap; word-wrap: break-word; }
        </style>
      </head>
      <body>${html}</body>
      </html>
    `

    iframe.srcdoc = wrapped

    const onLoad = () => {
      try {
        const doc = iframe.contentDocument
        if (doc?.body) {
          const h = doc.body.scrollHeight + 24
          setHeight(Math.min(h, 800))
        }
      } catch {
        // cross-origin blocked — keep default height
      }
    }

    iframe.addEventListener('load', onLoad)
    return () => iframe.removeEventListener('load', onLoad)
  }, [html])

  return (
    <iframe
      ref={iframeRef}
      sandbox="allow-same-origin"
      title="Email content"
      className={className}
      style={{
        width: '100%',
        height,
        border: 'none',
        borderRadius: 8,
        background: '#fff',
      }}
    />
  )
}
