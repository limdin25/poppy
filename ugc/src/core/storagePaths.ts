// The one place object paths are built. The first path segment MUST be the
// owning user's id: both buckets' RLS policies read
// (storage.foldername(name))[1] = auth.uid()::text, so a path built any other
// way is either invisible to its owner or visible to the wrong person.

export const BUCKET_UPLOADS = 'ugc-uploads';
export const BUCKET_RENDERS = 'ugc-renders';

export function uploadObjectPath(userId: string, projectId: string, fileName: string): string {
  return `${userId}/${projectId}/${fileName}`;
}

export function compositePath(userId: string, projectId: string, jobId: string): string {
  return `${userId}/${projectId}/composite-${jobId}.png`;
}

export function voiceTakePath(userId: string, projectId: string, jobId: string): string {
  return `${userId}/${projectId}/voice-${jobId}.wav`;
}

export function adVideoPath(userId: string, projectId: string, jobId: string): string {
  return `${userId}/${projectId}/ad-${jobId}.mp4`;
}

export function chunkAudioPath(userId: string, projectId: string, jobId: string, seq: number): string {
  return `${userId}/${projectId}/chunks/${jobId}-${seq}.wav`;
}

export function benchObjectPath(name: string): string {
  return `bench/${name}`;
}

// Which bucket an asset row's storage_path lives in.
export function bucketForSource(source: 'upload' | 'generated'): string {
  return source === 'upload' ? BUCKET_UPLOADS : BUCKET_RENDERS;
}

export function pathOwner(path: string): string | null {
  const first = path.split('/')[0] ?? '';
  return /^[0-9a-f-]{36}$/.test(first) ? first : null;
}

export function isChunkIntermediate(path: string): boolean {
  return path.split('/').includes('chunks');
}

export function isBenchObject(path: string): boolean {
  return path.startsWith('bench/');
}
