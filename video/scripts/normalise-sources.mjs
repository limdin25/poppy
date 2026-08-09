// Renamed. This is now scripts/ingest-sources.mjs, because it does more than
// normalise: it also builds the full-bleed twin of each clip and works out where
// that clip's natural cut points are.
//
// You almost certainly want scripts/factory.mjs, which runs ingest and then
// renders in one command.

console.error('normalise-sources.mjs is now ingest-sources.mjs.\n');
console.error('  node scripts/factory.mjs --count=4     ingest anything new, then render');
console.error('  node scripts/ingest-sources.mjs        ingest only');
process.exit(1);
