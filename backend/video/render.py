"""Chromium paints frames from the film's seek(t); ffmpeg stitches them, blends subframes and mixes the sound.

The page is model-written code, so it runs with every request blocked except its own folder and inline data.
"""
import asyncio
import shutil
import subprocess
from pathlib import Path
from urllib.parse import urlparse

from playwright.async_api import async_playwright

from .config import FPS, HEIGHT, SHUTTER, SUBFRAMES, WIDTH

ARGS = ["--deterministic-mode", "--run-all-compositor-stages-before-draw", "--disable-threaded-animation",
        "--force-color-profile=srgb", "--font-render-hinting=none"]


def allowed_url(url: str, root: str) -> bool:
    if url.startswith("data:") or url == "about:blank":
        return True
    u, r = urlparse(url), urlparse(root)
    return u.scheme == "file" and (u.path == r.path or u.path.startswith(r.path.rstrip("/") + "/"))


def ffmpeg(*args: str) -> None:
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args], check=True)


async def _page(p, film_dir: Path):
    browser = await p.chromium.launch(args=ARGS)
    page = await browser.new_page(viewport={"width": WIDTH, "height": HEIGHT}, device_scale_factor=1)
    root = film_dir.resolve().as_uri()
    blocked: list[str] = []

    async def guard(route):
        if allowed_url(route.request.url, root):
            await route.continue_()
        else:
            blocked.append(route.request.url)
            await route.abort()
    await page.route("**/*", guard)
    errors: list[str] = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    await page.goto(f"{root}/film.html")
    try:
        await page.wait_for_function("window.ready === true", timeout=30000)
    except Exception as exc:  # surface the page's own errors (what Opus needs to repair it)
        await browser.close()
        raise RuntimeError(f"window.ready never set; page errors: {'; '.join(errors[:3]) or 'none'}") from exc
    await page.add_style_tag(content="*,*::before,*::after{transition:none!important;animation:none!important}")
    return browser, page, errors, blocked


async def _shot(page, t: float, path: Path) -> None:
    await page.evaluate(f"window.seek({t:.5f})")
    await page.evaluate("new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))")
    await page.screenshot(path=str(path), type="jpeg", quality=92, clip={"x": 0, "y": 0, "width": WIDTH, "height": HEIGHT})


async def _stills(film_dir: Path, times: list[float]) -> tuple[Path, list[str]]:
    out = film_dir / "stills"
    shutil.rmtree(out, ignore_errors=True)
    out.mkdir()
    async with async_playwright() as p:
        browser, page, errors, _ = await _page(p, film_dir)
        for i, t in enumerate(times):
            await _shot(page, t, out / f"s_{i:02d}.jpg")
        await browser.close()
    sheet = film_dir / "stills.jpg"
    ffmpeg("-i", str(out / "s_%02d.jpg"), "-vf", "scale=960:-1,tile=2x2:padding=8:color=white", "-frames:v", "1", str(sheet))
    return sheet, errors


def stills(film_dir: Path, times: list[float]) -> tuple[Path, list[str]]:
    return asyncio.run(_stills(film_dir, times))


async def _frames(film_dir: Path, duration: float, on_progress=None) -> tuple[Path, list[str]]:
    sub = film_dir / "frames"
    shutil.rmtree(sub, ignore_errors=True)
    sub.mkdir()
    n = int(round(duration * FPS))
    offsets = [(j - (SUBFRAMES - 1) / 2) * SHUTTER / (FPS * SUBFRAMES) for j in range(SUBFRAMES)]
    async with async_playwright() as p:
        browser, page, errors, _ = await _page(p, film_dir)
        k = 0
        for i in range(n):
            for o in offsets:
                await _shot(page, min(duration - 1e-3, max(0.0, i / FPS + o)), sub / f"f_{k:05d}.jpg")
                k += 1
            if on_progress and i % FPS == 0:
                on_progress(i / n)
        await browser.close()
    silent = film_dir / "silent.mp4"
    ffmpeg("-framerate", str(FPS * SUBFRAMES), "-i", str(sub / "f_%05d.jpg"), "-vf",
           f"tmix=frames={SUBFRAMES},select='eq(mod(n\\,{SUBFRAMES})\\,{SUBFRAMES - 1})',setpts=N/{FPS}/TB",
           "-r", str(FPS), "-c:v", "libx264", "-crf", "16", "-preset", "medium", "-pix_fmt", "yuv420p", str(silent))
    shutil.rmtree(sub, ignore_errors=True)
    return silent, errors


def frames(film_dir: Path, duration: float, on_progress=None) -> tuple[Path, list[str]]:
    return asyncio.run(_frames(film_dir, duration, on_progress))


def mix(silent: Path, voice: Path, whooshes: list[float], duration: float, out: Path) -> Path:
    """Voice + a soft synthesized whoosh just before each beat, loudness-normalised to -14 LUFS."""
    inputs, chains, labels = ["-i", str(silent), "-i", str(voice)], [], ["[1:a]"]
    for i, t in enumerate(whooshes):
        ms = max(0, int((t - 0.18) * 1000))
        chains.append(f"anoisesrc=d=0.4:c=pink:a=0.05,highpass=f=500,lowpass=f=4000,"
                      f"afade=t=in:d=0.18,afade=t=out:st=0.18:d=0.22,adelay={ms}|{ms},aformat=channel_layouts=stereo[w{i}]")
        labels.append(f"[w{i}]")
    graph = ";".join(chains + [f"{''.join(labels)}amix=inputs={len(labels)}:normalize=0,"
                               f"apad,atrim=0:{duration:.3f},loudnorm=I=-14:TP=-1.5:LRA=11[a]"])
    ffmpeg(*inputs, "-filter_complex", graph, "-map", "0:v", "-map", "[a]", "-c:v", "copy",
           "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(out))
    return out


async def _check(film_dir: Path, duration: float) -> list[str]:
    async with async_playwright() as p:
        try:
            browser, page, errors, _ = await _page(p, film_dir)
        except Exception as exc:  # noqa: BLE001 - a page that never gets ready is the finding
            return [f"page never set window.ready: {str(exc).splitlines()[0][:200]}"]
        try:
            if await page.evaluate("typeof window.seek") != "function":
                errors.append("window.seek is not a function")
            else:
                for t in (0.0, duration / 2, max(0.0, duration - 0.1)):
                    await page.evaluate(f"window.seek({t:.3f})")
        except Exception as exc:  # noqa: BLE001
            errors.append(f"seek threw: {str(exc).splitlines()[0][:200]}")
        await browser.close()
        return errors


def check_page(film_dir: Path, duration: float) -> list[str]:
    """Load the film and call seek() at start/middle/end; return every error (empty = it works)."""
    return asyncio.run(_check(film_dir, duration))
