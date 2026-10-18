import type { Box, Composition } from './types';

export function guidance(box: Box | undefined, style: Composition) {
  if (!box) return { title: '點一下畫面，選擇你的拍攝主體', detail: '也可以載入 AI，自動尋找畫面裡的主角。', direction: 'center' };
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const targetX = style === 'thirds' ? (x < .5 ? 1 / 3 : 2 / 3) : .5;
  const targetY = style === 'thirds' ? 1 / 3 : .5;
  const dx = x - targetX;
  if (Math.abs(dx) > .055) return {
    title: dx > 0 ? '向右移動一點，讓主體靠近交點' : '向左移動一點，讓主體靠近交點',
    detail: '先實際移動位置，再用下方控制微調虛擬視角。', direction: dx > 0 ? 'right' : 'left',
  };
  if (style === 'thirds' && Math.abs(y - targetY) > .1) return {
    title: y > targetY ? '稍微降低手機，讓主體向上移動' : '稍微抬高手機，讓主體向下移動',
    detail: '參考交點調整高度，保留主體周圍的呼吸空間。', direction: y > targetY ? 'down' : 'up',
  };
  return { title: style === 'leading' ? '順著線條，找到畫面的消失點' : '主體已靠近構圖中軸', detail: '留意畫面邊緣，準備好就按下快門。', direction: 'center' };
}

export function depthToDistance(value: number) { return 1.8 + (1 - Math.max(0, Math.min(255, value)) / 255) * 3.7; }

export function exportDimensions(width: number, height: number, ratio: string) {
  const target = ratio === 'original' ? width / height : ratio === '4:3' ? 4 / 3 : ratio === '1:1' ? 1 : 16 / 9;
  return width / height > target
    ? { width: Math.round(height * target), height, sx: (width - height * target) / 2, sy: 0 }
    : { width, height: Math.round(width / target), sx: 0, sy: (height - width / target) / 2 };
}
