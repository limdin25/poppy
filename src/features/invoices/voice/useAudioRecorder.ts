import { useEffect, useRef, useState } from 'react'

export interface RecordingResult {
  blob: Blob
  /** clean mime type, e.g. 'audio/webm' or 'audio/mp4' (iOS Safari) */
  mime: string
}

/** Prefer webm/opus; fall back to mp4 for iOS Safari. Empty string = let the browser pick. */
export function pickSupportedMime(): string {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return ''
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4;codecs=mp4a.40.2', // iOS Safari
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ]
  for (const c of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(c)) return c
    } catch {
      /* ignore */
    }
  }
  return ''
}

/** Base64 payload only (data-URL prefix stripped). */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const s = String(reader.result)
      resolve(s.slice(s.indexOf(',') + 1))
    }
    reader.onerror = () => reject(new Error('Could not read the recording'))
    reader.readAsDataURL(blob)
  })
}

/**
 * Small MediaRecorder wrapper: start() (throws if the mic is blocked),
 * stop() resolving to the audio, cancel() to discard. Cleans up the
 * stream + timer on unmount.
 */
export function useAudioRecorder() {
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const recRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<number | null>(null)

  function cleanup() {
    if (timerRef.current != null) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    recRef.current = null
    setRecording(false)
  }

  /** Throws when the mic is unavailable or permission is denied. */
  async function start(): Promise<void> {
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('recording_unsupported')
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    streamRef.current = stream
    const mime = pickSupportedMime()
    const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
    chunksRef.current = []
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data)
    }
    recRef.current = rec
    rec.start()
    setElapsed(0)
    setRecording(true)
    timerRef.current = window.setInterval(() => setElapsed((s) => s + 1), 1000)
  }

  /** Stop and resolve with the take, or null if nothing was captured. */
  function stop(): Promise<RecordingResult | null> {
    return new Promise((resolve) => {
      const rec = recRef.current
      if (!rec || rec.state === 'inactive') {
        cleanup()
        resolve(null)
        return
      }
      rec.onstop = () => {
        const fullMime = rec.mimeType || 'audio/webm'
        const blob = new Blob(chunksRef.current, { type: fullMime })
        cleanup()
        resolve(blob.size > 0 ? { blob, mime: fullMime.split(';')[0] } : null)
      }
      try {
        rec.stop()
      } catch {
        cleanup()
        resolve(null)
      }
    })
  }

  /** Discard the current take. */
  function cancel() {
    const rec = recRef.current
    if (rec && rec.state !== 'inactive') {
      rec.onstop = null
      try {
        rec.stop()
      } catch {
        /* ignore */
      }
    }
    cleanup()
  }

  useEffect(() => {
    return () => {
      const rec = recRef.current
      if (rec && rec.state !== 'inactive') {
        rec.onstop = null
        try {
          rec.stop()
        } catch {
          /* ignore */
        }
      }
      if (timerRef.current != null) window.clearInterval(timerRef.current)
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  return { recording, elapsed, start, stop, cancel }
}
