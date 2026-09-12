from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[1] / 'assets' / 'images'
for name in ['bayan-icon.png', 'bayan-mark.png', 'icon.png', 'android-icon-foreground.png', 'splash-icon.png']:
    path = root / name
    image = Image.open(path).convert('RGBA')
    image.thumbnail((512, 512), Image.Resampling.LANCZOS)
    image.save(path, optimize=True, compress_level=9)
    print(name, path.stat().st_size)
