#!/usr/bin/env python3
"""生成 PWA 图标与 iOS 启动页（一次性脚本，可重复执行）。

用法：python3 scripts/generate-assets.py
依赖：Pillow（pip install pillow）
"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
ICON_DIR = ROOT / "public" / "icons"
SPLASH_DIR = ROOT / "public" / "splash"

CREAM = (250, 247, 242, 255)
PAPER = (255, 253, 250, 255)
SAGE_100 = (231, 236, 226, 255)
SAGE_200 = (210, 220, 201, 255)
SAGE_300 = (182, 196, 170, 255)
CLAY = (217, 174, 153, 255)
EDGE = (239, 233, 224, 255)

SS = 4  # 超采样倍数，保证边缘柔和


def render_logo(size: int, ratio: float = 0.34) -> Image.Image:
    """绘制透明底的「餐盘 + 两个人」标记。"""
    big = size * SS
    canvas = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    cx = cy = big / 2
    r = big * ratio
    ring = max(1, int(big * 0.008))

    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=SAGE_100, outline=SAGE_200, width=ring)
    inner = r * 0.70
    draw.ellipse(
        [cx - inner, cy - inner, cx + inner, cy + inner],
        fill=PAPER,
        outline=EDGE,
        width=ring,
    )

    dot_r = r * 0.155
    for dx, color in ((-r * 0.27, CLAY), (r * 0.27, SAGE_300)):
        draw.ellipse(
            [cx + dx - dot_r, cy + r * 0.03 - dot_r, cx + dx + dot_r, cy + r * 0.03 + dot_r],
            fill=color,
        )

    return canvas.resize((size, size), Image.LANCZOS)


def make_icon(size: int, path: Path, ratio: float) -> None:
    bg = Image.new("RGBA", (size, size), CREAM)
    logo = render_logo(size, ratio)
    bg.alpha_composite(logo)
    bg.convert("RGB").save(path, "PNG", optimize=True)
    print("wrote", path.relative_to(ROOT))


def make_splash(width: int, height: int, path: Path) -> None:
    img = Image.new("RGB", (width, height), CREAM[:3])
    logo_size = int(min(width, height) * 0.30)
    logo = render_logo(logo_size, 0.36)
    # 视觉中心略高于几何中心
    img.paste(logo, ((width - logo_size) // 2, int(height * 0.42) - logo_size // 2), logo)
    img.save(path, "PNG", optimize=True)
    print("wrote", path.relative_to(ROOT))


SPLASH_SIZES = [
    (640, 1136),
    (750, 1334),
    (828, 1792),
    (1125, 2436),
    (1170, 2532),
    (1179, 2556),
    (1206, 2622),
    (1242, 2688),
    (1284, 2778),
    (1290, 2796),
    (1320, 2868),
    (2048, 2732),
]


def main() -> None:
    ICON_DIR.mkdir(parents=True, exist_ok=True)
    SPLASH_DIR.mkdir(parents=True, exist_ok=True)

    make_icon(192, ICON_DIR / "icon-192.png", 0.34)
    make_icon(512, ICON_DIR / "icon-512.png", 0.34)
    make_icon(512, ICON_DIR / "icon-maskable-512.png", 0.28)
    make_icon(180, ICON_DIR / "apple-touch-icon.png", 0.34)

    for w, h in SPLASH_SIZES:
        make_splash(w, h, SPLASH_DIR / f"{w}x{h}.png")


if __name__ == "__main__":
    main()
