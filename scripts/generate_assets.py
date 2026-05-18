"""
Generate War Table assets using Stable Diffusion XL + pixel-art-xl LoRA.
Theme: Demon Lord Castle — dark fantasy war room.

Generates:
  - 12 agent portrait sprites (256x256)
  - 1 background (1920x1080) — demon lord's war chamber

Requires: diffusers, torch, accelerate, transformers, safetensors
GPU: RTX 5090 32GB (SDXL + LoRA fits easily)
"""

import os
import sys
import torch
from pathlib import Path

# Output directory
OUT_DIR = Path(__file__).parent / "battle-log" / "assets" / "demon-castle"
OUT_DIR.mkdir(parents=True, exist_ok=True)

# Agent definitions: key -> (prompt_description, filename)
# Keys MUST match the SVG sprite keys in war-table.html
AGENTS = {
    "scout": ("a hooded rogue scout with glowing green eyes, leather armor, dark fantasy demon castle servant", "scout.png"),
    "specialist": ("an armored dark knight with a cursed blade, heavy plate armor, demonic runes glowing, demon lord's elite guard", "specialist.png"),
    "sage": ("a sinister archmage with a twisted staff, purple robes with arcane sigils, floating dark orbs, demon lord's advisor", "sage.png"),
    "cloud": ("a demonic general studying a war map, golden armor with demon horns, battle scarred, war table commander", "cloud.png"),
    "swarm": ("a swarm of demonic imp familiars, small bat-winged creatures with glowing eyes, chaotic cluster", "swarm.png"),
    "memory": ("a ghostly librarian spirit holding an ancient tome, ethereal cyan glow, chains of memory, spectral archivist", "memory.png"),
    "router": ("a demonic navigator with a compass made of bone, crossroads demon, portal magic, wayfinder", "router.png"),
    "judge": ("a hooded judge holding scales of dark justice, skeletal hands, blindfolded with third eye, demon court arbiter", "judge.png"),
    "test": ("a mad alchemist with bubbling potions, plague doctor mask, green toxic fumes, laboratory of horrors", "test.png"),
    "eye": ("an all-seeing eye in a triangle of flame, eldritch watcher, cosmic horror, floating in void, surveillance demon", "eye.png"),
    "hypeman": ("a demonic bard with a skull microphone, flaming stage presence, charismatic devil, crowd commander", "hypeman.png"),
    "chain": ("linked chains forming a portal ring, binding magic, contract demon, soul chains interconnected", "chain.png"),
}

BACKGROUND_PROMPT = (
    "interior of a demon lord's war chamber, massive dark stone table with glowing map, "
    "purple torches on obsidian walls, stained glass windows showing hellfire outside, "
    "gothic arches, floating crystal orbs, dark fantasy atmosphere, war room"
)


def load_pipeline():
    """Load SDXL base + pixel-art-xl LoRA."""
    from diffusers import StableDiffusionXLPipeline

    print("[+] Loading SDXL base model (stabilityai/stable-diffusion-xl-base-1.0)...")
    pipe = StableDiffusionXLPipeline.from_pretrained(
        "stabilityai/stable-diffusion-xl-base-1.0",
        torch_dtype=torch.float16,
        use_safetensors=True,
        variant="fp16",
    )
    pipe = pipe.to("cuda")

    print("[+] Loading pixel-art-xl LoRA (nerijs/pixel-art-xl)...")
    pipe.load_lora_weights("nerijs/pixel-art-xl", weight_name="pixel-art-xl.safetensors")

    # Enable memory-efficient attention if available (optional, 32GB VRAM is plenty)
    try:
        pipe.enable_xformers_memory_efficient_attention()
    except (ModuleNotFoundError, ImportError):
        pass  # xformers not installed, not needed with 32GB VRAM

    print("[+] Pipeline ready!")
    return pipe


def generate_sprite(pipe, agent_key, description, filename):
    """Generate a single agent sprite."""
    prompt = f"pixel art, {description}, portrait bust shot, dark background, 16-bit retro game character portrait, detailed pixel art style"
    negative = "blurry, realistic, photo, 3d render, smooth, anti-aliased, text, watermark, signature, low quality"

    out_path = OUT_DIR / filename
    if out_path.exists():
        print(f"  [skip] {filename} already exists")
        return

    print(f"  [gen] {agent_key} -> {filename}")
    image = pipe(
        prompt=prompt,
        negative_prompt=negative,
        width=512,
        height=512,
        num_inference_steps=30,
        guidance_scale=7.5,
        generator=torch.Generator("cuda").manual_seed(hash(agent_key) % (2**32)),
    ).images[0]

    # Resize to 256x256 with nearest-neighbor for crisp pixels
    image = image.resize((256, 256), resample=0)  # 0 = NEAREST
    image.save(out_path)
    print(f"  [done] {filename}")


def generate_background(pipe):
    """Generate the war chamber background."""
    out_path = OUT_DIR / "background.png"
    if out_path.exists():
        print("  [skip] background.png already exists")
        return

    prompt = f"pixel art, {BACKGROUND_PROMPT}, wide shot, 16-bit retro game background, detailed pixel art style, no characters"
    negative = "blurry, realistic, photo, 3d render, smooth, anti-aliased, text, watermark, characters, people"

    print("  [gen] background...")
    image = pipe(
        prompt=prompt,
        negative_prompt=negative,
        width=1280,
        height=768,
        num_inference_steps=35,
        guidance_scale=7.5,
        generator=torch.Generator("cuda").manual_seed(42),
    ).images[0]

    image.save(out_path)
    print("  [done] background.png")


def main():
    print("=" * 60)
    print("  WAR TABLE ASSET GENERATOR — Demon Lord Castle Theme")
    print("=" * 60)
    print(f"Output: {OUT_DIR}")
    print()

    pipe = load_pipeline()

    print("\n[SPRITES] Generating agent portraits...")
    for key, (desc, fname) in AGENTS.items():
        generate_sprite(pipe, key, desc, fname)

    print("\n[BACKGROUND] Generating war chamber...")
    generate_background(pipe)

    print("\n" + "=" * 60)
    print("  ALL ASSETS GENERATED!")
    print(f"  Location: {OUT_DIR}")
    print("=" * 60)


if __name__ == "__main__":
    main()
