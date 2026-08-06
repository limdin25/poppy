import { describe, it, expect } from "vitest";
import { TUTORIALS, getTutorial, TUTORIAL_SLUGS } from "./data";

describe("tutorial data", () => {
  it("has the setup class plus six video classes, in order", () => {
    expect(TUTORIALS).toHaveLength(7);
    expect(TUTORIALS.map((t) => t.classNumber)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("gives every class a slug that matches its position, so heypubli.com/v3 is class 3", () => {
    for (const t of TUTORIALS) {
      expect(t.slug).toBe(`v${t.classNumber}`);
    }
    expect(TUTORIAL_SLUGS).toEqual(["v0", "v1", "v2", "v3", "v4", "v5", "v6"]);
  });

  it("makes the setup class the only one with no video of its own", () => {
    // Class 0 produces still images, not a clip, so it has no length and no
    // generations. Everything after it must have both.
    const setup = getTutorial("v0")!;
    expect(setup.seconds).toBe(0);
    expect(setup.generations).toBe(0);
    for (const t of TUTORIALS.filter((x) => x.classNumber > 0)) {
      expect(t.seconds, `${t.slug}`).toBeGreaterThan(0);
      expect(t.generations, `${t.slug}`).toBeGreaterThan(0);
    }
  });

  it("finds a class by slug and returns undefined for anything else", () => {
    expect(getTutorial("v3")?.classNumber).toBe(3);
    expect(getTutorial("v9")).toBeUndefined();
    expect(getTutorial("")).toBeUndefined();
  });

  it("carries the spoken script for every class", () => {
    // Hugo asked for this specifically: a prompt without the words the presenter
    // says is only half a tutorial, because Seedance generates voice and picture
    // together and the script is what drives the lip movement.
    //
    // A sound-led class is the exception and gets a much lower floor. On an ASMR
    // video the dialogue is five short lines and the SOUND is the content, so
    // holding it to the talking-class length would only invite padding it with
    // words the video does not contain.
    for (const t of TUTORIALS) {
      const floor = t.soundLed ? 60 : 120;
      expect(t.script.length, `${t.slug} has no script`).toBeGreaterThan(floor);
    }
  });

  it("makes a sound-led class say what its sounds are", () => {
    // The whole point of the exception above: if the dialogue is allowed to be
    // thin, the audio design has to be written down somewhere instead, or the
    // class teaches nothing about the thing it is actually about.
    for (const t of TUTORIALS.filter((x) => x.soundLed)) {
      expect(t.soundDesign?.length, `${t.slug} is sound-led but lists no sounds`).toBeGreaterThan(80);
      expect(t.prompt, `${t.slug} prompt must carry its audio notes`).toContain("AUDIO");
    }
  });

  it("tells you how many generations a class needs, and it matches its length", () => {
    // Seedance 2.5 makes 30 seconds per pass. Anything longer is two passes.
    for (const t of TUTORIALS.filter((x) => x.classNumber > 0)) {
      const expected = t.seconds <= 30 ? 1 : 2;
      expect(t.generations, `${t.slug} is ${t.seconds}s`).toBe(expected);
    }
  });

  it("explains the two part build on exactly the classes that need one", () => {
    for (const t of TUTORIALS) {
      if (t.generations === 2) {
        expect(t.twoPart, `${t.slug} runs long and must explain the split`).toBeTruthy();
        expect(t.twoPart?.partOne.length).toBeGreaterThan(40);
        expect(t.twoPart?.partTwo.length).toBeGreaterThan(40);
      } else {
        expect(t.twoPart, `${t.slug} fits in one pass and should not claim otherwise`).toBeUndefined();
      }
    }
  });

  it("splits the script in two wherever the video is built in two passes", () => {
    // The whole point of the split: you cannot paste a 60 second script into a
    // 30 second generation, so the words have to be divided as well as the video.
    for (const t of TUTORIALS.filter((x) => x.generations === 2)) {
      expect(t.twoPart?.scriptOne.length, `${t.slug} part one script`).toBeGreaterThan(40);
      expect(t.twoPart?.scriptTwo.length, `${t.slug} part two script`).toBeGreaterThan(40);
    }
  });

  it("sends people to ByteDance rather than a reseller", () => {
    for (const t of TUTORIALS) {
      expect(t.skoolDescription).toContain("dreamina.capcut.com");
    }
  });

  it("never uses a long dash, a curly quote or an ellipsis character", () => {
    // Hugo's standing rule, and these strings end up in SMS and Skool posts.
    const banned = /[–—‘’“”…]/;
    for (const t of TUTORIALS) {
      const all = [
        t.title, t.subtitle, t.why, t.script, t.prompt, t.skoolDescription, t.newSkill,
        ...t.steps.flatMap((s) => [s.title, s.body]),
        ...t.fixes.flatMap((f) => [f.symptom, f.cause]),
        t.twoPart?.partOne ?? "", t.twoPart?.partTwo ?? "",
        t.twoPart?.scriptOne ?? "", t.twoPart?.scriptTwo ?? "",
      ].join(" ");
      const hit = all.match(banned);
      expect(hit, `${t.slug} contains ${hit?.[0]}`).toBeNull();
    }
  });

  it("gives every class a prompt long enough to actually be one", () => {
    for (const t of TUTORIALS) {
      expect(t.prompt.length, `${t.slug} prompt`).toBeGreaterThan(600);
    }
  });

  it("references an uploaded image in every video class, but not in the setup class", () => {
    // Class 0 is where the reference image gets MADE, so it is text to image and
    // has nothing to point at yet. Every class after it must point at one, since
    // describing a face instead of referencing it is the single biggest cause of
    // a presenter drifting between videos.
    expect(getTutorial("v0")!.prompt).not.toContain("@Image");
    for (const t of TUTORIALS.filter((x) => x.classNumber > 0)) {
      expect(t.prompt, `${t.slug} should reference an uploaded image`).toContain("@Image 1");
    }
  });

  it("gives the avatar class the GPT realism module, with both prompts verbatim", () => {
    // The module is the method that stops a generated photo looking generated:
    // grade it from a real reference photo instead of letting the model pick.
    // Its two prompts are meant to be copied character for character, so they
    // are asserted rather than paraphrased.
    const m = getTutorial("v0")!.module!;
    expect(m, "the avatar class must carry the realism module").toBeTruthy();
    expect(m.why.length).toBeGreaterThan(120);
    expect(m.steps.length).toBeGreaterThanOrEqual(5);

    const copy = m.copy.map((c) => c.text).join("\n");
    expect(copy).toContain("analyze this photo and give me a very detailed json prompt");
    expect(copy).toContain("break down the color grading");
    expect(copy).toContain("using this json as reference");

    // Opus specifically. The whole method leans on the analysis being good.
    expect(m.steps.map((s) => s.body).join(" ")).toMatch(/opus/i);
  });

  it("never uses a long dash in a module either", () => {
    // Escape codes, not the characters themselves: written literally, the curly
    // quotes get normalised to straight ones somewhere between here and disk, and
    // the regex then bans ordinary " instead.
    const banned = /[\u2013\u2014\u2018\u2019\u201C\u201D\u2026]/;
    for (const t of TUTORIALS) {
      const m = t.module;
      if (!m) continue;
      const all = [m.title, m.why, ...m.steps.flatMap((s) => [s.title, s.body]),
        ...m.copy.flatMap((c) => [c.label, c.text])].join(" ");
      expect(all.match(banned), `${t.slug} module`).toBeNull();
    }
  });

  it("counts the shots on any class that is really about its shot list", () => {
    // Class 6 crams ten shots into a single 30 second pass, which is the densest
    // in the course and the whole reason it is the last one. If someone edits
    // the storyboard down, the claim in the copy has to move with it.
    const dense = TUTORIALS.filter((t) => t.shots !== undefined);
    expect(dense.length, "no class declares a shot count").toBeGreaterThan(0);
    for (const t of dense) {
      const arrows = (t.prompt.match(/->/g) ?? []).length;
      expect(arrows, `${t.slug} says ${t.shots} shots but the prompt lists ${arrows}`).toBe(t.shots);
    }
  });
});
