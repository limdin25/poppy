#!/bin/zsh
# B-roll for the Flywheel VSL, generated on gpt-image-2 and written straight
# into video/public/flywheel/broll/.
#
# Deliberately NOT twelve literal illustrations. The literal ones carry the
# concrete claims (five accounts, one laptop, an empty studio) and the abstract
# ones carry the big ideas (the world shifting, content becoming money, the
# window closing). Alternating the two is what stops the eye settling.
#
# One shared grade across all twelve so they read as one film rather than a
# stock-library grab bag: cinematic, low key, warm gold key light against deep
# teal shadow, matching the warm living room the speaker is sitting in.

set -u
cd "$(dirname "$0")/.." || exit 1
OUT=public/flywheel/broll
mkdir -p "$OUT"

K=$(grep -hoE "sk-proj-IBzk8EfZ[A-Za-z0-9_-]+" \
  /Users/hugo/.claude/projects/-Users-hugo/memory/reference_openai_key.md | head -1)
[ -z "$K" ] && { echo "no openai key"; exit 1; }

GRADE="Cinematic still, anamorphic, shallow depth of field, low key lighting, warm gold key light against deep teal shadow, fine film grain, rich contrast, premium commercial photography. No text, no writing, no letters, no numbers, no logos, no watermarks anywhere in the image."

gen () {  # gen <slug> <prompt>
  local slug=$1 prompt=$2
  [ -f "$OUT/${slug}.png" ] && { echo "${slug} exists, skipping"; return }
  curl -s --max-time 400 https://api.openai.com/v1/images/generations \
    -H "Authorization: Bearer $K" -H "Content-Type: application/json" \
    -d "$(node -e '
      const [slug, prompt, grade] = process.argv.slice(1);
      process.stdout.write(JSON.stringify({
        model: "gpt-image-2", size: "1536x1024", quality: "high",
        prompt: prompt + " " + grade,
      }));
    ' "$slug" "$prompt" "$GRADE")" \
    -o "$OUT/${slug}.json"
  node -e '
    const slug = process.argv[1], out = process.argv[2];
    const j = require(`${process.cwd()}/${out}/${slug}.json`);
    if (j.error) { console.log(slug, "ERROR", j.error.message); process.exit(1) }
    require("fs").writeFileSync(`${out}/${slug}.png`, Buffer.from(j.data[0].b64_json, "base64"));
    console.log(slug, "ok");
  ' "$slug" "$OUT"
}

# --- abstract: the claim is a concept, so show a feeling, not a thing --------
gen ai-face "A human face turning into a cloud of glowing particles and a faint wireframe mesh, half flesh and half light, dissolving at the edges, dark void background." &
gen shift "A vast cracked landscape splitting apart along a glowing fault line, one half lifting above the other, seen from low and close, dust in the air, epic scale." &
gen into-money "A ribbon of pure light pouring downward and turning into falling gold coins mid-air, frozen at the moment of change, dark background." &
gen flywheel "A massive polished steel industrial flywheel spinning at speed inside a dark engine hall, motion blur on its rim, a few sparks, heavy engineering." &
gen heavy-lift "A single enormous concrete block suspended effortlessly in mid-air by a thin taut cable, dwarfing the dark empty yard beneath it." &
gen window-closing "A heavy door standing almost shut with a blade of brilliant warm light escaping the last inch of the gap, dark room, dust in the beam." &

wait

# --- literal: the claim is concrete, so show the thing ----------------------
gen toy "A cheap plastic toy robot lying knocked over on its side on an empty desk, scuffed and dated, one arm missing, harsh little pool of light around it." &
gen empty-studio "An empty professional film studio at night, cameras and lights switched off and packed to one side, cables coiled on the floor, nobody there." &
gen one-laptop "A single open laptop glowing on a bare desk in an otherwise pitch dark room, its light the only thing in the frame." &
gen five-phones "Five modern smartphones standing in a neat row on a dark reflective surface, each screen glowing with an abstract blurred social feed, no readable content." &
gen the-feed "A towering wall of hundreds of small glowing rectangular screens receding into the dark, each showing an abstract blurred image, like an endless scrolling feed." &
gen outside-looking "A lone figure seen from behind standing in the dark, looking through a large window into a warm brightly lit room full of life, rain on the glass." &

wait
echo "done"
ls -la "$OUT"/*.png 2>/dev/null | wc -l
