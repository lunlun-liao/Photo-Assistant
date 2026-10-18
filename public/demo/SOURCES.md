# Demo assets

Source: [Depth Anything V2](https://github.com/DepthAnything/Depth-Anything-V2), `assets/teaser.png` at commit `a561b849ebae10a6f5ef49e26c83cbbcd36c71bf`.

- `bridge.jpg`: the first RGB panel, cropped from the published teaser image at `(0, 0, 1252, 832)` and encoded as JPEG.
- `bridge-depth.png`: the corresponding first depth panel at `(0, 863, 1252, 1698)`. The published visualization was resized to 512 × 342; its colors were mapped to the nearest entry in the 256-color Viridis palette and smoothed by a Gaussian radius of 0.65 pixels. This reconstructs an approximate normalized inverse-depth map from a published visualization, not raw model output or a fresh inference.
- Subject annotations are handwritten demo metadata. No detection confidence is invented.

The upstream repository's Apache 2.0 license is included as `DEPTH-ANYTHING-LICENSE.txt`. Depth Anything V2 is by Lihe Yang, Bingyi Kang, Zilong Huang, Xiaogang Xu, Jiashi Feng, and Hengshuang Zhao (2024).
