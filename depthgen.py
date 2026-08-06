#!/usr/bin/env python3
"""
depthgen.py — Line-to-Relief depth map generator (Python).

Turns a black-and-white line drawing into a smooth, shaded grayscale depth map.

Approach (v7, user-approved):
  - Each enclosed WHITE region (petal / form) is raised as a smooth dome, normalized
    to its own peak so thin forms raise fully.
  - The INK LINES between forms are filled from the surrounding surface, so they
    read as light/raised boundaries — NOT dark outlines.
  - Only the TRUE OUTER background (the large open border-connected margin around
    the whole design) is darkened, giving depth without hiding internal detail.

Usage:
    python3 depthgen.py input.png output.png [options]
Options: --thr, --sm, --gamma, --top, --bg, --invert
"""
import argparse
import numpy as np
from PIL import Image
from scipy import ndimage
import cv2


def load_gray(path):
    im = Image.open(path).convert('RGBA')
    a = np.asarray(im).astype(np.float32) / 255.0
    al = a[..., 3:4]
    return (a[..., :3] * al).mean(axis=2)


def save(a, path):
    Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8)).save(path)


def relief(gray, thr=0.62, gamma=0.5, top=0.6, bg=0.08, levels=0):
    """Winning approach: raised white forms, light internal lines, dark outer margin.
    levels>0 quantises the raised internal relief into that many discrete depth
    planes (AdaBins-inspired): 0 = smooth continuous, 2-4 = stacked levels."""
    if gamma <= 0: gamma = 0.01
    ink = (gray < thr).astype(np.uint8)
    white = 1 - ink

    # --- true outer background = large open border-connected margin ----------
    border = np.zeros_like(ink)
    border[0,:]=1; border[-1,:]=1; border[:,0]=1; border[:,-1]=1
    page = ndimage.binary_propagation(border * white, mask=white).astype(np.uint8)
    lab_page, nbg = ndimage.label(page)
    sizes = np.bincount(lab_page.ravel())[1:]
    big = int(np.argmax(sizes)) + 1 if nbg > 0 else 0
    outer = (lab_page == big).astype(np.uint8)   # the big margin only
    internal = 1 - outer

    # --- raise each enclosed white form as a smooth dome ---------------------
    dist = cv2.distanceTransform(white, cv2.DIST_L2, 5).astype(np.float32)
    lab, ncomp = ndimage.label(white)
    petal = np.zeros_like(dist, dtype=np.float32)
    for i in range(1, ncomp + 1):
        comp = (lab == i)
        if comp.sum() < 3:
            continue
        dmax_i = dist[comp].max() + 1e-6
        petal[comp] = dist[comp] / dmax_i
    petal = np.power(petal, 0.5)
    petal = (petal - petal.min()) / (petal.max() - petal.min() + 1e-6)
    petal = (1 - top) + top * petal              # map into [1-top, 1]

    # --- fill internal lines so they are LIGHT (no dark outline) -------------
    filled = ndimage.gaussian_filter(petal, 4)
    petal = petal.copy()
    petal[ink > 0] = filled[ink > 0]

    # --- final: petals+lines light, outer margin dark ------------------------
    out = np.where(internal > 0, petal, bg)
    out = ndimage.gaussian_filter(out, 2)
    out[internal > 0] = petal[internal > 0]
    out[outer > 0] = bg
    out = ndimage.gaussian_filter(out, 1.5)

    # --- optional discrete depth levels (AdaBins-inspired) -------------------
    # Quantise the raised internal relief into `levels` stacked planes. Each plane
    # gets a distinct height, producing the clean 'stacked relief' look. The outer
    # margin stays at its background level.
    if levels > 1:
        out = np.clip(out, 0, 1)
        inside = internal > 0
        vals = out[inside]
        lo = vals.min(); hi = vals.max()
        span = hi - lo + 1e-6
        q = np.clip(np.floor((vals - lo) / span * levels), 0, levels - 1).astype(np.int32)
        # map each quantised bin to a distinct level spanning the range
        out[inside] = lo + (q / max(levels - 1, 1)) * span
        # re-smooth lightly so plane boundaries aren't jagged
        out = ndimage.gaussian_filter(out, 1.0)
    return np.clip(out, 0, 1)


def main():
    ap = argparse.ArgumentParser(description='Line drawing -> depth map')
    ap.add_argument('input'); ap.add_argument('output')
    ap.add_argument('--thr', type=float, default=0.62)
    ap.add_argument('--gamma', type=float, default=0.5)
    ap.add_argument('--top', type=float, default=0.6, help='petal range height (0-1)')
    ap.add_argument('--bg', type=float, default=0.08, help='outer background level (0=black, 0.3=mid grey)')
    ap.add_argument('--levels', type=int, default=0, help='discrete depth levels (0=smooth, 2-4=stacked planes)')
    a = ap.parse_args()
    g = load_gray(a.input)
    out = relief(g, thr=a.thr, gamma=a.gamma, top=a.top, bg=a.bg, levels=a.levels)
    save(out, a.output)
    print('saved %s  mean=%.3f bg-dark=%.3f bright=%.3f' %
          (a.output, out.mean(), (out < 0.2).mean(), (out > 0.6).mean()))


if __name__ == '__main__':
    main()
