"""
amxd.py — Save and load Max for Live .amxd files.

The .amxd format is a binary wrapper around the same JSON that .maxpat uses.
Three chunks: ampf (device type), meta (reserved), ptch (patcher JSON + null).
"""

import struct
import json

DEVICE_TYPES = {
    "audio_effect": b"aaaa",
    "midi_effect":  b"mmmm",
    "instrument":   b"iiii",
}


def save_amxd(patcher_json, filename, device_type="instrument"):
    """Wrap a patcher JSON dict in .amxd binary format and write to file."""
    if not isinstance(patcher_json, dict):
        raise TypeError(f"patcher_json must be a dict, got {type(patcher_json).__name__}")
    if device_type not in DEVICE_TYPES:
        raise ValueError(f"Unknown device_type {device_type!r}. "
                         f"Choose from: {', '.join(DEVICE_TYPES)}")

    json_bytes = json.dumps(patcher_json, indent=2).encode("utf-8") + b"\x00"

    with open(filename, "wb") as f:
        # ampf chunk — device type identifier
        f.write(b"ampf")
        f.write(struct.pack("<I", 4))
        f.write(DEVICE_TYPES[device_type])
        # meta chunk — reserved, 4 null bytes
        f.write(b"meta")
        f.write(struct.pack("<I", 4))
        f.write(b"\x00\x00\x00\x00")
        # ptch chunk — the patcher JSON, null-terminated
        f.write(b"ptch")
        f.write(struct.pack("<I", len(json_bytes)))
        f.write(json_bytes)


def load_amxd(filename):
    """Read an .amxd file and return the patcher JSON dict."""
    with open(filename, "rb") as f:
        data = f.read()

    offset = 0
    while offset + 8 <= len(data):
        tag = data[offset:offset + 4]
        size = struct.unpack("<I", data[offset + 4:offset + 8])[0]
        if offset + 8 + size > len(data):
            raise ValueError(f"Chunk {tag!r} size {size} extends past end of file")
        if tag == b"ptch":
            json_bytes = data[offset + 8:offset + 8 + size]
            try:
                return json.loads(json_bytes.rstrip(b"\x00"))
            except json.JSONDecodeError as e:
                raise ValueError(
                    f"ptch chunk in '{filename}' contains invalid JSON: {e}"
                ) from e
        offset += 8 + size

    raise ValueError(f"No ptch chunk found in '{filename}'")
