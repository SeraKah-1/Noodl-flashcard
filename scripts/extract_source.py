#!/usr/bin/env python3
"""Render an ORIGINAL PDF/PPTX page/slide (including all labels) into an image.

This optional local helper NEVER claims semantic correctness. It produces a
pending-review PNG + a provenance manifest. ChatGPT or a human must inspect the
actual output and the app owner must approve it before a card can reference it.

Dependencies: PyMuPDF, Pillow (pip install -r scripts/requirements-media.txt).
PPTX requires LibreOffice headless for faithful composed slide rendering.
"""
import argparse
import hashlib
import json
import pathlib
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone


def render_pdf(source, page, dpi, crop, output):
    import fitz
    from PIL import Image

    with fitz.open(str(source)) as doc:
        if page < 1 or page > len(doc):
            raise ValueError(f"Page/slide {page} out of range 1..{len(doc)}")
        current = doc[page - 1]
        rect = current.rect
        clip = rect
        if crop is not None:
            x1, y1, x2, y2 = crop
            if not (0 <= x1 < x2 <= 1 and 0 <= y1 < y2 <= 1):
                raise ValueError("Crop coordinates must be fractions: 0<=x1<x2<=1 and 0<=y1<y2<=1")
            clip = fitz.Rect(rect.x0 + rect.width * x1,
                             rect.y0 + rect.height * y1,
                             rect.x0 + rect.width * x2,
                             rect.y0 + rect.height * y2)
        pix = current.get_pixmap(matrix=fitz.Matrix(dpi / 72, dpi / 72), clip=clip, alpha=False, colorspace=fitz.csRGB)
        image = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
        if max(image.size) > 4096 or image.width * image.height > 12_000_000:
            image.thumbnail((4000, 3000), Image.Resampling.LANCZOS)
        if min(image.size) < 32:
            raise ValueError("Rendered crop is too small to inspect")
        image.save(output, format="PNG", optimize=True)
        return len(doc), image.size


def pptx_to_pdf(input_path, destination):
    libre = shutil.which("libreoffice") or shutil.which("soffice")
    if not libre:
        raise RuntimeError("LibreOffice is required for PPTX rendering. Extracting media files alone can lose text labels and arrows.")
    completed = subprocess.run([libre, "--headless", "--convert-to", "pdf", "--outdir", str(destination), str(input_path)],
                               capture_output=True, text=True, timeout=90, check=False)
    result = destination / (input_path.stem + ".pdf")
    if completed.returncode or not result.is_file():
        raise RuntimeError(f"LibreOffice conversion failed: {completed.stderr or completed.stdout}")
    return result


def main():
    ap = argparse.ArgumentParser(description="Extract original PDF/PPTX page or slide as reviewable PNG")
    ap.add_argument("--input", required=True, type=pathlib.Path)
    ap.add_argument("--page", type=int, required=True, help="1-based page or slide index")
    ap.add_argument("--output", required=True, type=pathlib.Path)
    ap.add_argument("--crop", type=float, nargs=4, metavar=("X1", "Y1", "X2", "Y2"), help="Normalized [0..1] crop rectangle")
    ap.add_argument("--dpi", type=int, default=180)
    args = ap.parse_args()
    if not args.input.is_file() or args.input.suffix.lower() not in (".pdf", ".pptx"):
        ap.error("Input must be an existing PDF or PPTX file")
    if not 72 <= args.dpi <= 300:
        ap.error("DPI must be 72..300")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="noodl-source-") as temp:
        original_kind = args.input.suffix.lower()[1:]
        source = pptx_to_pdf(args.input, pathlib.Path(temp)) if original_kind == "pptx" else args.input
        total, size = render_pdf(source, args.page, args.dpi, args.crop, args.output)
    raw = args.output.read_bytes()
    if len(raw) > 4_000_000:
        args.output.unlink(missing_ok=True)
        raise ValueError("Output exceeds the 4 MB image-import limit. Use a tighter crop or lower DPI.")
    manifest = {
        "status": "pending_review", "checkedVisually": False,
        "provenance": {
            "kind": "slide" if original_kind == "pptx" else "file",
            "origin": args.input.name, "sourcePage": args.page,
            "description": f"Original {original_kind.upper()} page/slide render; user must verify labels and crop."
        },
        "method": "libreoffice-pptx-to-pdf+fitz" if original_kind == "pptx" else "fitz-pdf-raster",
        "cropNormalized": args.crop, "dpi": args.dpi,
        "width": size[0], "height": size[1],
        "output": str(args.output), "sha256": hashlib.sha256(raw).hexdigest(),
        "createdAt": datetime.now(timezone.utc).isoformat()
    }
    mpath = args.output.with_suffix(args.output.suffix + ".review.json")
    mpath.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({"image": str(args.output), "manifest": str(mpath), "status": "pending_review", "pageCount": total}, ensure_ascii=False))


if __name__ == "__main__":
    main()
