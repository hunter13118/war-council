"""Generate one image for EbookAVPlayer local fallback.

Usage (from War Council battle-log POST /images/generate):
  echo '{"prompt":"..."}' | python scripts/gen_one_image.py

Or CLI:
  python scripts/gen_one_image.py "pixel art knight" /tmp/out.png

Requires: diffusers, torch, CUDA (same stack as generate_assets.py).
First call loads SDXL + LoRA (~30s); subsequent calls reuse if run as persistent service.
For battle-log we spawn per request (slow first image) — run a dedicated service later.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

_PIPE = None


def _pipe():
    global _PIPE
    if _PIPE is not None:
        return _PIPE
    import torch
    from diffusers import StableDiffusionXLPipeline

    pipe = StableDiffusionXLPipeline.from_pretrained(
        "stabilityai/stable-diffusion-xl-base-1.0",
        torch_dtype=torch.float16,
        use_safetensors=True,
        variant="fp16",
    )
    pipe = pipe.to("cuda")
    try:
        pipe.load_lora_weights("nerijs/pixel-art-xl", weight_name="pixel-art-xl.safetensors")
    except Exception:
        pass
    _PIPE = pipe
    return pipe


def generate(prompt: str, out_path: str, width: int = 512, height: int = 768) -> bool:
    pipe = _pipe()
    negative = "blurry, text, watermark, low quality"
    img = pipe(
        prompt=prompt,
        negative_prompt=negative,
        width=width,
        height=height,
        num_inference_steps=25,
    ).images[0]
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    img.save(out_path)
    return True


def main() -> int:
    if len(sys.argv) >= 3:
        prompt, out = sys.argv[1], sys.argv[2]
        w, h = 512, 768
    else:
        data = json.loads(sys.stdin.read() or "{}")
        prompt = data.get("prompt", "")
        out = data.get("out_path") or data.get("out_hint", "/tmp/vae_gen.png")
        w = int(data.get("width", 512))
        h = int(data.get("height", 768))
    if not prompt:
        print(json.dumps({"ok": False, "error": "no prompt"}))
        return 1
    try:
        generate(prompt, out, w, h)
        print(json.dumps({"ok": True, "path": str(Path(out).resolve())}))
        return 0
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
