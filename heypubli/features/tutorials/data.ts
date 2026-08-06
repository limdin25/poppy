/**
 * The five Seedance 2.5 classes, one per finished demo video.
 *
 * Each was reverse engineered from the real file: ffmpeg cut detection for the
 * shot structure, Whisper for the words, frame sampling for the look. The
 * prompts are reconstructions that produce the same result, not the originals,
 * which cannot be recovered from a finished video by anybody.
 *
 * ORDERED BY DIFFICULTY, NOT BY FILENAME. Class 1 is the source file v5.mp4 and
 * class 5 is v4.mp4. Each class is the one before it plus exactly one new skill,
 * so nobody meets the whip pans before they have made a locked off shot work.
 */

export interface TutorialStep {
  readonly title: string;
  readonly body: string;
}

export interface TutorialFix {
  readonly symptom: string;
  readonly cause: string;
}

/**
 * How a video longer than one generation is built.
 *
 * Seedance 2.5 makes 30 seconds per pass, so anything longer is two passes
 * joined with the extend feature. The script has to be divided too, which is the
 * part people miss: you cannot paste a 60 second script into a 30 second
 * generation and expect it to fit.
 */
export interface TutorialTwoPart {
  readonly partOne: string;
  readonly partTwo: string;
  readonly scriptOne: string;
  readonly scriptTwo: string;
}

/**
 * A self-contained technique bolted onto a class: a thing worth learning that
 * is not the class's main build, and would bloat the steps if it were mixed in.
 */
export interface TutorialModule {
  readonly title: string;
  readonly why: string;
  readonly steps: readonly TutorialStep[];
  /**
   * Prompts meant to be copied character for character. They render as code
   * blocks, and the test asserts their exact wording, because "roughly this"
   * is not good enough when the whole method depends on the analysis quality.
   */
  readonly copy: readonly { readonly label: string; readonly text: string }[];
}

export interface Tutorial {
  readonly slug: string;
  readonly classNumber: number;
  /** The file to upload to Skool for this class. Not the same as the slug. */
  readonly sourceFile: string;
  readonly title: string;
  readonly subtitle: string;
  readonly seconds: number;
  readonly generations: number;
  readonly newSkill: string;
  readonly why: string;
  /** Every word the presenter says. Drives the lip movement, so it is not optional. */
  readonly script: string;
  readonly scriptNote: string;
  /**
   * Set on a class where the SOUND is the content and the talking is incidental.
   * It buys a much shorter script, and in exchange soundDesign becomes required:
   * if the dialogue is thin, the audio has to be written down somewhere or the
   * class teaches nothing about the thing it is actually about.
   */
  readonly soundLed?: boolean;
  /** What the viewer hears, for a sound-led class. Required when soundLed is set. */
  readonly soundDesign?: string;
  /**
   * Shots in the storyboard, for a class whose lesson IS the shot list. Checked
   * against the prompt, so editing the storyboard without editing this number
   * fails the build rather than quietly making the copy a lie.
   */
  readonly shots?: number;
  /** An extra technique attached to this class. See TutorialModule. */
  readonly module?: TutorialModule;
  readonly twoPart?: TutorialTwoPart;
  readonly steps: readonly TutorialStep[];
  readonly prompt: string;
  readonly fixes: readonly TutorialFix[];
  readonly skoolDescription: string;
}

const CLASS_ONE_PROMPT = `A woman in her early twenties sits at a white marble table, filmed from the
chest up. She wears a grey ribbed roll-neck jumper. Dark brown hair in a
sharp chin-length bob. She holds a small handheld microphone with a grey
fluffy windshield up near her chin in one hand, resting her other forearm on
the table. Plain warm off-white wall behind her, softly out of focus, with a
gentle diagonal shadow across it.

Reference @Image 1 for her face. She must be the same person throughout.

Camera: locked off on a tripod, chest-up framing, no movement, no zoom, no
handheld drift at any point. Shallow depth of field, the wall behind fully
soft. Warm soft key light from camera right, a subtle rim on her hair.
Clean modern vlog look, natural skin texture, fine detail, no colour grade.

0-12s: She talks straight down the lens, bright and slightly excited, mic
held near her chin, free hand mostly resting on the table with small
gestures.
12-22s: Unchanged framing. Her free hand becomes more animated, counting
points, an open palm, a raised index finger.
22-30s: Unchanged framing. She leans a fraction closer to the lens, warmer
and more sincere.

Audio: single female voice, young, British, upbeat and natural, close-miked
with the slight proximity warmth of a handheld mic. Very quiet room tone. No
music. She says:

"I started UGC just two months ago with 19 followers and I've just landed my
first paid monthly retainer deal. I'm honestly so proud of myself. If you
don't know what a monthly retainer is, that basically means that a brand is
going to be paying me a set amount of money every single month to make a
certain amount of content for them, which is just the dream, and it just
shows where hard work can get you."`;

const CLASS_TWO_PROMPT = `A woman in her early forties sits at a light oak table in a sunlit rustic
living room. White plaster walls, dark wooden ceiling beams, an open doorway
behind her. She wears a beige linen jacket over a white top, long dark wavy
hair. A plain cardboard parcel sits on the table in front of her.

Reference @Image 1 for her face. Reference @Image 2 for the product: an amber
glass dropper bottle with a black cap and a cream label reading LYMPHORIA,
lymphatic drainage, liquid herbal extracts.

Camera: locked off on a tripod at chest height, medium shot framing her from
the waist up with the table edge across the bottom of frame. The camera does
not move, pan or zoom at any point. Shallow depth of field, the doorway
behind her softly out of focus. Warm natural daylight from a window to
camera left. Shot on a phone front camera, natural skin texture, no colour
grade.

0-8s: She talks directly to the lens with both hands resting on the parcel,
then lifts it slightly to show it to camera.
8-13s: She cuts the tape with small scissors, folds the flaps open, and
lifts out the amber glass dropper bottle.
13-24s: She holds the bottle up close to the lens, label facing camera, and
turns it slowly so the label stays readable.
24-30s: She lowers the bottle to the table and keeps talking.

Audio: single female voice, warm and conversational, mid-Atlantic accent,
speaking continuously and unhurriedly throughout. Quiet room tone, faint
cardboard and glass handling sounds. No music. She says:

"Okay, my Lymphoria package just arrived, and I'm opening it with you because
I wanted to see what everything actually looks like before adding it to my
routine. The box came neatly sealed, there's protective paper inside, and
here's the bottle. It's amber glass, which feels much nicer than plastic, and
the black dropper was completely sealed. The label is clear, the bottle feels
sturdy, and it's small enough to keep beside my other morning essentials."`;

const CLASS_THREE_PROMPT = `A woman in her mid twenties films her own reflection in a bathroom mirror,
holding the phone in one hand. She wears an olive green ribbed tank top and
grey sweatpants, long brown hair loose and slightly damp. Warm cream tiled
bathroom, a towel rail and a white basin visible behind her reflection.

Reference @Image 1 for her face. Reference @Image 2 for the product: a lilac
foil sachet with a cream lower third, reading Lumea Glow Ritual.

IMPORTANT: this is a mirror reflection, so ALL text on the packaging appears
reversed, as mirror writing. Render every label backwards.

Camera: handheld phone rear camera pointed at a large bathroom mirror. The
phone is visible in her hand in the reflection. Slight natural hand movement
throughout, no deliberate camera moves. Vertical 9:16. Warm domestic
tungsten light from above, soft and slightly yellow. Shot on a phone at
night, mild sensor noise, no colour grade.

0-7s: She talks to her own reflection, one hand holding the phone, the other
loose at her side.
7-11s: She picks up a white hand towel and presses it over her face, then
lowers it.
11-19s: She holds the lilac sachet up to the mirror, label facing the glass
and therefore reversed. She turns it over, picks up small scissors and cuts
the top strip off.
19-24s: She pulls the folded sheet mask out and unfolds it with both hands.
24-30s: She presses the mask onto her face, smooths it down over her cheeks
and nose with her fingertips, and talks through it.

Audio: single female voice, young, casual, slightly amused, speaking in
short unfinished sentences with natural pauses. Quiet bathroom reverb, foil
rustle, scissors snip, wet fabric sounds. No music. She says:

"Okay, so night routine, kind of. This is the one everyone's been like
posting about, so we'll see. I always rip these wrong, so scissors. Okay,
it's very wet. Good sign, I guess. Hold on, okay. 15 minutes and we'll see if
it's worth the hype."`;

const CLASS_FOUR_PROMPT = `A female clinician in her late thirties, long dark auburn hair, wearing
blue medical scrubs with a grey long sleeve underneath and a photo ID
lanyard. Modern hospital consulting room: a large window with a city skyline
behind her, a cream examination chair, a desk with a monitor and keyboard, a
wall-mounted otoscope, anatomy posters. Bright, even, clinical daylight.

Reference @Image 1 for the clinician. She must be recognisably the same
person in every shot. Reference @Image 2 for the older patient.

Camera: static tripod, chest height, vertical 9:16. Cut between fixed
setups, no camera movement within any shot. Clean modern documentary look,
natural colour, no grade.

0-5s: Medium shot. She sits on a low stool beside an older woman in a
patterned hospital gown, one hand resting on the patient's forearm, talking
to camera.
5-11s: Cut to a wider shot of her standing in the middle of the room,
holding a printed A3 chart to her chest titled "Timing meals and snacks to
support healthy cortisol levels and energy" with a wave graph across it. She
taps the chart with her free hand.
11-17s: Cut to a medium shot, chart gone, standing to camera with both hands
open, gesturing as she explains.
17-23s: Cut to a slightly tighter medium shot, same position, more animated
hand movement.
23-30s: Cut to her seated on the desk chair holding a small plain cardboard
box on her lap, stamped "SECRET FAT BURNER" in black.

Audio: single female voice, American, confident and clinical, steady pace.
Quiet air conditioning hum, faint corridor ambience. No music. She says:

"Eating less during menopause isn't making you thinner. It's actually making
you fatter. The reason for this is because when you restrict calories, it
raises your cortisol levels, which signals to your body to store fat away.
And this fat, unfortunately, is usually stored around the one place you don't
want it to be stored, your belly. And while you're on menopause, your body is
pretty much your worst enemy, working against you in every way it possibly
can."`;

const CLASS_FIVE_PROMPT = `A young woman with long braided hair, wearing an oversized grey knit hoodie,
gives a fast handheld phone tour of one room of her apartment. The room is
colourful and eclectic: a burnt orange modular sofa, a deep blue kidney
shaped rug, a red moulded plastic cantilever chair, a huge cream paper globe
lantern hanging low, a green modular shelving unit holding books and small
objects, a patterned tile-print bolster cushion, an orange pom pom cushion,
a white tulip side table with red candles, houseplants, framed art on white
walls, wood panelling on one wall.

Reference @Image 1 for her face. Reference @Image 2 for the room.

Keep the room geographically consistent throughout: the sofa and bolster
cushion on one wall, the blue rug and red chair in the centre, the green
shelf and lantern by the door. These positions must not change.

Camera: handheld phone front camera held at arm's length, selfie framing.
She walks through the room as she talks. Four times she whips the camera
away from her face to point at something, holds it for a beat, then whips
back to her face. Fast natural motion blur on each whip. Vertical 9:16.
Bright soft daylight. Shot on a phone, natural colour, no grade.

0-6s: Selfie, walking backwards into the room, the paper lantern above her
head, talking fast to camera.
6-9s: Whip down and left to the burnt orange sofa and the blue rug, hold,
whip back to her face.
9-21s: She sits on the sofa, still holding the phone at arm's length,
gesturing at the bolster cushion and the orange pom pom cushion beside her.
21-25s: Whip to the blue rug and the red chair, hold, whip back.
25-30s: Close selfie, her head against yellow and cream cushions, she smiles
and waves the phone away.

Audio: single female voice, young, fast, wry, talking over herself with
little pauses. Quiet apartment room tone, soft footsteps on rug. No music.
She says:

"Okay, apartment tour, well, one room, but it's the room. I mean, come on. So
the sofa, flea market, 60 bucks. I know. The throw my grandpa made, and this
little guy, no idea, he just lives here now. The rug that started the whole
colour thing, chair from a local maker, shelf's basically a plant hospital at
this point. Anyway, never leaving. Bye."`;

const CLASS_ZERO_PROMPT = `A photorealistic portrait of a woman in her mid twenties. Warm mid-brown
hair in a shoulder-length cut, light freckles, natural everyday makeup, a
small silver stud in each ear. She wears an oatmeal ribbed roll-neck jumper.

Shot on a 50mm lens at f2.0, natural window light from camera left, soft
shadow on the right of her face. Plain warm off-white wall behind her,
slightly out of focus. Head and shoulders, square to camera, eyes to lens,
relaxed neutral expression with a very slight smile.

Photographic realism: visible skin texture and pores, fine flyaway hairs,
natural asymmetry, no retouching, no beauty filter, no studio backdrop, no
professional headshot lighting. She should look like a real person
photographed at home, not like a model.`;

/**
 * Hugo's own prompt, kept as written apart from one line.
 *
 * THE ADDED LINE IS THE REFERENCE IMAGE. His version describes the subject in
 * words only, which is fine for making one clip and wrong for a course whose
 * spine is that your presenter is the same person in every video. Described in
 * words he comes back as a different man each run. Everything else, the shot
 * list, the audio notes, the realism notes, is his.
 */
const CLASS_SIX_PROMPT = `CAMERA AND LOOK: Handheld mini DV camcorder footage filmed by the subject
himself. Slight hand shake, occasional focus hunting, imperfect framing,
natural zoom adjustments, soft tape-like image quality, subtle grain,
realistic auto-exposure shifts from bright kitchen morning light. Natural skin
tones, mild motion blur, authentic consumer camcorder aesthetic.

Reference @Image 1 for his face. He must be the same person in every shot.

STYLE: Cozy coffee-prep vlog with gentle ASMR elements. Relaxed pacing,
minimal dialogue, candid moments. Focus on satisfying sounds: bean grinder
whirring, portafilter tamping, steam wand hissing, cup clinking, milk
frothing.

SUBJECT: Young man in his mid-20s, plain t-shirt, hair slightly tousled,
minimal accessories. Calm, focused energy while making his morning coffee.

SETTING: Small kitchen counter with an espresso machine on a bright morning.
Natural daylight, coffee beans and a mug nearby, quiet atmosphere.

STORYBOARD:
-> (3s, propped medium shot) Places camera on the counter, switches on the
machine. "Morning coffee, the proper way."
-> (3s, overhead shot) Grinds fresh coffee beans, fine grounds falling into
the portafilter.
-> (3s, close-up) Tamps the grounds down firmly and evenly.
-> (3s, handheld shot) Locks the portafilter into the machine. "Here we go."
-> (3s, detail shot) Espresso streams slowly into a small cup. No dialogue.
-> (3s, medium shot) Pours cold milk into a small steel pitcher. "Time for the
milk."
-> (3s, macro shot) Steam wand hissing as it froths the milk.
-> (3s, propped shot) Pours frothed milk carefully over the espresso, forming
light layers.
-> (3s, warm ending shot) Holds the finished cup, takes a small sip, satisfied
smile. "That's exactly what I needed."
-> (3s, final shot) Reaches toward camera, still holding the cup. "See you
later." Hand covers lens as recording ends.

AUDIO NOTES: Natural kitchen ambience. Grinder whirring, tamping, steam
hissing and milk pouring should be clearly audible. Dialogue quiet and casual.

REALISM NOTES: Authentic body language, natural blinking, genuine focused
smiles, occasional careful pauses while pouring, imperfect framing, focus
breathing, bright morning light shifts. Should resemble a genuine personal
coffee vlog on a consumer camcorder, not a commercial or AI-generated
production.`;

export const TUTORIALS: readonly Tutorial[] = [
  {
    slug: "v0",
    classNumber: 0,
    sourceFile: "none, this class is the setup",
    // NOT "Class 0". Hugo: "0 makes no sense." It is the setup, it sits outside
    // the numbering, and it is named for the thing it produces. classNumber
    // stays 0 because it still drives the slug and the ordering.
    title: "Your presenter (Avatar)",
    subtitle: "One face, one outfit, one room. Build them together or nothing matches.",
    seconds: 0,
    generations: 0,
    newSkill: "Building the character kit every other class depends on",
    why: `Do this before anything else. Every class that follows starts with the words upload your
presenter, and this is where that file comes from.

The mistake almost everyone makes is treating it as one photograph of a face. It is not. You are
building a kit of three things that must never change between videos: who she is, what she wears,
and where she stands. Get those fixed and your account looks like one real person posting from one
real flat. Let them float and every video looks like a different stock model in a different rented
house, which is the single clearest signal that nobody is really there.`,
    script: `There is no script in this class, because there is no video in this class. What you produce here is a set of still images: the face, the outfit and the room. Every other class in the course loads them as reference images, and the quality of everything you make afterwards is decided here rather than in the video model. Spend an hour on this and the other five classes get easier. Rush it and you will be fighting a drifting face for the rest of the course.`,
    scriptNote: `Worth understanding before you start: the video model is not inventing your
presenter, it is copying her from what you give it. A soft, badly lit or half profile reference
gives it room to guess, and every guess is a small change. A sharp, evenly lit, square to camera
reference gives it almost nothing to invent.`,
    steps: [
      {
        title: "Use Seedream, in the same app as everything else",
        body: `Dreamina carries ByteDance's image model, Seedream, next to Seedance. Same login, same
credits, and crucially the same house look, so your stills and your video are not fighting each
other. It also holds character consistency across a set of images, which is exactly the job here.
If you want more photographic micro-detail on a hero shot, Nano Banana Pro is the sharper tool, but
start in one place.`,
      },
      {
        title: "Make the face first, and make it boring",
        body: `Head and shoulders, square to camera, eyes to lens, neutral expression, plain wall,
even light. No dramatic angle, no strong shadow, no half profile. This image is not meant to be
impressive, it is meant to be unambiguous. Ask for skin texture, pores and flyaway hairs by name,
and rule out retouching and beauty filters explicitly, or you will get a model rather than a person.
The prompt below does all of that.`,
      },
      {
        title: "Add the outfit to the same person, in the same session",
        body: `Take your chosen face back in as a reference and generate her again, full length, in
the outfit she will wear. One outfit. Real creators own clothes and wear them repeatedly, so a
recurring jumper reads as a person while a new outfit every video reads as a catalogue. Keep it
simple and matte: heavy patterns and fine stripes shimmer when a video model redraws them frame to
frame.`,
      },
      {
        title: "Build the room around her, then photograph it empty",
        body: `Generate her standing in the space, wide, so the light on her face and the light in
the room agree. Then generate the same room with nobody in it. You need that empty frame because
Class 5 whips the camera off her and onto the furniture, and without a reference for the room alone
the model rebuilds it from scratch every time it leaves her face.`,
      },
      {
        title: "Keep four files, named, forever",
        body: `Face, outfit, her in the room, and the room empty. These four are your set. Every
class from here loads them as @Image 1 and @Image 2. Regenerating them later means every video you
have already made stops matching the ones that come after, so make them once and keep them.`,
      },
    ],
    prompt: CLASS_ZERO_PROMPT,
    fixes: [
      {
        symptom: "She looks like a model, not a person",
        cause: `The prompt did not rule out the studio. Say no retouching, no beauty filter, no
studio backdrop and no professional headshot lighting, and ask for window light and visible skin
texture instead. Perfect skin is the fastest way to look generated.`,
      },
      {
        symptom: "The outfit changes between images",
        cause: `You described the clothes instead of referencing them. Once you have a full length
image you like, that image becomes the reference for the outfit, exactly as the face image is the
reference for the face.`,
      },
      {
        symptom: "The room light does not match her face",
        cause: `You generated her and the room separately. Always generate her standing in the room
for at least one frame, so the model resolves both under one lighting setup, then take the empty
room from that same frame.`,
      },
      {
        symptom: "Fine patterns shimmer in the finished video",
        cause: `Not a fault in your prompt. Thin stripes and small prints alias when a video model
redraws them thirty times a second. Choose plain, matte, mid-tone clothing at this stage and the
problem never arises.`,
      },
    ],
    module: {
      title: "The realism module: how to kill the AI look",
      why: `Straight out of the box, GPT-image-2 has a tell. Flat colours and a grainy finish, and
anyone who looks at a lot of these can spot it in a second. It is the single most common reason a
generated photo reads as generated, and it is nothing to do with the face or the pose. It is the
colour grading.

You cannot fix that by describing it. Writing "cinematic warm lighting" gets you the model's idea of
cinematic, which is the same idea every time. What does fix it is showing the model a real
photograph and having it copy the grade, as data rather than as adjectives.`,
      steps: [
        {
          title: "Find the look on Pinterest, not in your head",
          body: `Search for the aesthetic you want and save one photo you would be happy for your
own to look like. A real one, taken on a real camera. Warm restaurant light, cold morning window,
harsh flash at night, whatever your account is meant to feel like. This is your reference and
nothing else in the method matters as much as picking a good one.`,
        },
        {
          title: "Have Claude Opus turn it into JSON",
          body: `Upload that photo to Claude Opus and use the first prompt below, word for word. It
comes back with a structured breakdown: the exact colours, where the light is, how the shadows
fall, the grain, the lens.

Use Opus specifically. Sonnet does not do a proper photo analysis, it describes the picture rather
than measuring it, and the whole method rests on that analysis being real. Gemini gets lazy and
writes short JSON. This is the one job worth paying for the bigger model.`,
        },
        {
          title: "Feed the JSON and your product to GPT-image-2",
          body: `In ChatGPT, paste the JSON, attach your product photo, and use the second prompt
below. You get a person holding your product, graded like the Pinterest photo. It will look
noticeably more real than anything you have got out of it before.`,
        },
        {
          title: "Save that person. They are now your presenter",
          body: `The face it invented is your model. Save the file. From now on, attach that photo
to every generation and you get the same person holding different products, in the same world.
This is the same reference-image discipline as the rest of the course, arrived at from the other
direction.`,
        },
        {
          title: "Iterate the JSON, not the photo",
          body: `Want it colder, or shot at night, or on a longer lens? Go back to Claude, give it
the JSON you already have, and ask for the change. Then run it again. The JSON is the thing you
edit and keep; the images are disposable.`,
        },
      ],
      copy: [
        {
          label: "Give this to Claude Opus, with the Pinterest photo attached",
          text: "analyze this photo and give me a very detailed json prompt that can recreate it, "
            + "it should be very detailed, really make sure to break down the color grading and "
            + "all the exact colors in the photo",
        },
        {
          label: "Give this to ChatGPT, with the JSON and your product photo",
          text: "using this json as reference, generate a person holding my product",
        },
      ],
    },
    skoolDescription: `Your presenter (Avatar).

Do this one first. Every other class in the course begins with the words upload your
presenter, and this is where that file comes from.

The mistake nearly everyone makes is thinking it is one photograph of a face. It is
three things that must never change: who she is, what she wears, and where she stands.
Fix those and your account looks like one real person posting from one real flat. Let
them drift and every video looks like a different model in a different rented house.

You will build the full kit: the face, the outfit, the room with her in it, and the
room empty. Four files you keep and reuse forever.

Made with Seedream at dreamina.capcut.com, the same app you will use for the videos.

Full walkthrough, with the exact prompt to copy: heypubli.com/v0`,
  },
  {
    slug: "v1",
    classNumber: 1,
    sourceFile: "v5.mp4",
    title: "The talking head",
    subtitle: "One shot. One face. Thirty-four seconds, no cuts.",
    seconds: 34,
    generations: 2,
    newSkill: "Reference images and your first extend",
    why: `Everything else in this course is this class plus one more thing. A single locked off
camera, one person, one prop. Nothing has to stay consistent except her face, and the reference
image handles that for you.`,
    script: `I started UGC just two months ago with 19 followers and I've just landed my first paid monthly retainer deal. I'm honestly so proud of myself. If you don't know what a monthly retainer is, that basically means that a brand is going to be paying me a set amount of money every single month to make a certain amount of content for them, which is just the dream, and it just shows where hard work can get you. And I'm just honestly so proud of myself, because when I started this UGC journey I really didn't know what it was going to be like, how successful I was going to be. And it's insane that all of this happened, because I am not even a real person. I was actually generated by AI.`,
    scriptNote: `The last line is the entire video. Everything before it is a normal creator
success story, and then she takes it away. Notice she never hints at it early, because the
moment you suspect she is AI you stop listening to the words and start hunting her hairline.`,
    twoPart: {
      partOne: `Generate the first 30 seconds with the prompt below. This covers her whole story
up to the point just before the reveal. Make three or four and pick the best one.`,
      partTwo: `Then use the extend feature on your chosen clip for the last 4 seconds, with the
reveal line as the only new script. Extend continues from the final frame, so the light, her
position and her face carry over exactly and there is no join to see. This is how the original
was made, and it is why nobody can find a cut in it.`,
      scriptOne: `I started UGC just two months ago with 19 followers and I've just landed my first paid monthly retainer deal. I'm honestly so proud of myself. If you don't know what a monthly retainer is, that basically means that a brand is going to be paying me a set amount of money every single month to make a certain amount of content for them, which is just the dream, and it just shows where hard work can get you.`,
      scriptTwo: `And I'm just honestly so proud of myself, because when I started this UGC journey I really didn't know how successful I was going to be. And it's insane that all of this happened, because I am not even a real person. I was actually generated by AI.`,
    },
    steps: [
      {
        title: "Get your face first",
        body: `Before you touch Seedance, make one photograph of your presenter. Front on, evenly lit,
plain background, shoulders in frame, eyes to camera. Any image generator will do it. This single
file is the most important asset in the whole course. You will reuse it in every generation,
forever, and it is what stops your presenter turning into a different person halfway through.`,
      },
      {
        title: "Open Dreamina and pick the model",
        body: `Go to dreamina.capcut.com, sign in, open the video tool and select Seedance 2.5 from
the model list. There is an introductory discount running, so this is the cheapest it will be.`,
      },
      {
        title: "Upload the face as Image 1",
        body: `Drop your presenter photo into the reference slots. Everywhere the prompt says
@Image 1, it means that file.`,
      },
      {
        title: "Write your script before you generate",
        body: `The script is not decoration. Seedance generates the voice and the picture together,
so the words drive the lip movement and the pace of her gestures. Read yours out loud with a
timer first. Roughly 75 words fills 30 seconds at a natural talking pace.`,
      },
      {
        title: "Generate part one, then extend for part two",
        body: `Set 30 seconds and 9:16, generate a batch, keep the best. Then extend that clip by
4 seconds with the reveal line. Full detail in the two part section above.`,
      },
      {
        title: "Add the captions in CapCut, not Seedance",
        body: `The word by word text on screen is not generated. Drop the finished video into
CapCut, run auto captions, pick a clean white sans font and centre it low. Ten minutes.`,
      },
    ],
    prompt: CLASS_ONE_PROMPT,
    fixes: [
      {
        symptom: "The face drifts",
        cause: `You described her instead of uploading her. Every generation needs the same
@Image 1 file. Describing a face in words gets you a family resemblance, not a person.`,
      },
      {
        symptom: "The camera creeps",
        cause: `Seedance likes to add a slow push in. The prompt says no movement three separate
times on purpose. If it still drifts, generate again rather than fighting it.`,
      },
      {
        symptom: "The mouth does not match the words",
        cause: `Give the audio direction more detail. Accent, pace and mood all change the lip
movement, because the model generates voice and picture together rather than dubbing one onto
the other.`,
      },
    ],
    skoolDescription: `Class 1. The talking head.

One locked off shot, one face, 34 seconds, and not a single cut in it. This is the
simplest video in the course and the best place to start, because everything else we
build is this plus one extra thing.

You will learn how a reference image keeps the same person on screen, how to write a
script that fits 30 seconds, and the extend trick that takes it to 34 without a
visible join.

Made on Seedance 2.5. You run it yourself at dreamina.capcut.com, which is
ByteDance's own app and the only place the model is properly live right now.

Full walkthrough, with the script and the exact prompt to copy: heypubli.com/v1`,
  },

  {
    slug: "v2",
    classNumber: 2,
    sourceFile: "v1.mp4",
    title: "The 60 second unboxing",
    subtitle: "A product, a label held to camera, and double the native length.",
    seconds: 60,
    generations: 2,
    newSkill: "Two full generations joined into one minute",
    why: `Sixty seconds is double what the model makes in one pass, so this is really two videos
that have to look like one. The camera never moves for a full minute, which sounds easy and is the
hardest part: any drift between the two halves and the join is obvious.`,
    script: `Okay, my Lymphoria package just arrived, and I'm opening it with you because I wanted to see what everything actually looks like before adding it to my routine. The box came neatly sealed, there's protective paper inside, and here's the bottle. It's amber glass, which feels much nicer than plastic, and the black dropper was completely sealed. The label is clear, the bottle feels sturdy, and it's small enough to keep beside my other morning essentials. I obviously can't talk about results yet because I just opened it, but my first impression is honestly really good. Now let's check the dropper. Okay, the cap opens smoothly, and the dropper feels really secure. The liquid looks light and easy to measure, but I'm still going to read the directions carefully and use only the recommended amount. I'm putting it beside my water and vitamins so it becomes part of something I already do every morning. I also love that the bottle is compact enough to travel with without taking over my bag. I'll use it consistently, pay attention to how I personally feel, and come back with a real update instead of pretending one use changed everything. Save this if you want the follow-up.`,
    scriptNote: `Read what she does not say. No claim about results, twice over, and an explicit
promise to come back with a real update. That is what makes a sixty second product video watchable
instead of an advert, and it is also what keeps it the right side of advertising rules.`,
    twoPart: {
      partOne: `Part one is the parcel, the cut, the reveal and the label held to camera. Generate
30 seconds with the prompt below and the first half of the script. This is the half that matters,
because it contains the product label, so generate several and pick the one where the label is
sharpest.`,
      partTwo: `Part two is the dropper, the glass of water and the sign off. Take your chosen part
one into the extend feature with the second half of the script. Do not generate it as a separate
clip and cut them together, that never matches. Extend picks up from the last frame of part one,
so the room, the light and her position are already correct.`,
      scriptOne: `Okay, my Lymphoria package just arrived, and I'm opening it with you because I wanted to see what everything actually looks like before adding it to my routine. The box came neatly sealed, there's protective paper inside, and here's the bottle. It's amber glass, which feels much nicer than plastic, and the black dropper was completely sealed. The label is clear, the bottle feels sturdy, and it's small enough to keep beside my other morning essentials.`,
      scriptTwo: `I obviously can't talk about results yet because I just opened it, but my first impression is honestly really good. Now let's check the dropper. Okay, the cap opens smoothly, and the dropper feels really secure. I'm putting it beside my water and vitamins so it becomes part of something I already do every morning. I'll use it consistently and come back with a real update instead of pretending one use changed everything. Save this if you want the follow-up.`,
    },
    steps: [
      {
        title: "Make two reference images, not one",
        body: `One of your presenter, as in Class 1. And one of the product, shot square on with the
label sharp and readable. The product image is doing more work than you think. A model asked to
invent a label produces gibberish that looks like a foreign alphabet.`,
      },
      {
        title: "Split your script before you start",
        body: `Sixty seconds is about 150 words. Divide it at a natural breath, not mid thought. The
split written above breaks where she finishes talking about the bottle and moves on to the dropper,
so each half is a complete idea.`,
      },
      {
        title: "Generate part one and be fussy about it",
        body: `Everything after this is built on top of it, so a soft label or a wrong hand in part
one is baked into the whole minute. Generate a batch and pick properly.`,
      },
      {
        title: "Extend, do not regenerate",
        body: `Take your best part one into the extend feature for the second 30 seconds. See the
two part section above for why this matters so much.`,
      },
      {
        title: "Read the label in both halves",
        body: `Scrub through the finished minute and read the bottle at the start and at the end. If
the text changed, the product reference was too weak. Use a sharper photo and go again.`,
      },
    ],
    prompt: CLASS_TWO_PROMPT,
    fixes: [
      {
        symptom: "The label turns to nonsense",
        cause: `The single most common failure. The fix is a better product photograph, not a longer
description. Straight on, sharp, well lit, filling the frame.`,
      },
      {
        symptom: "The second half looks different",
        cause: `You generated it fresh instead of extending. Always extend.`,
      },
      {
        symptom: "She runs out of things to say",
        cause: `Sixty seconds is a lot of script. Write the whole thing before you generate anything,
then split it, rather than making part one and hoping part two writes itself.`,
      },
    ],
    skoolDescription: `Class 2. The 60 second unboxing.

Seedance makes 30 seconds at a time. This video is 60, with no cut, and the camera
never moves once in the entire minute.

You will learn how to split a script in half properly, how to extend one generation
into another so the two halves match exactly, and how to make a product label stay
readable and identical throughout, which is where almost everyone's first attempt
falls apart.

Made on Seedance 2.5 at dreamina.capcut.com.

Full walkthrough, with the script and the exact prompt to copy: heypubli.com/v2`,
  },

  {
    slug: "v3",
    classNumber: 3,
    sourceFile: "v2.mp4",
    title: "The mirror selfie",
    subtitle: "Filmed into a bathroom mirror. Every label reads backwards.",
    seconds: 30,
    generations: 1,
    newSkill: "Mirror logic and reversed text",
    why: `This is the cleverest of the five and the one worth stealing. Filming a reflection hides
the phone, explains why the framing is odd, and gives the handheld wobble a reason to exist. It
also fits the whole thing in one 30 second pass, so there is no extending to worry about.`,
    script: `Okay, so night routine, kind of. This is the one everyone's been like posting about, so we'll see. I always rip these wrong, so scissors. Okay, it's very wet. Good sign, I guess. Hold on, okay. 15 minutes and we'll see if it's worth the hype.`,
    scriptNote: `Fifty words in thirty seconds, where the other classes use a hundred and fifty. The
silence is the point. She trails off, does not finish sentences, and lets the action carry it. If
you write this one as polished ad copy it stops being believable immediately.`,
    steps: [
      {
        title: "Understand what a mirror does to text",
        body: `Look at the original closely. The sachet says Lumea Glow Ritual and every letter is
backwards, because you are seeing its reflection. If you forget to ask for this, the model renders
the label the right way round and the illusion dies instantly. The prompt says it in capitals for
that reason.`,
      },
      {
        title: "Reference the packet as well as the presenter",
        body: `Same two images as Class 2: the face and the product. Photograph the product normally,
the prompt handles the reversing.`,
      },
      {
        title: "Write short and leave gaps",
        body: `Aim for half the words you think you need. See the note under the script above.`,
      },
      {
        title: "Generate once at 30 seconds",
        body: `One pass, no extending, 9:16. This is the only class in the course that needs a single
generation, so use it to get comfortable before Class 4.`,
      },
      {
        title: "Keep the light warm and low",
        body: `The original is shot at night under a bathroom light, which is far more forgiving than
daylight. Soft yellow light hides small errors around hands and hairlines. That is a genuine trick,
not a stylistic accident.`,
      },
    ],
    prompt: CLASS_THREE_PROMPT,
    fixes: [
      {
        symptom: "The text is the right way round",
        cause: `The model ignored the instruction. Move the mirror sentence to the very top of the
prompt and repeat it at the bottom.`,
      },
      {
        symptom: "You can see two of her",
        cause: `It got confused about whether it is filming her or her reflection. Say a woman films
her own reflection, not a woman stands in front of a mirror.`,
      },
      {
        symptom: "The phone disappears",
        cause: `The prompt asks for the phone to be visible in her hand. Keep it. A mirror selfie
with no phone in it looks wrong even if you cannot say why.`,
      },
    ],
    skoolDescription: `Class 3. The mirror selfie.

Filmed into a bathroom mirror, which is the smartest idea in this whole set. The
reflection hides the phone, explains the framing, and gives the shaky camera a reason
to be shaky.

It also means every word on the packaging has to be printed backwards, and if you
forget that one detail the whole thing stops being believable.

Thirty seconds, one generation, no extending needed. The easiest one to finish.

Made on Seedance 2.5 at dreamina.capcut.com.

Full walkthrough, with the script and the exact prompt to copy: heypubli.com/v3`,
  },

  {
    slug: "v4",
    classNumber: 4,
    sourceFile: "v3.mp4",
    title: "The multi shot explainer",
    subtitle: "Six cuts, four setups, two people, one recognisable face throughout.",
    seconds: 38,
    generations: 2,
    newSkill: "Cutting between setups, and a second character",
    why: `This is the one that shows what Seedance 2.5 is actually for. Older models make one
continuous moment. This one plans a sequence: it cuts to a new angle, a new prop, a second person,
and the same clinician is still recognisably herself in every shot. That consistency comes from the
reference image, not from your description.`,
    script: `Eating less during menopause isn't making you thinner. It's actually making you fatter. The reason for this is because when you restrict calories, it raises your cortisol levels, which signals to your body to store fat away. And this fat, unfortunately, is usually stored around the one place you don't want it to be stored, your belly. And while you're on menopause, your body is pretty much your worst enemy, working against you in every way it possibly can. I always recommend this one thing to my clients who are in that menopause phase, really struggling to move that stubborn fat. It seems to really change their lives. If you want the protocol I give out, comment protocol and I'll send you it for completely free.`,
    scriptNote: `The structure is worth copying whatever you sell. A claim that contradicts what the
viewer believes, then the mechanism that explains it, then proof that she does this for a living,
then one specific instruction. The whole thing exists to earn the last sentence.`,
    twoPart: {
      partOne: `Part one is the first four setups: the patient, the chart, and the two pieces to
camera. Generate 30 seconds with the prompt below and the first half of the script. Because this
half contains five of the six cuts, it is the one that will need the most attempts.`,
      partTwo: `Part two is the box and the call to action, about 8 seconds. Extend from your chosen
part one. One warning specific to this class: an extend has to continue whatever was happening in
the final frame, so end part one on a simple, settled shot rather than mid cut. The prompt puts her
seated with the box for exactly that reason.`,
      scriptOne: `Eating less during menopause isn't making you thinner. It's actually making you fatter. The reason for this is because when you restrict calories, it raises your cortisol levels, which signals to your body to store fat away. And this fat, unfortunately, is usually stored around the one place you don't want it to be stored, your belly. And while you're on menopause, your body is pretty much your worst enemy, working against you in every way it possibly can.`,
      scriptTwo: `I always recommend this one thing to my clients who are in that menopause phase, really struggling to move that stubborn fat. It seems to really change their lives. If you want the protocol I give out, comment protocol and I'll send you it for completely free.`,
    },
    steps: [
      {
        title: "Write the shots before the prompt",
        body: `Six cuts means six decisions. Write them as a list first: who is in frame, how wide,
what they are holding. The prompt below is that list turned into timestamps, and that is the only
structure the model reliably follows.`,
      },
      {
        title: "Lock the main character with one image",
        body: `Your clinician photograph is used in every shot. Say so explicitly. The prompt uses
the line she must be recognisably the same person in every shot.`,
      },
      {
        title: "Give the second person their own image",
        body: `Two characters means two references. The patient needs @Image 2 or she will change
between takes just as badly as the clinician would.`,
      },
      {
        title: "Describe what the props say, word for word",
        body: `The printed chart and the cardboard box both carry text. Write out exactly what is
printed on them, or the model invents something different in each shot.`,
      },
      {
        title: "Generate 30, extend to 38",
        body: `Same extend pass as Class 2, but read the warning in the two part section first. An
extend continues a moment, so part one has to end on a settled one.`,
      },
    ],
    prompt: CLASS_FOUR_PROMPT,
    fixes: [
      {
        symptom: "She changes between shots",
        cause: `The reference image was not applied, or you described her instead. This is the whole
difficulty of multi shot and the reference is the only real fix.`,
      },
      {
        symptom: "The room rearranges itself",
        cause: `Name the fixed things: the window behind her, the chair to her left, the desk to her
right. Without anchors the model rebuilds the room at every cut.`,
      },
      {
        symptom: "The extend produces a new scene",
        cause: `Part one ended on a cut or a movement, so there was nothing settled to continue.
End part one on a still, simple shot.`,
      },
    ],
    skoolDescription: `Class 4. The multi shot explainer.

Six cuts. Four camera setups. Two people. And the same clinician is recognisably the
same woman in every single shot, which is the hard part.

This is the video that shows what Seedance 2.5 can do that older models cannot. It
does not just make one continuous moment, it plans a sequence and cuts through it.

You will learn how to write a shot list the model will actually follow, how to stop
your presenter turning into somebody else every time the camera moves, and how to end
part one so the extend does not invent a new scene.

Made on Seedance 2.5 at dreamina.capcut.com.

Full walkthrough, with the script and the exact prompt to copy: heypubli.com/v4`,
  },

  {
    slug: "v5",
    classNumber: 5,
    sourceFile: "v4.mp4",
    title: "The handheld walkthrough",
    subtitle: "A room tour with four whip pans, and the room has to stay where you left it.",
    seconds: 30,
    generations: 1,
    newSkill: "Camera movement and spatial consistency",
    why: `Save this for last. Everything before it kept the camera still, which is the model's
comfort zone. Here the camera swings off her face to a sofa, holds, and swings back, four separate
times. Every swing is a chance for the room to rebuild itself differently, and when it does, the
video is unusable.`,
    script: `Okay, apartment tour, well, one room, but it's the room. I mean, come on. So the sofa, flea market, 60 bucks. I know. The throw my grandpa made, and this little guy, no idea, he just lives here now. The rug that started the whole colour thing, chair from a local maker, shelf's basically a plant hospital at this point. Anyway, never leaving. Bye.`,
    scriptNote: `Every object gets a fragment, not a sentence. Flea market, 60 bucks. I know. That
rhythm is what tells the model to whip the camera, because the words are doing the same thing the
camera is. Write this one as flowing prose and you will get a slow, calm pan instead.`,
    steps: [
      {
        title: "Give the room a reference image of its own",
        body: `One wide photograph of the whole space, loaded as @Image 2 alongside your presenter.
This is the room's memory. Seedance 2.5 accepts up to 50 references and a single wide frame carries
more usable information about a space than any paragraph you could write about it.`,
      },
      {
        title: "Anchor each object to its neighbour, not to the room",
        body: `The prompt below states the layout once, as a locked line: sofa and bolster on one
wall, rug and red chair in the centre, shelf and lantern by the door. Objects tied to a wall or to
each other survive a camera move. Objects described loosely get rebuilt somewhere new the moment
they leave frame.`,
      },
      {
        title: "Ask for whips by name",
        body: `Whip is a real camera term and the model knows it. Say whip the camera away to X,
hold, whip back. Write it as the camera moves quickly instead and you will get a slow pan every
time.`,
      },
      {
        title: "Write in fragments so the words set the pace",
        body: `Flea market, 60 bucks. I know. That rhythm is the instruction. A script written as
flowing prose produces a calm, drifting camera no matter what the camera direction says, because
the model matches the energy of the delivery.`,
      },
      {
        title: "Generate in batches and judge on the whips",
        body: `Run four at a time and review them full screen, scrubbing the whip frames first. That
is where this shot succeeds or fails, and it is quicker to reject on those two seconds than to watch
all thirty.`,
      },
    ],
    prompt: CLASS_FIVE_PROMPT,
    fixes: [
      {
        symptom: "The room changes mid pan",
        cause: `The most common failure and the reason for the paper plan. Anchor every object to a
wall or a neighbour, not to a vague sense of the space.`,
      },
      {
        symptom: "The whips are too slow",
        cause: `Use the word whip. Add fast natural motion blur on each whip, which is in the prompt
below.`,
      },
      {
        symptom: "She loses the phone",
        cause: `In a selfie walkthrough her arm is extended the whole time. If the framing drifts
into a normal camera angle the illusion breaks. Repeat held at arm's length.`,
      },
    ],
    skoolDescription: `Class 5. The handheld walkthrough.

The hardest one, so leave it until you have done the other four.

Every video so far kept the camera still, which is where these models are strongest.
This one swings the camera off her face onto the sofa, holds, and swings back, four
separate times. Each swing is a chance for the room to rebuild itself wrong.

You will learn how to pin a room down so it stays put, how to write a script whose
rhythm makes the camera move, and why this class needs five attempts where the others
need one.

Made on Seedance 2.5 at dreamina.capcut.com.

Full walkthrough, with the script and the exact prompt to copy: heypubli.com/v5`,
  },
  {
    slug: "v6",
    classNumber: 6,
    sourceFile: "v6.mp4",
    title: "The camcorder ASMR vlog",
    subtitle: "Ten shots in one pass, and it has to look like an amateur filmed it.",
    seconds: 30,
    generations: 1,
    shots: 10,
    soundLed: true,
    newSkill: "Sound as the content, and deliberately imperfect camera work",
    why: `Every class before this one tried to look good. This one tries to look real, which is
the harder trick and the one that actually sells. Ask a video model for beautiful and it gives you
an advert nobody trusts. Ask it for a cheap camcorder with the focus hunting and the exposure
jumping, and people stop asking whether it is AI, because nothing about it is trying to impress
them.

It is also the densest thing in the course. Ten shots in a single 30 second pass, where class 4
took two passes to manage six.`,
    script: `Morning coffee, the proper way. Here we go. Time for the milk. That's exactly what I needed. See you later.`,
    scriptNote: `Twenty words across thirty seconds, and that is the whole script. Count how long
the video goes without anybody speaking: it is most of it. The dialogue is there to mark the
chapters, not to carry the video. Write more than this and you will get a man narrating a coffee,
which is a completely different and much worse video.`,
    soundDesign: `The grinder whirring, the tamp knocking down, the portafilter twisting into the
group head, espresso hitting the cup, the steam wand screaming and then settling as the milk comes
up to temperature, the cup going down on the counter. Seedance 2.5 generates the audio with the
picture, so these are prompted, not added afterwards in an editor. Naming each sound against the
shot that makes it is what gets you a video worth listening to.`,
    steps: [
      {
        title: "Ask for the cheap camera on purpose",
        body: `The first block of the prompt is a list of faults: hand shake, focus hunting,
imperfect framing, auto-exposure shifts, tape grain. Every one of those is something a director
would be fired for. Together they are the entire reason the clip reads as a real person's morning
rather than a commercial, so put them first, before you describe anything else.`,
      },
      {
        title: "Name the sound in every shot that makes one",
        body: `Seedance 2.5 makes the audio at the same time as the picture, from the same prompt.
A shot that says "tamps the grounds" gets you a picture of tamping. A shot that says tamping and
also lists the knock in the audio notes gets you the sound that makes the shot worth watching.
This is the class where the AUDIO NOTES block earns its place.`,
      },
      {
        title: "Give every shot a length and a shot type",
        body: `Ten entries, each one marked with its seconds and its framing: propped medium,
overhead, close-up, handheld, detail, macro. Ten times three is thirty, which is the cap for one
pass. The arithmetic is the point. Write nine shots and the model stretches them and the pacing
goes slack; write twelve and it rushes or drops some.`,
      },
      {
        title: "Vary the distance, not the position",
        body: `Overhead, then close-up, then handheld, then a macro on the steam wand. The camera
barely moves within any single shot, but no two consecutive shots are the same size. That is what
gives it rhythm without asking the model to do a camera move, which is the thing it is worst at.`,
      },
      {
        title: "Upload his face, do not describe it",
        body: `The prompt carries "Reference @Image 1 for his face". Without it you get a
different man in every generation and the account stops looking like one person. Build him in
class 0 first if you have not, then reuse that same file here.`,
      },
      {
        title: "End with the hand over the lens",
        body: `The last shot reaches toward the camera and a hand covers it as the recording stops.
It is the single most convincing frame in the video, because it is a thing only somebody actually
holding a camcorder would do, and it gives the model an obvious place to end rather than fading
out on nothing.`,
      },
    ],
    prompt: CLASS_SIX_PROMPT,
    fixes: [
      {
        symptom: "It looks like a coffee advert. Clean, smooth, beautifully lit.",
        cause: `The fault list got dropped or softened. Put the camcorder block back at the very
top and be specific: hand shake, focus hunting, auto-exposure shifts. Asking for "casual" is not
enough, the model's default is polished and it will drift back there.`,
      },
      {
        symptom: "The sounds are thin or missing, and it plays like a silent film.",
        cause: `The audio was left to the AUDIO NOTES block alone. Name the sound inside the shot
that makes it as well, so grinding and whirring appear together in the same line.`,
      },
      {
        symptom: "The pacing sags and some shots run long.",
        cause: `Fewer than ten shots. The model spreads whatever you give it across the full
thirty seconds, so eight shots become eight slow ones. Keep the count and the per-shot seconds.`,
      },
      {
        symptom: "His face changes between the grinding shot and the sipping shot.",
        cause: `No reference image, or a different one from your other videos. One file, reused
everywhere, every time.`,
      },
    ],
    skoolDescription: `Class 6. The camcorder ASMR vlog.

Every class before this tried to look good. This one tries to look real, and that is
the harder trick.

Ask a video model for beautiful and you get an advert nobody trusts. Ask it for a cheap
camcorder, with the focus hunting and the exposure jumping about, and people stop asking
whether it is AI. It is also the densest build in the course: ten shots inside a single
thirty second generation.

You will learn how to ask for a bad camera on purpose, how to prompt sound so the
grinder and the steam wand actually carry the video, and how to fit ten shots in one
pass without the pacing going slack.

Made on Seedance 2.5 at dreamina.capcut.com.

Full walkthrough, with the script and the exact prompt to copy: heypubli.com/v6`,
  },
];

export const TUTORIAL_SLUGS: readonly string[] = TUTORIALS.map((t) => t.slug);

export function getTutorial(slug: string): Tutorial | undefined {
  return TUTORIALS.find((t) => t.slug === slug);
}
