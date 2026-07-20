// Upload validation for a campaign's voicemail-drop recording.
// Twilio's <Play> fetches the file at drop time — only mp3 / wav / m4a
// reliably play, so anything else is rejected before it ever reaches the
// crm-attachments bucket. Pure (vitest: tests/drop-recording-validation).

export const DROP_RECORDING_MAX_BYTES = 10 * 1024 * 1024;

const ALLOWED_MIME = new Set([
  'audio/mpeg', 'audio/mp3',
  'audio/wav', 'audio/x-wav', 'audio/wave',
  'audio/mp4', 'audio/x-m4a', 'audio/m4a',
]);
const ALLOWED_EXT = new Set(['mp3', 'wav', 'm4a']);

export type DropRecordingVerdict = { ok: true } | { ok: false; reason: string };

export function validateDropRecording(file: {
  mimeType: string;
  sizeBytes: number;
  fileName: string;
}): DropRecordingVerdict {
  if (file.sizeBytes <= 0) return { ok: false, reason: 'File is empty' };
  if (file.sizeBytes > DROP_RECORDING_MAX_BYTES) {
    return { ok: false, reason: 'Recording is too big (max 10 MB — a 30s message is well under 1 MB)' };
  }
  const mime = file.mimeType.trim().toLowerCase();
  if (mime) {
    return ALLOWED_MIME.has(mime)
      ? { ok: true }
      : { ok: false, reason: 'Not a supported audio file — upload an mp3, wav or m4a' };
  }
  // Some browsers give no mime for drag-dropped files — fall back to extension.
  const ext = file.fileName.split('.').pop()?.toLowerCase() ?? '';
  return ALLOWED_EXT.has(ext)
    ? { ok: true }
    : { ok: false, reason: 'Not a supported audio file — upload an mp3, wav or m4a' };
}
