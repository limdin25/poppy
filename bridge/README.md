# Elsie AI calling bridge

Places outbound AI phone calls over a **physical SIM in an Android phone**, with
no root, no cable and nothing bought. Proven working on 2026-07-28 against a
stock Samsung Galaxy A16.

This folder never deploys to Vercel (it is listed in `.vercelignore`), the same
way `scraper/` works.

## Run one call

```bash
python3 -m bridge.run --to +447700900185
python3 -m bridge.run --to +447700900185 --business "Smith Plumbing" --reviews 23
```

It dials exactly one number and stops. Transcripts land in `bridge/transcripts/`.

## Connect the phone first (once per session)

Wireless only, no USB cable.

1. Phone: Settings, Developer options, turn on **Wireless debugging**
2. Tap the words "Wireless debugging", then **Pair device with pairing code**
3. On the Mac:

```bash
adb mdns services                 # shows the phone and its pairing port
adb pair <ip>:<pairing-port> <6-digit-code>
adb connect <ip>:<connect-port>
adb devices                       # should list the phone
```

## How it works

```
Mac                                    Phone (SIM)              Prospect
 |-- adb: dial ----------------------------->|
 |                                           |--- cellular ------->|
 |<-- scrcpy: downlink audio via FIFO -------|<-- their voice -----|
 |                                           |
 |  16 kHz mono -> VAD -> STT -> Claude -> TTS
 |                                           |
 |-- speaker ----> phone's microphone ------>|--- AI voice ------->|
```

**The outgoing half is acoustic.** Android blocks software injection into the
call uplink; it cannot block sound. The Mac's speaker plays into the phone's
microphone. Because the incoming half is captured *digitally* over adb, the Mac
never opens a microphone, so there is no echo loop and barge-in still works.

That is also why this does **one call at a time**. Sound has no channels: two
phones beside one laptop hear each other. Concurrency needs a digital transport
(VoIP), which is what `Transport` exists to make swappable.

## Run the tests

```bash
python3 -m bridge.test_bridge
```

Every test in there exists because a real bug was found at that exact spot in
the adversarial review of 2026-07-28 (49 raised, 14 confirmed). They are
regression locks, not coverage. **If one fails, a bug that reached a live call
once has come back.**

## Bugs the review found, and what they cost

Worth reading before changing the audio path, because several were invisible
until someone measured them.

| Bug | What actually happened |
|---|---|
| **VAD noise floor only rose on the not-speech branch** | It could never rise past its own gate, so it froze at exactly -55.0 dBFS. Any line noisier than -43 dBFS (a van hands-free, a workshop, a speakerphone) latched the VAD on permanently: the turn never ended and the prospect got **seven minutes of dead air** after the opener |
| **WAV header assumed to be 44 bytes** | It is about 110. scrcpy sets a comment tag and does not set `AVFMT_FLAG_BITEXACT`, so libavformat writes a LIST/INFO chunk too. ~66 bytes of ASCII header text went into the pipeline as PCM at about -21 dBFS, which is 48 dB above the answer gate, so **every call "answered" instantly and the opener played into a ringing phone** |
| **The opener never got the barge-in hardening the replies did** | Two copies of the same logic, one hardened and one not. No pre-drain, no grace window, a weaker margin, and `BRIDGE_NO_BARGE=1` did not even apply to it. The far end's echo cut the opener off, **taking the AI disclosure with it**, while the transcript recorded the line as delivered in full. The two paths are now one function |
| **Min-utterance gate measured the whole buffer** | The buffer always ends with the 700 ms of silence that closed the turn, so the test could never fail. One 21 ms click uploaded 700 ms of near-silence, the STT invented "Thank you.", and the agent **answered a phrase nobody said** |
| **`adb` return codes ignored** | A failed `KEYCODE_ENDCALL` left a real call **connected with nobody on it, billing**, while the console printed a clean "completed" and saved a tidy transcript. Hangup is now verified against `call_state()` and retried |
| **`[END]` detected literally, stripped by regex** | `[ END ]` was removed from the speech but never ended the call, so the agent agreed to take someone off the list and then stayed on the line |
| **A dead capture pipeline looked like a no-answer** | scrcpy failing to start left a real prospect's phone ringing for the full 45 s and reported `no_answer`. Now its own outcome, `capture_failed` |

## Measured facts, do not re-learn these the hard way

| Thing | Finding |
|---|---|
| WAV recording | needs `--audio-codec=raw` or scrcpy errors |
| WAV header length | **~110 bytes, not 44.** Find the `data` chunk, never assume a length |
| Answer detection | `mCallState` hits 2 (offhook) ~2s after dialling, **long before anyone answers**. Useless. Ringback is not captured, so **audio onset is the real answer signal** |
| Speaker volume | **Louder is worse.** The handset's gain control amplifies quiet input and clips. Audio sent 6 dB below max still arrived clipped at 100%. 65% measured clean |
| Voice quality | Never judge with macOS `say`. It sounds robotic regardless of the line. Real TTS sounded "very good" down the same channel |
| Capture level | -24 dB mean on a live call, vs -91 dB digital silence with no call |

## Latency (measured, warm)

| Stage | ms |
|---|---|
| STT (`gpt-4o-mini-transcribe`) | ~640 |
| Claude Haiku 4.5 | ~1000, occasionally 3000+ |
| TTS (ElevenLabs Flash) | ~425 |
| End-of-turn silence wait | 700 |
| **Total before the cellular leg** | **~2.8s** |

Slower than a human, who replies in about 200ms. The two fixes, in order of
value:

1. **Stream the LLM and start TTS on the first sentence.** Biggest single win,
   would cut roughly a second off the perceived gap.
2. **Streaming STT** (Deepgram or AssemblyAI) instead of batch. Both accept
   8 kHz telephony audio natively and finalise in ~250ms.

## Components, and why

| Layer | Now | Production | Why |
|---|---|---|---|
| Transport | `SimTransport` | VoIP | SIM proves it free; VoIP scales and has no acoustic limit |
| STT | OpenAI `gpt-4o-mini-transcribe` | Deepgram / AssemblyAI | no new account needed today; streaming is the upgrade |
| LLM | Claude Haiku 4.5 | same | **reasoning must stay OFF**, reasoning modes measure 8-90s to first token |
| TTS | ElevenLabs Flash | **Cartesia** | ElevenLabs' AUP **bans "unauthorized robocalling"**. Cartesia's explicitly permits outbound |

Set `CARTESIA_API_KEY` and `CARTESIA_VOICE_ID` and `build_tts()` switches over
automatically.

## Safety rails built in

- **AI disclosure is in the opener**, first breath. Required by UK rules and
  contractually by both Anthropic's and ElevenLabs' policies.
- The prompt forbids inventing company names, prices, statistics and customer
  stories. This is not theoretical: an early test invented "Google Review Boost"
  as the company name.
- `[END]` is stripped wherever the model puts it, so it is never spoken aloud.
- Hard 7-minute call cap so a stuck call cannot run up a bill.
- "Take me off your list" ends the call immediately.

## Not built yet

- CSV lead loading, the dial queue, retry logic
- **The fail-closed "call once, never again" rule.** This is the one that keeps
  complaint rates down and must be a database constraint checked at dial time,
  not a campaign setting
- CTPS and TPS screening
- Answering-machine detection. UK mobile voicemail answers in 15-25s, so at
  typical pickup rates most connected legs are voicemail. Without this the AI
  holds a full conversation with an answerphone
- Writing results to Supabase and the dashboard
