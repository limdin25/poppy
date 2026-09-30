export function spareRoomPhotos(html) {
  const urls = [...html.matchAll(/(?:href|data-src)="(https:\/\/photos[12]?\.spareroom\.co\.uk\/images\/flatshare\/listings\/large\/[\d/]+\.(?:jpg|jpeg|png|webp))"/gi)].map((m) => m[1]);
  return [...new Set(urls)].slice(0, 12);
}
