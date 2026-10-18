export type Box = { x: number; y: number; width: number; height: number };
export type Subject = { id: string; name: string; kind: string; box: Box; score?: number };
export type Composition = 'thirds' | 'symmetry' | 'leading';
export type Shot = { id: string; url: string; createdAt: string; viewpoint: boolean; composition: string; width: number; height: number };
export const DEMO_SUBJECTS: Subject[] = [
  { id: 'bridge', name: '橋樑結構', kind: '建築 · 範例標註', box: { x: .16, y: .10, width: .68, height: .74 } },
  { id: 'person', name: '橋上行人', kind: '人物 · 範例標註', box: { x: .385, y: .75, width: .055, height: .19 } },
  { id: 'scene', name: '整體場景', kind: '空間 · 範例標註', box: { x: .05, y: .05, width: .90, height: .9 } },
];
export const COMPOSITIONS: { id: Composition; name: string; en: string; description: string }[] = [
  { id: 'thirds', name: '三分構圖', en: 'Rule of thirds', description: '將主體放在交點，為故事留一點空間。' },
  { id: 'symmetry', name: '對稱構圖', en: 'Symmetry', description: '沿著畫面中軸，讓兩側線條自然平衡。' },
  { id: 'leading', name: '引導線構圖', en: 'Leading lines', description: '順著橋樑與道路的線條，把視線帶向主體。' },
];
export const LABELS: Record<string, string> = {
  person: '人物', bicycle: '自行車', car: '汽車', motorcycle: '機車', bus: '公車', truck: '卡車',
  bird: '鳥', cat: '貓咪', dog: '狗狗', horse: '馬', sheep: '羊', cow: '牛', elephant: '大象',
  giraffe: '長頸鹿', bench: '長椅', chair: '座椅', 'potted plant': '盆栽', 'dining table': '餐桌',
  bottle: '瓶子', cup: '杯子', bowl: '碗', book: '書本', clock: '時鐘', vase: '花瓶', boat: '船',
  backpack: '背包', umbrella: '雨傘', handbag: '手提包', laptop: '筆電', 'cell phone': '手機',
};
