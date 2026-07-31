// Frozen bake-off fixtures. Same inputs for every contender or the blind
// comparison means nothing. The product is fictional (no real brand may
// appear in bench outputs). All copy is straight-punctuation GSM-safe.

export const MARIA_REFERENCE_ID = 'a4c68282850b4568bc92749fa2c16815';

export const SCRIPTS = {
  s15: 'Okay so I have to tell you about this. My skin was so dull last month, and this little serum honestly turned it around in two weeks. It is called Lumo Glow, and I am actually obsessed.',
  s30: 'I get asked about my skin every single time I post, so here it is. This is Lumo Glow, a vitamin C serum I started using about a month ago. Two drops in the morning, that is it. The dark spots on my cheeks have faded, my face feels bouncy, and I have stopped wearing foundation most days. It is thirty pounds and it lasts forever. Honestly, just try it.',
  s55: 'So a few of you noticed my skin looks different lately and asked what changed, and I promised I would be honest about it. It is this, Lumo Glow. It is a vitamin C serum, and I know everyone says their serum changed their life, but hear me out. I have used it every morning for six weeks now. Two drops, pat it in, done. The first thing I noticed was the texture, my skin just felt smoother by the end of week one. Then around week three the dark spots from old breakouts started fading, and now they are basically gone. I am not wearing foundation in this video, this is just my skin. It is thirty pounds, one bottle has lasted me the whole six weeks, and they do next day delivery. I will put the link right here.',
} as const;

export const INFLUENCER_PROMPT =
  'Casual smartphone selfie photo of a woman in her late twenties with shoulder length brown hair and light natural makeup, soft daylight from a window, sitting in a bright tidy bedroom, looking at the camera with a relaxed friendly half smile, realistic skin texture with visible pores, slightly imperfect framing like a real phone photo, vertical portrait.';

export const PRODUCT_PROMPT =
  'Product photograph of a small frosted glass serum bottle with a white dropper cap and a clean minimal label that reads LUMO GLOW Vitamin C Serum, standing on a white bathroom shelf, soft natural light, photorealistic, vertical portrait.';

export const COMPOSITE_PROMPT =
  'Combine the two reference images into one photograph. The woman from the first image holds the serum bottle from the second image up beside her face at chest height, label facing the camera and clearly readable, same bedroom setting and window light as her photo, casual selfie framing, photorealistic, vertical portrait.';

export const BEHAVIOR_PROMPT =
  'She speaks casually to the camera like talking to a friend, natural head movement, occasionally glances at the bottle and tilts it slightly so the label stays visible, relaxed energy, subtle smile between sentences.';
