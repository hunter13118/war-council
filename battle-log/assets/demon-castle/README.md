# Demon Castle Assets

Generated AI pixel art for the "Demon Lord Castle" war table visual mode.

## How to regenerate

```bash
python tools/war-council/generate_assets.py
```

Requires: `diffusers`, `torch` (CUDA), `transformers`, `accelerate`, `safetensors`
Uses: Stable Diffusion XL + pixel-art-xl LoRA (nerijs/pixel-art-xl)
GPU: Needs ~8GB VRAM minimum, optimized for RTX series

## Assets
- 12 agent portrait sprites (256x256 PNG)
- 1 war chamber background (1280x768 PNG)
