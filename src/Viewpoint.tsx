import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { depthToDistance } from './geometry';

type Props = { image: string; depth: string; offset: { x: number; y: number }; onReady: (canvas: HTMLCanvasElement | null) => void; onError: (message: string) => void };

// Reconstruct an RGB-D mesh at the original camera rays. Only the camera center
// translates; no lookAt rotation or CSS pan is used for viewpoint exploration.
export function Viewpoint({ image, depth, offset, onReady, onError }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const position = useRef(offset);
  const draw = useRef<(() => void) | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => { position.current = offset; draw.current?.(); }, [offset]);
  useEffect(() => {
    let disposed = false;
    let renderer: THREE.WebGLRenderer | undefined;
    let geometry: THREE.BufferGeometry | undefined;
    let material: THREE.MeshBasicMaterial | undefined;
    let texture: THREE.Texture | undefined;
    let observer: ResizeObserver | undefined;
    setReady(false);
    const load = (url: string) => new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = url;
    });
    void Promise.all([load(image), load(depth)]).then(([photo, map]) => {
      if (disposed || !host.current) return;
      const width = 320, height = Math.max(64, Math.round(width / (photo.width / photo.height)));
      const depthCanvas = document.createElement('canvas'); depthCanvas.width = width + 1; depthCanvas.height = height + 1;
      const ctx = depthCanvas.getContext('2d')!; ctx.drawImage(map, 0, 0, width + 1, height + 1);
      const pixels = ctx.getImageData(0, 0, width + 1, height + 1).data;
      const vertices: number[] = [], uvs: number[] = [], indices: number[] = [];
      const aspect = photo.width / photo.height;
      const fov = 42; const tan = Math.tan(THREE.MathUtils.degToRad(fov / 2));
      for (let y = 0; y <= height; y++) for (let x = 0; x <= width; x++) {
        const i = y * (width + 1) + x;
        const z = depthToDistance(pixels[i * 4]);
        vertices.push((x / width * 2 - 1) * z * tan * aspect, (1 - y / height * 2) * z * tan, -z);
        uvs.push(x / width, 1 - y / height);
      }
      // A continuous surface closes small sampling gaps. At depth discontinuities
      // it stretches known pixels; this is explicitly NOT generative inpainting.
      const add = (a: number, b: number, c: number) => { indices.push(a, b, c); };
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const a = y * (width + 1) + x, b = a + 1, c = a + width + 1, d = c + 1;
        add(a, c, b); add(b, c, d);
      }
      geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); geometry.setIndex(indices);
      texture = new THREE.Texture(photo); texture.colorSpace = THREE.SRGBColorSpace; texture.needsUpdate = true;
      material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
      const scene = new THREE.Scene(); scene.add(new THREE.Mesh(geometry, material));
      const camera = new THREE.PerspectiveCamera(fov, aspect, .1, 20);
      renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false });
      renderer.setClearColor('#26382f'); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.domElement.setAttribute('aria-label', '根據深度資料重建的虛擬位置預覽');
      host.current.appendChild(renderer.domElement);
      const resize = () => {
        if (host.current && renderer) {
          renderer.setSize(host.current.clientWidth, host.current.clientHeight, false);
          draw.current?.();
        }
      };
      observer = new ResizeObserver(resize); observer.observe(host.current); resize();
      const render = () => {
        if (disposed || !renderer) return;
        camera.position.set(position.current.x * .085, position.current.y * .065, 0);
        renderer.render(scene, camera);
      };
      // Render on changes rather than continuously spending GPU time on a still
      // image. This also commits slider changes when the canvas is off-screen.
      draw.current = render; render(); setReady(true); onReady(renderer.domElement);
    }).catch(() => { if (!disposed) onError('這個瀏覽器無法建立 3D 預覽，仍可使用原始畫面拍攝。'); });
    return () => {
      disposed = true; draw.current = null; observer?.disconnect();
      onReady(null); geometry?.dispose(); material?.dispose(); texture?.dispose();
      renderer?.dispose(); renderer?.domElement.remove();
    };
  }, [image, depth, onReady, onError]);
  return <div className={`viewpoint ${ready ? 'ready' : ''}`} ref={host} />;
}
