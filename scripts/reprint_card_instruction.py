"""
卡片印刷语重印（第 8 轮）

背景：卡片上印的是「听一遍，跟读一遍，再圈出读起来最顺口的那个词。」，
但网站上的学习流程已改成**两步**（① 听一遍、圈一圈 → ② 跟读一遍），
印刷语必须跟着改，否则孩子照着卡片做会跟网站对不上。

做法（不重新画插画，只改那行字）：
  1. ffmpeg 解 .v2.webp → PIL RGB
  2. 找出印刷语墨迹行（背景色之外的像素），逐行用「同行左侧无墨迹区」的平均色填充擦除
     —— 保留底色的垂直渐变，不会留下一块死板的补丁
  3. 用同一字体/字号/左边界/垂直中心印新句
  4. 另存 .v3.webp（**换文件名** —— 阿里 CDN 边缘缓存 30 天，不换名字线上不生效）

字体/字号是用**原句复现**校准出来的：msyhbd.ttc 24 号，复现宽度 552 vs 原图 547（差 0.9%），
字重字高肉眼一致（叠图比对过）。

运行：
  python scripts/reprint_card_instruction.py --out public/assets/cards
  python scripts/reprint_card_instruction.py --verify      # 用原句复现做校准体检
"""
import argparse
import io
import os
import subprocess
from collections import Counter

from PIL import Image, ImageDraw, ImageFont

FF = r'C:\ffmpeg\ffmpeg-8.0.1-essentials_build\bin\ffmpeg.exe'
FONT_BOLD = r'C:\Windows\Fonts\msyhbd.ttc'

OLD = '听一遍，跟读一遍，再圈出读起来最顺口的那个词。'
NEW = '听一遍、圈一圈，再跟读一遍。'

FONT_SIZE = 24
INK_COLOR = (44, 37, 63)
INK_TOL = 90
# 印刷语搜索窗口：必须避开上方紫色卡头的底边（实测在 y=225 附近）
SEARCH_TOP, SEARCH_BOT = 234, 285
# 擦除时在墨迹上下各留的余量
PAD = 3


def resolve_ffmpeg() -> str:
    if os.environ.get('FFMPEG_PATH'):
        return os.environ['FFMPEG_PATH']
    import glob
    for cand in glob.glob(r'C:\ffmpeg\ffmpeg-*\bin\ffmpeg.exe'):
        return cand
    from shutil import which
    w = which('ffmpeg')
    if w:
        return w
    raise SystemExit('找不到 ffmpeg（设 FFMPEG_PATH 或装到 PATH）')


def load(path: str) -> Image.Image:
    ff = resolve_ffmpeg()
    out = subprocess.run(
        [ff, '-hide_banner', '-loglevel', 'error', '-i', path,
         '-f', 'image2pipe', '-vcodec', 'png', '-'],
        capture_output=True, check=True)
    return Image.open(io.BytesIO(out.stdout)).convert('RGB')


def background_color(im: Image.Image) -> tuple:
    """印刷语行的底色（众数）"""
    px = im.load()
    W, H = im.size
    c = Counter()
    for y in range(SEARCH_TOP, SEARCH_BOT):
        for x in range(0, W, 3):
            c[px[x, y]] += 1
    return c.most_common(1)[0][0]


def is_ink(c, bgc) -> bool:
    return abs(c[0]-bgc[0]) + abs(c[1]-bgc[1]) + abs(c[2]-bgc[2]) > INK_TOL


def find_ink_rows(im: Image.Image, bgc):
    """返回 {y: [x...]}；只在印刷语搜索窗口内找（避开紫头底边）"""
    px = im.load()
    W, H = im.size
    rows = {}
    for y in range(SEARCH_TOP, SEARCH_BOT):
        xs = [x for x in range(W) if is_ink(px[x, y], bgc)]
        if xs:
            rows[y] = xs
    return rows


def erase(im: Image.Image, bgc):
    """擦掉印刷语；逐行用「同行左侧无墨迹区平均色」填充，保留垂直渐变。

    返回 (x0, x1, y_top, y_bottom) —— 原句的墨迹包围盒；找不到返回 None
    """
    px = im.load()
    W, H = im.size
    rows = find_ink_rows(im, bgc)
    if not rows:
        return None
    allx = [x for v in rows.values() for x in v]
    x0, x1 = min(allx), max(allx)
    ys = sorted(rows)
    y0, y1 = ys[0], ys[-1]

    top = max(SEARCH_TOP, y0 - PAD)
    bot = min(SEARCH_BOT - 1, y1 + PAD)
    for y in range(top, bot + 1):
        sample = [px[x, y] for x in range(0, max(1, x0 - 4))]
        if not sample:
            sample = [bgc]
        fill = tuple(sum(c[i] for c in sample) // len(sample) for i in range(3))
        for x in range(max(0, x0 - 4), min(W, x1 + 5)):
            px[x, y] = fill
    return x0, x1, y0, y1


def draw(im: Image.Image, text: str, x_left: int, y_center: float, font, color):
    d = ImageDraw.Draw(im)
    bb = d.textbbox((0, 0), text, font=font)
    w, h = bb[2]-bb[0], bb[3]-bb[1]
    d.text((x_left - bb[0], y_center - h/2 - bb[1]), text, font=font, fill=color)
    return w, h


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cards', required=True, help='卡片素材目录')
    ap.add_argument('--out', required=True, help='输出目录')
    ap.add_argument('--verify', action='store_true', help='用原句复现（校准体检用）')
    ap.add_argument('--only', default=None)
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    files = sorted(f for f in os.listdir(args.cards) if f.endswith('.v2.webp'))
    if args.only:
        files = [f for f in files if args.only in f]

    font = ImageFont.truetype(FONT_BOLD, FONT_SIZE)
    text = OLD if args.verify else NEW
    report = []
    failures = []

    for f in files:
        src = os.path.join(args.cards, f)
        dst = os.path.join(args.out, f.replace('.v2.webp', '.v3.webp'))
        im = load(src)
        bgc = background_color(im)
        box = erase(im, bgc)
        if box is None:
            failures.append(f'{f}: 找不到印刷语墨迹')
            continue
        x0, x1, y0, y1 = box

        # 擦完必须干净
        residual = {y: len(v) for y, v in find_ink_rows(im, bgc).items() if len(v) > 3}
        if residual:
            failures.append(f'{f}: 擦除残留 {len(residual)} 行')

        w, h = draw(im, text, x0, (y0 + y1) / 2, font, INK_COLOR)
        if x0 + w > im.size[0]:
            failures.append(f'{f}: 新句超出画布 ({x0}+{w} > {im.size[0]})')
        im.save(dst, 'WEBP', quality=82, method=5)
        report.append({'file': f, 'x0': x0, 'old_w': x1-x0+1, 'old_h': y1-y0+1,
                       'new_w': w, 'new_h': h, 'y_center': (y0+y1)/2, 'bg': bgc,
                       'residual': len(residual)})

    print(f'{"文件":<22}{"左边界":<8}{"旧宽":<7}{"旧高":<7}{"新宽":<7}{"新高":<7}{"残留"}')
    for r in report:
        print(f'{r["file"]:<22}{r["x0"]:<8}{r["old_w"]:<7}{r["old_h"]:<7}'
              f'{r["new_w"]:<7}{r["new_h"]:<7}{r["residual"]}')
    print(f'\n处理 {len(report)} 张 / 共 {len(files)} 张')
    print('异常', len(failures), '条')
    for x in failures:
        print('  ', x)
    if failures:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
