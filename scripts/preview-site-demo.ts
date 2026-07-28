// Renders a sample demo site to disk so the design can be looked at, not just
// asserted about. Run: npx vite-node scripts/preview-site-demo.ts [out.html]
import { writeFileSync } from 'node:fs';
import { fillSiteContent } from '../src/core/site-demo/fill';
import { renderSite } from '../src/core/site-demo/render';

const out = process.argv[2] || 'preview.html';
const content = fillSiteContent({
  businessName: 'MJR Plumbing',
  tradeKey: 'plumber', tradeLabel: 'Plumber', tradePlural: 'plumbers',
  profileKey: 'plumbing', town: 'Wigan',
  phoneDisplay: '07576 558278', phoneE164: '+447576558278',
  rating: 4.8, reviews: 37, reviewsSource: 'google',
});
writeFileSync(out, renderSite(content, {
  slug: 'mjr-plumbing', pageId: 'preview', beaconToken: '', staff: false,
  canonicalUrl: 'https://heyelsie.com/s/mjr-plumbing',
  chatEnabled: true, checkoutEnabled: true,
}));
console.log('wrote ' + out);
