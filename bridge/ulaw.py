"""G.711 mu-law, the codec the phone network actually runs on.

Dependency-free on purpose, like the rest of this folder. Python 3.13 removed
`audioop`, which is where this used to live, and the tables are small enough
that pulling in a library to get them back is not worth it.

Telnyx streams PCMU (mu-law, 8 kHz, mono) by default, which is the same thing
the PSTN carries, so this is the edge where their audio becomes our audio.
"""
from __future__ import annotations

import array

BIAS = 0x84
CLIP = 8159

# Upper bound of each of the 8 mu-law segments, in the 14-bit domain.
_SEG_END = (0x3F, 0x7F, 0xFF, 0x1FF, 0x3FF, 0x7FF, 0xFFF, 0x1FFF)


def _build_decode_table() -> tuple[int, ...]:
    out = []
    for byte in range(256):
        u = ~byte & 0xFF
        t = ((u & 0x0F) << 3) + BIAS
        t <<= (u & 0x70) >> 4
        out.append((BIAS - t) if (u & 0x80) else (t - BIAS))
    return tuple(out)


_DECODE = _build_decode_table()


def _encode_one(sample: int) -> int:
    pcm = sample >> 2  # 14-bit
    if pcm < 0:
        pcm = -pcm
        mask = 0x7F
    else:
        mask = 0xFF
    if pcm > CLIP:
        pcm = CLIP
    pcm += BIAS >> 2

    seg = 8
    for i, end in enumerate(_SEG_END):
        if pcm <= end:
            seg = i
            break
    if seg >= 8:
        return 0x7F ^ mask
    return ((seg << 4) | ((pcm >> (seg + 1)) & 0x0F)) ^ mask


_ENCODE = bytes(_encode_one(s if s < 32768 else s - 65536) for s in range(65536))


def decode(payload: bytes) -> bytes:
    """mu-law bytes -> signed 16-bit PCM, same sample rate."""
    out = array.array("h", (_DECODE[b] for b in payload))
    return out.tobytes()


def encode(pcm16: bytes) -> bytes:
    """Signed 16-bit PCM -> mu-law bytes, same sample rate."""
    samples = array.array("h")
    samples.frombytes(pcm16[: len(pcm16) - (len(pcm16) % 2)])
    return bytes(_ENCODE[s & 0xFFFF] for s in samples)


def upsample_2x(pcm16: bytes) -> bytes:
    """8 kHz -> 16 kHz by linear interpolation.

    The pipeline above the transport is defined in 16 kHz mono, so converting
    here keeps every duration, threshold and buffer length in one unit. Getting
    this wrong would silently double every measured millisecond and break the
    end-of-turn timing rather than produce an obvious error.
    """
    samples = array.array("h")
    samples.frombytes(pcm16[: len(pcm16) - (len(pcm16) % 2)])
    if not samples:
        return b""
    out = array.array("h")
    for i, s in enumerate(samples):
        nxt = samples[i + 1] if i + 1 < len(samples) else s
        out.append(s)
        out.append((s + nxt) // 2)
    return out.tobytes()


def downsample_2x(pcm16: bytes) -> bytes:
    """16 kHz -> 8 kHz by averaging pairs."""
    samples = array.array("h")
    samples.frombytes(pcm16[: len(pcm16) - (len(pcm16) % 2)])
    out = array.array("h")
    for i in range(0, len(samples) - 1, 2):
        out.append((samples[i] + samples[i + 1]) // 2)
    return out.tobytes()
