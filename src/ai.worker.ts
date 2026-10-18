/// <reference lib="webworker" />
import { env, pipeline, RawImage } from '@huggingface/transformers';

env.allowLocalModels = false;
if (env.backends.onnx.wasm) env.backends.onnx.wasm.numThreads = 1;
let depthModel: any;
let subjectModel: any;
let busy = false;
const status = (message: string) => self.postMessage({ type: 'progress', message });
self.onmessage = async (event: MessageEvent<{ blob: Blob; id: number; depthOnly?: boolean }>) => {
  if (busy) return;
  busy = true;
  const { id, blob, depthOnly } = event.data;
  try {
    if (!depthModel) {
      status('首次下載深度模型，完成後會快取於此瀏覽器…');
      depthModel = await pipeline('depth-estimation', 'Xenova/depth-anything-small-hf', { dtype: 'q8', device: 'wasm' });
    }
    const image = await RawImage.fromBlob(blob);
    status('正在估測前景與背景的距離…');
    const result = await depthModel(image);
    // The pipeline normalizes predicted inverse depth into an 8-bit image.
    const depth = await result.depth.toBlob();
    self.postMessage({ type: 'depth', id, depth });
    if (!depthOnly) {
      if (!subjectModel) {
        status('正在載入主體辨識模型…');
        subjectModel = await pipeline('object-detection', 'Xenova/yolos-tiny', { dtype: 'q8', device: 'wasm' });
      }
      status('正在尋找畫面裡的主體…');
      const detections = await subjectModel(image, { threshold: .45, percentage: true });
      self.postMessage({ type: 'subjects', id, detections });
    }
    self.postMessage({ type: 'done', id });
  } catch (error) {
    self.postMessage({ type: 'error', id, message: error instanceof Error ? error.message : String(error) });
  } finally { busy = false; }
};
