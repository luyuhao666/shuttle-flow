"""Assemble actual model-rendered PNG frames into GIFs; no generated artwork."""
from pathlib import Path
import json
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parents[1]
artifacts = root / 'artifacts'
frame_directory = artifacts / 'athlete-motion-frames'
specs = json.loads((frame_directory / 'frames.json').read_text(encoding='utf-8'))
clips = {}
for spec in specs:
    key = spec['animation'].lower()
    frames = [Image.open(frame_directory / f'{key}-{i:03d}.png').convert('RGB') for i in range(spec['frames'])]
    palette_source = Image.new('RGB', (64 * len(frames), 64))
    for i, frame in enumerate(frames):
        palette_source.paste(frame.resize((64, 64)), (i * 64, 0))
    palette = palette_source.quantize(colors=128)
    encoded = [frame.quantize(palette=palette, dither=Image.Dither.NONE) for frame in frames]
    duration = max(10, round(spec['duration'] * 100 / len(frames)) * 10)
    output = artifacts / f'athlete-3d-{key}-fixed.gif'
    encoded[0].save(output, save_all=True, append_images=encoded[1:], duration=duration, loop=0, disposal=2, optimize=False)
    clips[key] = frames
    print(output)

font_path = Path('C:/Windows/Fonts/msyh.ttc')
font = ImageFont.truetype(str(font_path), 20) if font_path.exists() else ImageFont.load_default()
labels = [('jump', '起跳'), ('sidestep', '并步'), ('backhand', '反手')]
panels = []
for i in range(45):
    panel = Image.new('RGB', (960, 368), '#edf0e7')
    draw = ImageDraw.Draw(panel)
    for column, (key, label) in enumerate(labels):
        source = clips[key][min(len(clips[key]) - 1, int(i / 45 * len(clips[key])))]
        panel.paste(source.resize((320, 320), Image.Resampling.LANCZOS), (column * 320, 48))
        draw.text((column * 320 + 160, 15), label, font=font, fill='#21494b', anchor='mt')
    panels.append(panel)
palette_source = Image.new('RGB', (192 * 9, 74))
for i in range(9):
    palette_source.paste(panels[i * 5].resize((192, 74)), (i * 192, 0))
palette = palette_source.quantize(colors=160)
encoded = [panel.quantize(palette=palette, dither=Image.Dither.NONE) for panel in panels]
output = artifacts / 'athlete-3d-motion-fixed.gif'
encoded[0].save(output, save_all=True, append_images=encoded[1:], duration=40, loop=0, disposal=2, optimize=False)
print(output)
