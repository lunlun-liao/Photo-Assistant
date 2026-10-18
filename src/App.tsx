import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { Aperture, ArrowDown, ArrowDownToLine, ArrowLeft, ArrowLeftRight, ArrowRight, ArrowUp, ArrowUpRight, Camera, Check, CheckCheck, ChevronDown, ChevronRight, CircleHelp, Compass, Crosshair, FlipHorizontal2, Focus, Grid2X2, Image as ImageIcon, Layers3, LoaderCircle, MousePointer2, Move, MoveHorizontal, MoveUpRight, Plus, RotateCcw, ScanLine, ShieldCheck, SlidersHorizontal, Sparkles, Trash2, Upload, UserRound, X } from 'lucide-react';
import { COMPOSITIONS, DEMO_SUBJECTS, LABELS } from './types';
import type { Composition, Shot, Subject } from './types';
import { exportDimensions, guidance } from './geometry';
const Viewpoint = lazy(() => import('./Viewpoint').then(module => ({ default: module.Viewpoint })));
import { deleteShot, loadShots, saveShot } from './storage';

const DEMO = '/demo/bridge.jpg';
const DEMO_DEPTH = '/demo/bridge-depth.png';
const clamp = (value: number, min = -1, max = 1) => Math.max(min, Math.min(max, value));

function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const root = ref.current!;
    const focusable = () => Array.from(root.querySelectorAll<HTMLElement>('button, a[href], input, select, [tabindex="0"]')).filter(el => !el.hasAttribute('disabled'));
    focusable()[0]?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab') {
        const items = focusable(), first = items[0], last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', key);
    const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', key); document.body.style.overflow = overflow; previous?.focus(); };
  }, [onClose]);
  return <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="modal-title" ref={ref}>
      <div className="modal-heading"><h2 id="modal-title">{title}</h2><button className="icon-button" onClick={onClose} aria-label="關閉視窗"><X size={21}/></button></div>
      {children}
    </div>
  </div>;
}

function CompositionIcon({ kind }: { kind: Composition }) {
  return <svg viewBox="0 0 72 50" fill="none" aria-hidden="true">
    <rect x="1" y="1" width="70" height="48" rx="6" stroke="currentColor" opacity=".3"/>
    {kind === 'thirds' ? <><path d="M24 1v48M48 1v48M1 17h70M1 33h70" stroke="currentColor" opacity=".45"/><circle cx="48" cy="17" r="4" fill="currentColor"/></> : kind === 'symmetry' ? <><path d="M36 1v48" stroke="currentColor" strokeDasharray="3 3" opacity=".5"/><path d="m10 40 16-25 10 14 10-14 16 25" stroke="currentColor" strokeWidth="1.5"/></> : <><path d="m7 44 29-31 29 31M22 48 36 13l14 35M1 30l35-17 35 17" stroke="currentColor" opacity=".65"/><circle cx="36" cy="13" r="3" fill="currentColor"/></>}
  </svg>;
}

export default function App() {
  const [page, setPage] = useState<'studio' | 'gallery'>('studio');
  const [source, setSource] = useState<'demo' | 'upload' | 'camera'>('demo');
  const [imageSrc, setImageSrc] = useState(DEMO);
  const [imageSize, setImageSize] = useState({ width: 1500, height: 1000 });
  const [subjects, setSubjects] = useState<Subject[]>(DEMO_SUBJECTS);
  const [selected, setSelected] = useState('bridge');
  const [composition, setComposition] = useState<Composition>('symmetry');
  const [ratio, setRatio] = useState('original');
  const [guides, setGuides] = useState(true);
  const [explore, setExplore] = useState(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [comparing, setComparing] = useState(false);
  const [reconstruction, setReconstruction] = useState<{ image: string; depth: string } | null>({ image: DEMO, depth: DEMO_DEPTH });
  const [busy, setBusy] = useState(false);
  const [aiStatus, setAiStatus] = useState('');
  const [aiError, setAiError] = useState(false);
  const [analysisCount, setAnalysisCount] = useState<number | null>(null);
  const [cameraLoading, setCameraLoading] = useState(false);
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [cameraError, setCameraError] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);
  const [activeShot, setActiveShot] = useState<Shot | null>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [toast, setToast] = useState('');
  const [flash, setFlash] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const photo = useRef<HTMLImageElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const viewCanvas = useRef<HTMLCanvasElement | null>(null);
  const worker = useRef<Worker | null>(null);
  const requestId = useRef(0);
  const pendingFrame = useRef('');
  const busyRef = useRef(false);
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const aiTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dragOrigin = useRef<{ x: number; y: number; startX: number; startY: number; moved: boolean } | null>(null);

  const notify = useCallback((message: string) => {
    clearTimeout(toastTimer.current); setToast(message);
    toastTimer.current = setTimeout(() => setToast(''), 5500);
  }, []);
  const closeHelp = useCallback(() => setHelpOpen(false), []);
  const closeShot = useCallback(() => setActiveShot(null), []);
  const onRendererReady = useCallback((canvas: HTMLCanvasElement | null) => { viewCanvas.current = canvas; }, []);
  const onRendererError = useCallback((message: string) => { setExplore(false); notify(message); }, [notify]);
  const stopCamera = useCallback(() => { stream.current?.getTracks().forEach(track => track.stop()); stream.current = null; }, []);
  const cancelAnalysis = useCallback(() => {
    requestId.current++; worker.current?.terminate(); worker.current = null;
    clearTimeout(aiTimer.current); busyRef.current = false; setBusy(false); setAiStatus('');
  }, []);

  useEffect(() => {
    loadShots().then(setShots).catch(() => notify('瀏覽器未開放本機儲存；仍可拍攝並直接下載照片。'));
    return () => { stopCamera(); worker.current?.terminate(); clearTimeout(aiTimer.current); clearTimeout(toastTimer.current); };
  }, [notify, stopCamera]);
  useEffect(() => {
    const url = reconstruction?.depth;
    return () => { if (url?.startsWith('blob:')) URL.revokeObjectURL(url); };
  }, [reconstruction?.depth]);
  useEffect(() => {
    if (page === 'studio' && source === 'camera' && video.current && stream.current && video.current.srcObject !== stream.current) {
      video.current.srcObject = stream.current;
      void video.current.play().catch(() => setCameraError('相機預覽已暫停，請重新開啟相機。'));
    }
  }, [page, source]);

  function resetSource(next: 'demo' | 'upload' | 'camera') {
    cancelAnalysis(); setSource(next); setSubjects(next === 'demo' ? DEMO_SUBJECTS : []);
    setSelected(next === 'demo' ? 'bridge' : ''); setExplore(false); setComparing(false); setOffset({ x: 0, y: 0 });
    setReconstruction(next === 'demo' ? { image: DEMO, depth: DEMO_DEPTH } : null);
    setAiError(false); setAnalysisCount(null); setCameraError('');
  }

  async function openCamera(nextFacing = facing) {
    if (cameraLoading) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setCameraError('相機需要 HTTPS 或本機安全連線。你可以先匯入照片，或使用範例體驗。'); return;
    }
    setCameraLoading(true); setCameraError('');
    stopCamera();
    try {
      const next = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: nextFacing }, width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false });
      stream.current = next; setFacing(nextFacing); resetSource('camera'); setRatio('original');
      if (video.current) {
        video.current.srcObject = next;
        await video.current.play();
        setImageSize({ width: video.current.videoWidth || 1280, height: video.current.videoHeight || 960 });
      }
      next.getVideoTracks()[0]?.addEventListener('ended', () => {
        if (stream.current === next) { setCameraError('相機已中斷，請重新開啟相機。'); stopCamera(); }
      });
      notify('相機已開啟。點選畫面標記主體，或按「AI 分析」。');
    } catch (error) {
      stopCamera();
      const name = error instanceof DOMException ? error.name : '';
      setCameraError(name === 'NotAllowedError' ? '相機權限尚未開放。請在瀏覽器允許使用相機，或改用匯入照片。' : name === 'NotFoundError' ? '找不到可用的相機，請改用匯入照片。' : '相機目前無法啟動，請確認沒有其他程式使用相機，再試一次。');
    } finally { setCameraLoading(false); }
  }

  async function importPhoto(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith('image/')) { notify('請選擇圖片檔案，例如 JPG、PNG 或 WebP。'); return; }
    if (file.size > 25 * 1024 * 1024) { notify('照片超過 25 MB，請選擇較小的圖片。'); return; }
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas'); canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
      stopCamera(); resetSource('upload'); setImageSrc(canvas.toDataURL('image/jpeg', .94));
      setImageSize({ width: canvas.width, height: canvas.height }); setRatio('original');
      notify('照片已匯入。點一下主體，或啟用 AI 自動分析。');
    } catch { notify('這張圖片無法讀取。若是 HEIC，請先轉成 JPG 後重試。'); }
  }

  const getFrame = useCallback((): HTMLCanvasElement => {
    const media = sourceRef.current === 'camera' ? video.current : photo.current;
    if (!media) throw new Error('畫面還沒準備好');
    const width = media instanceof HTMLVideoElement ? media.videoWidth : media.naturalWidth;
    const height = media instanceof HTMLVideoElement ? media.videoHeight : media.naturalHeight;
    if (!width || !height) throw new Error('影像載入中，請稍後再試');
    const canvas = document.createElement('canvas'); const scale = Math.min(1, 960 / width);
    canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale);
    canvas.getContext('2d')!.drawImage(media, 0, 0, canvas.width, canvas.height);
    return canvas;
  }, []);

  const analyze = useCallback(async (depthOnly = false) => {
    if (busyRef.current) return;
    let frame: HTMLCanvasElement;
    try { frame = getFrame(); } catch (error) { notify((error as Error).message); return; }
    busyRef.current = true; setBusy(true); setAiError(false); setAiStatus('準備在此裝置上分析影像…');
    pendingFrame.current = frame.toDataURL('image/jpeg', .94);
    const id = ++requestId.current;
    const finish = () => { clearTimeout(aiTimer.current); busyRef.current = false; setBusy(false); };
    try {
      if (!worker.current) worker.current = new Worker(new URL('./ai.worker.ts', import.meta.url), { type: 'module' });
      worker.current.onmessage = event => {
        const data = event.data;
        if (data.id !== undefined && data.id !== requestId.current) return;
        if (data.type === 'progress') setAiStatus(data.message);
        if (data.type === 'depth') {
          setReconstruction({ image: pendingFrame.current, depth: URL.createObjectURL(data.depth) });
        }
        if (data.type === 'subjects') {
          const found: Subject[] = data.detections.slice(0, 6).map((d: { label: string; score: number; box: { xmin: number; ymin: number; xmax: number; ymax: number } }, index: number) => ({
            id: `detected-${index}`, name: LABELS[d.label] || d.label, kind: 'AI 辨識', score: d.score,
            box: { x: d.box.xmin, y: d.box.ymin, width: d.box.xmax - d.box.xmin, height: d.box.ymax - d.box.ymin },
          }));
          setSubjects(found); setSelected(found[0]?.id || ''); setAnalysisCount(found.length);
        }
        if (data.type === 'done') { finish(); setAiStatus('深度分析完成，可滑動探索虛擬位置。'); if (!depthOnly) notify('分析完成。選擇主體與構圖，再試試視角探索。'); }
        if (data.type === 'error') { finish(); setAiError(true); setAiStatus('模型無法載入或執行。請確認可連線 Hugging Face，或改用範例體驗。'); }
      };
      worker.current.onerror = () => { finish(); setAiError(true); setAiStatus('裝置無法執行影像模型。可改用範例體驗或手動選擇主體。'); };
      aiTimer.current = setTimeout(() => {
        worker.current?.terminate(); worker.current = null; finish();
        setAiError(true); setAiStatus('模型載入逾時，請確認網路後重試。範例與手動拍攝仍可使用。');
      }, 180000);
      const blob = await new Promise<Blob>((resolve, reject) => frame.toBlob(value => value ? resolve(value) : reject(new Error('無法讀取影像')), 'image/jpeg', .92));
      if (requestId.current === id) worker.current.postMessage({ blob, id, depthOnly });
    } catch { finish(); setAiError(true); setAiStatus('影像分析無法啟動。請使用更新版本的瀏覽器，或改用範例體驗。'); }
  }, [getFrame, notify]);

  // The camera stays live in normal mode. Exploration refreshes its RGB-D frame
  // after inference completes. Pointer changes re-render the reconstructed view.
  useEffect(() => {
    if (page !== 'studio' || source !== 'camera' || !explore || !reconstruction || busy || aiError) return;
    const timer = setTimeout(() => void analyze(true), 3000);
    return () => clearTimeout(timer);
  }, [page, source, explore, reconstruction, busy, aiError, analyze]);

  async function capture() {
    if (capturing) return;
    setCapturing(true);
    try {
      let media: CanvasImageSource;
      let width: number, height: number;
      const generated = explore && !comparing && Boolean(reconstruction);
      if (generated) {
        if (!viewCanvas.current) throw new Error('視角預覽正在準備，請稍後再拍攝。');
        media = viewCanvas.current; width = viewCanvas.current.width; height = viewCanvas.current.height;
      } else if (source === 'camera' && !comparing) {
        if (!stream.current || !video.current?.videoWidth) throw new Error('請先重新開啟相機。');
        media = video.current; width = video.current.videoWidth; height = video.current.videoHeight;
      } else {
        if (!photo.current?.naturalWidth) throw new Error('圖片載入中，請稍後再試。');
        media = photo.current; width = photo.current.naturalWidth; height = photo.current.naturalHeight;
      }
      const crop = exportDimensions(width, height, ratio);
      const canvas = document.createElement('canvas'); canvas.width = crop.width; canvas.height = crop.height;
      canvas.getContext('2d')!.drawImage(media, crop.sx, crop.sy, crop.width, crop.height, 0, 0, crop.width, crop.height);
      const shot: Shot = { id: crypto.randomUUID(), url: canvas.toDataURL('image/jpeg', .94), createdAt: new Date().toISOString(), viewpoint: generated, composition: COMPOSITIONS.find(item => item.id === composition)!.name, width: canvas.width, height: canvas.height };
      setFlash(true); setTimeout(() => setFlash(false), 180);
      setShots(previous => [shot, ...previous]); setActiveShot(shot);
      try { await saveShot(shot); } catch { notify('照片已拍攝，但本機儲存空間不足。請直接下載保存。'); }
    } catch (error) { notify((error as Error).message); }
    finally { setCapturing(false); }
  }

  async function removeShot(shot: Shot) {
    try { await deleteShot(shot.id); setShots(previous => previous.filter(item => item.id !== shot.id)); setActiveShot(null); notify('已從此裝置的作品集移除照片。'); }
    catch { notify('無法刪除照片，請稍後重試。'); }
  }

  const aspect = imageSize.width / imageSize.height;
  const frameAspect = ratio === 'original' ? aspect : ratio === '4:3' ? 4 / 3 : ratio === '1:1' ? 1 : 16 / 9;
  const sceneStyle: CSSProperties = { width: `${Math.max(1, aspect / frameAspect) * 100}%`, height: `${Math.max(1, frameAspect / aspect) * 100}%` };
  const chosen = subjects.find(subject => subject.id === selected);
  const adjustedBox = chosen ? { ...chosen.box, x: .5 + (chosen.box.x - .5) * Math.max(1, aspect / frameAspect), y: .5 + (chosen.box.y - .5) * Math.max(1, frameAspect / aspect), width: chosen.box.width * Math.max(1, aspect / frameAspect), height: chosen.box.height * Math.max(1, frameAspect / aspect) } : undefined;
  const guide = guidance(adjustedBox, composition);
  const Arrow = guide.direction === 'left' ? ArrowLeft : guide.direction === 'right' ? ArrowRight : guide.direction === 'up' ? ArrowUp : guide.direction === 'down' ? ArrowDown : Focus;

  function pointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.target instanceof Element && event.target.closest('button')) return;
    if (explore && reconstruction) {
      event.currentTarget.setPointerCapture(event.pointerId); setDragging(true);
      dragOrigin.current = { x: event.clientX, y: event.clientY, startX: offset.x, startY: offset.y, moved: false };
    }
  }
  function pointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!dragOrigin.current) return;
    const deltaX = event.clientX - dragOrigin.current.x, deltaY = event.clientY - dragOrigin.current.y;
    if (Math.abs(deltaX) + Math.abs(deltaY) > 4) dragOrigin.current.moved = true;
    setOffset({ x: clamp(dragOrigin.current.startX - deltaX / 160), y: clamp(dragOrigin.current.startY + deltaY / 160) });
  }
  function pointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragOrigin.current) { dragOrigin.current = null; setDragging(false); return; }
    if (event.target instanceof Element && event.target.closest('button')) return;
    if (explore) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = .5 + ((event.clientX - rect.left) / rect.width - .5) / Math.max(1, aspect / frameAspect);
    const y = .5 + ((event.clientY - rect.top) / rect.height - .5) / Math.max(1, frameAspect / aspect);
    const subject: Subject = { id: 'manual', name: '我的主體', kind: '手動選擇', box: { x: clamp(x - .09, 0, .82), y: clamp(y - .13, 0, .74), width: .18, height: .26 } };
    setSubjects(previous => [...previous.filter(item => item.id !== 'manual'), subject]); setSelected('manual');
  }

  function toggleExplore() {
    if (!reconstruction) { notify('請先執行 AI 分析，取得此畫面的深度資料。'); void analyze(); return; }
    setExplore(value => !value); setComparing(false);
  }

  return <>
    <header className="site-header">
      <button className="brand" aria-label="FRAME，回到拍攝工作台" onClick={() => setPage('studio')}><span className="brand-mark"><Aperture size={27} strokeWidth={1.6}/></span><span className="brand-name">FRAME<span className="brand-dot">.</span></span><span className="brand-caption">AI 攝影助手</span></button>
      <nav aria-label="主要導覽"><button className={page === 'studio' ? 'nav-active' : ''} onClick={() => setPage('studio')}>拍攝工作台</button><button className={page === 'gallery' ? 'nav-active' : ''} onClick={() => setPage('gallery')}>我的作品<span className="nav-count">{shots.length.toString().padStart(2, '0')}</span></button></nav>
      <div className="header-right"><span className="prototype-tag"><span/>WEB PREVIEW</span><button className="icon-button help-button" aria-label="開啟使用說明" onClick={() => setHelpOpen(true)}><CircleHelp size={20}/></button><span className="avatar" aria-label="本機訪客">F</span></div>
    </header>

    <main>
      {page === 'studio' ? <>
        <section className="intro">
          <div><div className="eyebrow"><span/> A LITTLE GUIDANCE. A NEW PERSPECTIVE.</div><h1>好畫面，從另一個視角開始<span>。</span></h1><p>找到主角、跟著光走，把眼前的日常拍成心中的風景。</p></div>
          <div className="workflow" aria-label="拍攝流程"><span className="workflow-step"><i>01</i>看見主體</span><ChevronRight size={14}/><span className="workflow-step"><i>02</i>找到構圖</span><ChevronRight size={14}/><span className="workflow-step"><i>03</i>探索視角</span></div>
        </section>

        <div className="workspace">
          <section className="camera-column" aria-label="相機與視角控制">
            <div className="camera-shell">
              <div className="camera-topbar"><div className="camera-status"><span className={source === 'camera' ? 'live-dot' : 'demo-dot'}/>{source === 'camera' ? '即時相機' : source === 'demo' ? '範例體驗' : '照片工作台'}<span className="camera-top-divider"/><span>{explore ? '虛擬位置預覽' : '原始視角'}</span></div><div className="camera-top-actions">{source === 'camera' ? <button className="camera-icon" aria-label="關閉相機" title="關閉相機" onClick={() => { stopCamera(); resetSource('demo'); setImageSrc(DEMO); setRatio('original'); }}><X size={16}/></button> : <button className="camera-icon" aria-label="啟動即時相機" title="開啟相機" disabled={cameraLoading} onClick={() => void openCamera()}>{cameraLoading ? <LoaderCircle size={16} className="spin"/> : <Camera size={16}/>}</button>}<button className={guides ? 'camera-icon active' : 'camera-icon'} aria-label={guides ? '隱藏構圖輔助線' : '顯示構圖輔助線'} aria-pressed={guides} onClick={() => setGuides(value => !value)}><Grid2X2 size={17}/></button><label className="ratio-select"><select aria-label="照片比例" value={ratio} onChange={event => setRatio(event.target.value)}><option value="original">原始比例</option><option value="4:3">4:3</option><option value="16:9">16:9</option><option value="1:1">1:1</option></select><ChevronDown size={12}/></label></div></div>
              <div className={`viewfinder ${explore ? 'exploring' : ''} ${dragging ? 'dragging' : ''}`} style={{ aspectRatio: frameAspect }} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={() => { dragOrigin.current = null; setDragging(false); }} aria-label={explore ? '拖曳畫面探索虛擬位置，也可使用下方滑桿' : '點選畫面手動標記拍攝主體'}>
                <div className="scene-content" style={sceneStyle}>
                  <img ref={photo} src={comparing && reconstruction ? reconstruction.image : imageSrc} alt="拍攝取景畫面" className={`scene-photo ${source === 'camera' && !comparing ? 'hidden-media' : ''}`} draggable={false} onLoad={event => { if (source !== 'camera' && !comparing) setImageSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight }); }}/>
                  <video ref={video} autoPlay playsInline muted className={`scene-video ${source !== 'camera' || (explore && reconstruction) || comparing ? 'hidden-media' : ''}`}/>
                  {explore && reconstruction && <div className={`reconstruction-layer ${comparing ? 'compare-hidden' : ''}`}><Suspense fallback={null}><Viewpoint image={reconstruction.image} depth={reconstruction.depth} offset={offset} onReady={onRendererReady} onError={onRendererError}/></Suspense></div>}
                  {chosen && guides && !explore && <div className="subject-box" style={{ left: `${chosen.box.x * 100}%`, top: `${chosen.box.y * 100}%`, width: `${chosen.box.width * 100}%`, height: `${chosen.box.height * 100}%` }}><span className="box-corner tl"/><span className="box-corner tr"/><span className="box-corner bl"/><span className="box-corner br"/><span className="subject-box-label"><Focus size={11}/>{chosen.name}</span></div>}
                </div>
                <div className="viewfinder-shade"/>
                {guides && <svg className="composition-overlay" viewBox="0 0 900 600" preserveAspectRatio="none" aria-hidden="true">{composition === 'thirds' ? <><path d="M300 0v600M600 0v600M0 200h900M0 400h900"/><circle cx="300" cy="200" r="5"/><circle cx="600" cy="200" r="5"/></> : composition === 'symmetry' ? <><path d="M450 0v600" strokeDasharray="6 7"/><path d="M0 300h900" opacity=".25"/></> : <><path d="M0 600 450 290 900 600M170 600 450 290 730 600"/><circle cx="450" cy="290" r="7"/></>}</svg>}
                <div className="frame-corner frame-tl"/><div className="frame-corner frame-tr"/><div className="frame-corner frame-bl"/><div className="frame-corner frame-br"/>
                <div className="scene-tags"><span><ScanLine size={12}/>{source === 'demo' ? '城市漫步' : source === 'camera' ? '即時取景' : '你的照片'}</span>{explore && <span className="explore-scene-tag"><Layers3 size={12}/>{comparing ? '原始畫面' : '深度重投影'}</span>}</div>
                <div className="camera-coordinate"><span>FRAME / {composition.toUpperCase()}</span><Crosshair size={15}/></div>
                {explore ? <div className="drag-hint"><Move size={16}/>{dragging ? '正在移動虛擬觀察位置' : '滑動畫面，換個位置看看'}<span>小範圍位移預覽</span></div> : guides && <div className="ar-guide"><span className="guide-arrow"><Arrow size={24}/></span><span><strong>{guide.title}</strong><small>{guide.detail}</small></span><span className="ar-badge">AR 引導</span></div>}
                {flash && <div className="capture-flash"/>}
              </div>
              <div className="camera-bottom"><button className="thumbnail-button" aria-label="匯入照片" onClick={() => input.current?.click()}><img src={DEMO} alt=""/><Plus size={13}/></button><div className="camera-source-label"><strong>{source === 'demo' ? '先用範例，找找靈感' : source === 'camera' ? '捕捉眼前的這一刻' : '從這張照片開始探索'}</strong><span>{source === 'demo' ? '無需相機權限，即可體驗' : explore ? '此預覽使用最近一次完成分析的影格' : '影像處理與照片儲存皆在此裝置'}</span></div><button className="shutter" aria-label="拍攝照片" title="拍攝照片" disabled={capturing || cameraLoading} onClick={() => void capture()}><span>{capturing ? <LoaderCircle className="spin" size={25}/> : <Camera size={24} strokeWidth={1.6}/>}</span></button><div className="camera-bottom-right">{source === 'camera' && <button className="camera-icon" aria-label="切換前後鏡頭" disabled={cameraLoading} onClick={() => void openCamera(facing === 'environment' ? 'user' : 'environment')}><FlipHorizontal2 size={20}/></button>}<button className={`view-toggle ${explore ? 'on' : ''}`} aria-pressed={explore} onClick={toggleExplore}><Layers3 size={16}/><span>視角探索</span><span className="toggle-dot"/></button></div></div>
            </div>

            {cameraError && <div className="error-panel" role="alert"><Camera size={18}/><span>{cameraError}</span><button onClick={() => input.current?.click()}>匯入照片<ArrowUpRight size={14}/></button></div>}

            <section className={`perspective-card ${explore ? 'perspective-active' : ''}`} aria-label="虛擬位置控制">
              <div className="perspective-header"><div className="perspective-title"><span className="perspective-icon"><MoveHorizontal size={20}/></span><div><h2>換個位置，看見更多<span className="beta-tag">BETA</span></h2><p>移動的是觀察位置，讓前景與背景產生不同的位移。</p></div></div><button className="reset-button" onClick={() => { setOffset({ x: 0, y: 0 }); setComparing(false); }} disabled={!explore}><RotateCcw size={14}/><span>重設位置</span></button></div>
              <div className="position-controls"><div className="slider-group"><div className="slider-heading"><label htmlFor="horizontal">水平位置</label><output htmlFor="horizontal">{offset.x === 0 ? '原點' : `${offset.x > 0 ? '右' : '左'} ${Math.abs(offset.x * 100).toFixed(0)}%`}</output></div><input id="horizontal" aria-label="水平虛擬位置" type="range" min="-1" max="1" step="0.01" value={offset.x} disabled={!explore} onChange={event => setOffset(value => ({ ...value, x: Number(event.target.value) }))}/><div className="slider-labels"><span>向左移動</span><span className="origin-tick">原始位置</span><span>向右移動</span></div></div><div className="slider-group vertical-control"><div className="slider-heading"><label htmlFor="vertical">觀察高度</label><output htmlFor="vertical">{offset.y === 0 ? '原點' : `${offset.y > 0 ? '上' : '下'} ${Math.abs(offset.y * 100).toFixed(0)}%`}</output></div><input id="vertical" aria-label="垂直虛擬位置" type="range" min="-1" max="1" step="0.01" value={offset.y} disabled={!explore} onChange={event => setOffset(value => ({ ...value, y: Number(event.target.value) }))}/><div className="slider-labels"><span>降低</span><span>抬高</span></div></div></div>
              <div className="perspective-foot"><span><MousePointer2 size={13}/>{explore ? '可直接拖曳預覽畫面，或調整滑桿' : '開啟「視角探索」，開始調整虛擬位置'}</span><button disabled={!explore || !reconstruction} onClick={() => setComparing(value => !value)} aria-pressed={comparing}><ArrowLeftRight size={14}/>{comparing ? '返回新視角' : '對照原始畫面'}</button></div>
            </section>
            <p className="prototype-note"><CircleHelp size={13}/><span>目前為單張影像深度重投影。未拍到的邊緣與遮擋區域尚未生成補全；相機模式會在分析完成後更新預覽。</span></p>
          </section>

          <aside className="assistant-panel" aria-label="攝影建議">
            <div className="assistant-heading"><span className="assistant-spark"><Sparkles size={19}/></span><div><h2>你的攝影靈感助手</h2><p>A little direction goes a long way.</p></div><span className="online-dot"/></div>
            <section className="panel-section subject-section"><div className="section-heading"><h3><span>01</span>選擇畫面主角</h3><span className="section-caption">{analysisCount === null ? source === 'demo' ? '範例標註' : '選擇主體' : `${analysisCount} 個辨識結果`}</span></div><p className="section-description">你想把哪個故事，放進畫面裡？</p>
              <div className="subject-list">{subjects.length ? subjects.map((subject, index) => <button key={subject.id} aria-pressed={selected === subject.id} className={`subject-option ${selected === subject.id ? 'selected' : ''}`} onClick={() => setSelected(subject.id)}><span className="subject-thumbnail">{source !== 'camera' ? <img src={imageSrc} alt="" style={{ objectPosition: `${(subject.box.x + subject.box.width / 2) * 100}% ${(subject.box.y + subject.box.height / 2) * 100}%`, transform: `scale(${index === 1 ? 1.4 : 1})` }}/> : subject.name.includes('人物') ? <UserRound size={22}/> : <Focus size={22}/>}</span><span className="subject-option-text"><strong>{subject.name}{index === 0 && <span className="recommend-tag">推薦</span>}</strong><small>{subject.kind}{subject.score !== undefined ? ` · ${Math.round(subject.score * 100)}%` : ''}</small></span><span className="radio-mark">{selected === subject.id && <span/>}</span></button>) : <div className="empty-subjects"><Focus size={27}/><p>{analysisCount === 0 ? '未找到常見物件，試試手動選取。' : '點一下取景畫面，選擇你的主角。'}</p><small>或讓 AI 幫你尋找主體</small></div>}</div>
              <button className="analyze-button" onClick={() => busy ? cancelAnalysis() : void analyze()}><span>{busy ? <LoaderCircle size={14} className="spin"/> : <ScanLine size={14}/>} {busy ? '取消分析' : 'AI 分析畫面'}</span>{!busy && <ArrowUpRight size={14}/>}</button>
              {(busy || aiStatus) && <div className={`ai-progress ${aiError ? 'ai-error' : ''}`} role="status">{busy && <span className="loading-track"><span/></span>}{aiStatus}</div>}
              {!busy && !aiStatus && <p className="model-note">首次 AI 分析需下載模型，影像不會上傳。</p>}
            </section>
            <section className="panel-section composition-section"><div className="section-heading"><h3><span>02</span>找到喜歡的構圖</h3><SlidersHorizontal size={14}/></div><div className="composition-options">{COMPOSITIONS.map(item => <button key={item.id} className={`composition-option ${composition === item.id ? 'selected' : ''}`} onClick={() => setComposition(item.id)} aria-pressed={composition === item.id}><CompositionIcon kind={item.id}/><span>{item.name}</span>{composition === item.id && <span className="composition-check"><Check size={9}/></span>}</button>)}</div><p className="composition-description">{COMPOSITIONS.find(item => item.id === composition)?.description}</p></section>
            <section className="panel-section guide-section"><div className="section-heading"><h3><span>03</span>跟著引導，找到好位置</h3></div><div className="guide-preview"><div className="mini-frame"><span/><Crosshair size={21}/><MoveUpRight size={20}/></div><div><strong>讓靈感，走進畫面</strong><p>參考畫面上的方向與輔助線，<br/>實際移動，找到你的拍攝位置。</p></div></div><button className={`guide-switch ${guides ? 'enabled' : ''}`} onClick={() => setGuides(value => !value)} aria-pressed={guides}><span><Compass size={15}/>AR 構圖引導</span><span className="switch-track"><span/></span></button><p className="model-note">畫面疊圖引導，尚未使用空間定位。</p></section>
            <div className="inspiration-tip"><span><Sparkles size={15}/>一點拍攝靈感</span><p>{composition === 'symmetry' ? '停在中軸，讓兩側線條彼此呼應。偶爾，最安靜的位置最有力量。' : composition === 'thirds' ? '試著留一點空白。主角不必總在正中央，畫面也能說出完整的故事。' : '尋找道路、欄杆或光影，讓線條替你把目光，帶向故事的主角。'}</p></div>
          </aside>
        </div>

        <section className="source-strip"><div className="source-strip-intro"><span className="source-strip-icon"><Camera size={20}/></span><div><h2>換成你的世界</h2><p>打開相機，或從一張照片開始。</p></div></div><div className="source-buttons"><button className="secondary-button" onClick={() => input.current?.click()}><Upload size={16}/>匯入照片</button><button className="primary-button" disabled={cameraLoading} onClick={() => void openCamera()}>{cameraLoading ? <LoaderCircle size={16} className="spin"/> : <Camera size={16}/>}開啟相機<ArrowUpRight size={15}/></button></div></section>
      </> : <section className="gallery-page"><div className="gallery-header"><div><div className="eyebrow"><span/> MOMENTS WORTH KEEPING</div><h1>留住，你的視角<span>。</span></h1><p>照片只儲存在此瀏覽器。喜歡的畫面，記得下載收藏。</p></div><button className="primary-button" onClick={() => setPage('studio')}><Camera size={17}/>繼續拍攝<ArrowUpRight size={16}/></button></div>{shots.length ? <div className="gallery-grid">{shots.map(shot => <button className="gallery-item" key={shot.id} onClick={() => setActiveShot(shot)}><img src={shot.url} alt={`拍攝作品，${shot.composition}`}/><div><span>{shot.composition}<small>{shot.viewpoint ? '深度重投影' : '原始畫面'}</small></span><ArrowUpRight size={19}/></div></button>)}</div> : <div className="gallery-empty"><span><ImageIcon size={37} strokeWidth={1}/></span><h2>第一個好畫面，等你發現。</h2><p>回到工作台，按下快門，收藏屬於你的視角。</p><button className="primary-button" onClick={() => setPage('studio')}>開始拍攝<ArrowRight size={16}/></button></div>}</section>}
      <footer><span><Aperture size={15}/><strong>FRAME.</strong><span>把好奇，留在畫面裡。</span></span><span><ShieldCheck size={14}/>影像留在你的瀏覽器<span className="footer-divider"/>Made for your perspective.</span></footer>
    </main>

    <input ref={input} type="file" accept="image/*" hidden aria-label="選擇要匯入的照片" onChange={event => { void importPhoto(event.target.files?.[0]); event.target.value = ''; }}/>
    {toast && <div className="toast" role="status"><CheckCheck size={18}/><span>{toast}</span><button aria-label="關閉通知" onClick={() => setToast('')}><X size={15}/></button></div>}
    {helpOpen && <Modal title="從一個畫面，開始探索" onClose={closeHelp}><div className="help-content"><p className="help-intro">FRAME 是你的攝影練習夥伴，協助你找到主體、構圖與不同的觀察位置。</p><ol><li><span>01</span><div><strong>打開你的世界</strong><p>使用範例、匯入照片，或在 HTTPS 網頁允許相機權限。點畫面可手動選主體。</p></div></li><li><span>02</span><div><strong>用 AI 尋找主角</strong><p>按「AI 分析畫面」下載並執行裝置端模型。首次約需下載 100 MB 以上，時間依裝置與網路而異；不會上傳你的影像。</p></div></li><li><span>03</span><div><strong>構圖，然後換個位置</strong><p>選擇構圖並參考方向引導。開啟視角探索，拖曳畫面或使用滑桿，感受前後景的視差。</p></div></li><li><span>04</span><div><strong>留住這一刻</strong><p>按下快門，照片會加入本機作品集；再下載 JPG 保存。輔助線與介面不會出現在成品裡。</p></div></li></ol><div className="help-limit"><Layers3 size={20}/><p><strong>關於目前的視角預覽</strong>這是深度重投影原型，未包含生成式遮擋補全。未觀測的區域可能出現空隙或拉伸。範例使用預載深度圖與人工標註；相機會在每次分析完成後更新預覽，尚非逐幀即時生成。AR 為畫面疊圖，並無空間追蹤。</p></div><button className="secondary-button" onClick={() => { stopCamera(); resetSource('demo'); setImageSrc(DEMO); setImageSize({ width: 1500, height: 1000 }); setRatio('original'); setPage('studio'); closeHelp(); }}>回到範例體驗<ArrowUpRight size={15}/></button></div></Modal>}
    {activeShot && <Modal title="這個視角，值得留住。" onClose={closeShot} wide><div className="shot-preview"><img src={activeShot.url} alt="剛拍攝的照片"/></div><div className="shot-details"><div><strong>{activeShot.composition}</strong><span>{activeShot.width} × {activeShot.height} · {activeShot.viewpoint ? '深度重投影預覽' : '原始畫面'} · JPG</span></div><span className="saved-badge"><Check size={13}/>本機作品</span></div><div className="shot-actions"><button className="icon-button delete-button" onClick={() => void removeShot(activeShot)} aria-label="從作品集刪除此照片"><Trash2 size={18}/></button><button className="secondary-button" onClick={closeShot}>繼續探索</button><a className="primary-button" href={activeShot.url} download={`FRAME-${activeShot.createdAt.replace(/[:.]/g, '-')}.jpg`}><ArrowDownToLine size={17}/>下載照片</a></div></Modal>}
  </>;
}
