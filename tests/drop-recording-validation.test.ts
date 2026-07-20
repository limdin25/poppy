import { describe, it, expect } from 'vitest'
import { validateDropRecording, DROP_RECORDING_MAX_BYTES } from '../src/features/crm/lib/dropRecordingValidation'

// Behaviour 6 — upload validation for the campaign voicemail recording.
// Twilio's <Play> supports mp3/wav/m4a; anything else fails at drop time,
// so reject it at upload time instead.
describe('validateDropRecording', () => {
  const mp3 = { mimeType: 'audio/mpeg', sizeBytes: 500_000, fileName: 'drop.mp3' }

  it('accepts mp3, wav and m4a mime types', () => {
    expect(validateDropRecording(mp3).ok).toBe(true)
    expect(validateDropRecording({ ...mp3, mimeType: 'audio/wav', fileName: 'drop.wav' }).ok).toBe(true)
    expect(validateDropRecording({ ...mp3, mimeType: 'audio/x-wav', fileName: 'drop.wav' }).ok).toBe(true)
    expect(validateDropRecording({ ...mp3, mimeType: 'audio/mp4', fileName: 'drop.m4a' }).ok).toBe(true)
  })

  it('falls back to the file extension when the browser gives no mime', () => {
    expect(validateDropRecording({ ...mp3, mimeType: '' }).ok).toBe(true)
    expect(validateDropRecording({ mimeType: '', sizeBytes: 1000, fileName: 'greeting.WAV' }).ok).toBe(true)
  })

  it('rejects non-audio files', () => {
    const r = validateDropRecording({ mimeType: 'application/pdf', sizeBytes: 1000, fileName: 'x.pdf' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/audio/i)
    expect(validateDropRecording({ mimeType: 'video/mp4', sizeBytes: 1000, fileName: 'x.mp4' }).ok).toBe(false)
    expect(validateDropRecording({ mimeType: '', sizeBytes: 1000, fileName: 'x.exe' }).ok).toBe(false)
  })

  it('rejects empty and oversized files', () => {
    expect(validateDropRecording({ ...mp3, sizeBytes: 0 }).ok).toBe(false)
    const big = validateDropRecording({ ...mp3, sizeBytes: DROP_RECORDING_MAX_BYTES + 1 })
    expect(big.ok).toBe(false)
    if (!big.ok) expect(big.reason).toMatch(/big|large|10/i)
  })
})
