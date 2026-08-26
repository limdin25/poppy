import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { dedupeAgainst, writeHooks } from "./hook-writer";
import { hookKey, type Hook } from "./hook-bank";

const GOOD_LINE =
  "Nobody wants | to say this / Watch her | for five seconds / Then tell me | what is wrong";
const OTHER_LINE =
  "The era is over / And nobody | has noticed / Watch this | to the end";

function reply(text: string, status = 200) {
  return async () =>
    new Response(JSON.stringify({ content: [{ type: "text", text }] }), { status });
}

describe("writeHooks", () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "test-key";
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = saved;
  });

  it("keeps what parses and reports how much it threw away", async () => {
    const r = await writeHooks(
      3,
      [],
      reply([GOOD_LINE, OTHER_LINE, "This is AI / all of it / watch"].join("\n")) as never,
    );
    expect(r.ok).toBe(true);
    expect(r.asked).toBe(3);
    expect(r.kept).toBe(2);
    expect(r.hooks[0].beat1).toBe("Nobody wants\nto say this");
  });

  // The model is told not to use curly punctuation and mostly obeys, but one
  // curly apostrophe would otherwise fail an entire batch on a rule that costs
  // nothing to fix and changes not one word of the writing.
  it("repairs curly punctuation rather than binning a whole batch for it", async () => {
    const curly = "It’s over / Nobody | has noticed / Watch this | to the end";
    const r = await writeHooks(1, [], reply(curly) as never);
    expect(r.kept).toBe(1);
    expect(r.hooks[0].beat1).toBe("It's over");
  });

  it("never lets a spoiler through even if the model insists", async () => {
    const r = await writeHooks(
      2,
      [],
      reply(["Nobody filmed this / it is fake / watch", "She is not real / at all / look"].join("\n")) as never,
    );
    expect(r.ok).toBe(true);
    expect(r.kept).toBe(0);
  });

  it("comes back empty rather than throwing when the API is down", async () => {
    const r = await writeHooks(5, [], reply("", 500) as never);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("api 500");
    expect(r.hooks).toEqual([]);
  });

  it("comes back empty rather than throwing when the network dies", async () => {
    const boom = async () => {
      throw new Error("ECONNRESET");
    };
    const r = await writeHooks(5, [], boom as never);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("ECONNRESET");
  });

  it("does nothing at all without a key, and says so", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const r = await writeHooks(5, [], reply(GOOD_LINE) as never);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("no api key");
  });

  it("survives a model that answers in prose", async () => {
    const r = await writeHooks(5, [], reply("Sure! Here are some ideas for you.") as never);
    expect(r.ok).toBe(true);
    expect(r.kept).toBe(0);
  });
});

describe("dedupeAgainst", () => {
  const a: Hook = { beat1: "one", beat2: "two", beat3: "three" };
  const b: Hook = { beat1: "four", beat2: "five", beat3: "six" };

  it("drops what the bank already holds", () => {
    expect(dedupeAgainst([a, b], new Set([hookKey(a)]))).toEqual([b]);
  });

  it("drops a repeat inside the batch itself", () => {
    expect(dedupeAgainst([a, a, b], new Set()).length).toBe(2);
  });

  it("keeps everything when the bank is empty", () => {
    expect(dedupeAgainst([a, b], new Set()).length).toBe(2);
  });
});
