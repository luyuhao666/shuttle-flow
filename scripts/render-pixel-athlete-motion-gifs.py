"""Encode real 3D render frames exported by verify:pixel-athlete -- --motion-previews."""
from pathlib import Path
import json
from PIL import Image, ImageDraw, ImageFont

artifacts = Path(__file__).resolve().parents[1] / 'artifacts'
directory = artifacts / 'pixel-athlete-motion-frames'
specs = json.loads((directory / 'frames.json').read_text(encoding='utf-8'))
clips = {}
font = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 20)

def encode(frames, output, duration=40):
    # Shared palette avoids colors flickering between frames.
    sample = Image.new('RGB', (64 * len(frames), 64))
    for i, frame in enumerate(frames):
        sample.paste(frame.resize((64, 64)), (i * 64, 0))
    palette = sample.quantize(colors=192)
    indexed = [frame.quantize(palette=palette, dither=Image.Dither.NONE) for frame in frames]
    indexed[0].save(output, save_all=True, append_images=indexed[1:], duration=duration,
                    loop=0, disposal=2, optimize=False)
    print(output)

for spec in specs:
    key = spec['animation'].lower()
    frames = [Image.open(directory / f'{key}-{i:03d}.png').convert('RGB') for i in range(spec['frames'])]
    clips[key] = frames
    encode(frames, artifacts / f'pixel-athlete-{key}.gif')

keys = [('sidestep', '低重心并步'), ('jump', '起跳与落地'), ('backhand', '反手挥拍')]
panels = []
for i in range(45):
    panel = Image.new('RGB', (960, 358), '#e9ece9')
    draw = ImageDraw.Draw(panel)
    for column, (key, label) in enumerate(keys):
        # Common 1.8-second cycle makes the comparison GIF loop without cutting a motion.
        # Individual GIFs and the interactive preview retain the authored speed.
        frames = clips[key]
        source = frames[min(len(frames) - 1, int(i / 45 * len(frames))) ]
        panel.paste(source.resize((320, 320), Image.Resampling.LANCZOS), (column * 320, 38))
        draw.text((column * 320 + 160, 8), label, font=font, fill='#24464b', anchor='mt')
    panels.append(panel)
encode(panels, artifacts / 'pixel-athlete-motion-preview.gif')

# A contact sheet allows visual inspection of preparation, contact and recovery in each clip.
sheet = Image.new('RGB', (1280, 286 * len(specs)), '#e9ece9')
draw = ImageDraw.Draw(sheet)
for row, spec in enumerate(specs):
    frames = clips[spec['animation'].lower()]
    draw.text((12, row * 286 + 2), spec['label'], font=font, fill='#24464b')
    for column, fraction in enumerate([0, .25, .48, .70, .90]):
        source = frames[min(len(frames) - 1, round(fraction * len(frames)))]
        sheet.paste(source.resize((256, 256), Image.Resampling.LANCZOS), (column * 256, row * 286 + 30))
sheet.save(artifacts / 'pixel-athlete-motion-contact-sheet.jpg', quality=92)
