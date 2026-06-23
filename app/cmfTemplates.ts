export type CmfSlot = "primary" | "secondary" | "accent";

export type CmfFinish = {
  color: string;
  label: string;
  material: "plastic" | "rubber" | "metal" | "transparent";
  finish: string;
  roughness: number;
  metalness: number;
  clearcoat?: number;
  transmission?: number;
  opacity?: number;
};

export type CmfTemplate = {
  id: string;
  name: string;
  shortName: string;
  category: string;
  background: string;
  edgeColor: string;
  slots: Record<CmfSlot, CmfFinish>;
};

export const cmfTemplates: CmfTemplate[] = [
  {
    id: "contrast-graphite-orange",
    name: "石墨橙撞色",
    shortName: "撞色",
    category: "contrast",
    background: "#f2f5f4",
    edgeColor: "#273139",
    slots: {
      primary: {
        color: "#2c3338",
        label: "石墨灰",
        material: "plastic",
        finish: "细砂哑面塑胶",
        roughness: 0.76,
        metalness: 0.02,
      },
      secondary: {
        color: "#c6ccd0",
        label: "冷灰",
        material: "plastic",
        finish: "低光泽塑胶",
        roughness: 0.58,
        metalness: 0.03,
      },
      accent: {
        color: "#ff6b21",
        label: "安全橙",
        material: "plastic",
        finish: "半哑撞色件",
        roughness: 0.46,
        metalness: 0.02,
      },
    },
  },
  {
    id: "mono-white-graphite-lime",
    name: "白黑荧光点缀",
    shortName: "黑白",
    category: "consumer",
    background: "#eef3f2",
    edgeColor: "#23282d",
    slots: {
      primary: {
        color: "#ecece7",
        label: "暖白",
        material: "plastic",
        finish: "丝滑哑面塑胶",
        roughness: 0.68,
        metalness: 0.01,
      },
      secondary: {
        color: "#20242a",
        label: "石墨黑",
        material: "rubber",
        finish: "微纹理软胶",
        roughness: 0.84,
        metalness: 0,
      },
      accent: {
        color: "#b7ff2a",
        label: "荧光绿",
        material: "plastic",
        finish: "半光色件",
        roughness: 0.4,
        metalness: 0.02,
      },
    },
  },
  {
    id: "smoke-clear-black",
    name: "烟熏透明",
    shortName: "透明",
    category: "transparent",
    background: "#e8ecef",
    edgeColor: "#22303a",
    slots: {
      primary: {
        color: "#73808a",
        label: "烟熏灰",
        material: "transparent",
        finish: "半透明高光 PC",
        roughness: 0.18,
        metalness: 0,
        clearcoat: 0.72,
        transmission: 0.18,
        opacity: 0.58,
      },
      secondary: {
        color: "#171b20",
        label: "黑色内件",
        material: "plastic",
        finish: "深黑哑面塑胶",
        roughness: 0.72,
        metalness: 0.02,
      },
      accent: {
        color: "#6bb7ff",
        label: "冷蓝件",
        material: "plastic",
        finish: "亮面半透明点缀",
        roughness: 0.24,
        metalness: 0,
        clearcoat: 0.58,
      },
    },
  },
  {
    id: "anodized-silver-blue",
    name: "银色阳极蓝",
    shortName: "金属",
    category: "metal",
    background: "#f0f2f1",
    edgeColor: "#2b3439",
    slots: {
      primary: {
        color: "#b7bcc0",
        label: "阳极银",
        material: "metal",
        finish: "细喷砂阳极铝",
        roughness: 0.34,
        metalness: 0.72,
      },
      secondary: {
        color: "#22272b",
        label: "黑色软胶",
        material: "rubber",
        finish: "防滑软胶",
        roughness: 0.88,
        metalness: 0,
      },
      accent: {
        color: "#166dca",
        label: "阳极蓝",
        material: "metal",
        finish: "蓝色阳极铝",
        roughness: 0.28,
        metalness: 0.68,
      },
    },
  },
  {
    id: "outdoor-teal-acid",
    name: "户外青绿",
    shortName: "户外",
    category: "outdoor",
    background: "#eef4ef",
    edgeColor: "#21302d",
    slots: {
      primary: {
        color: "#0f5550",
        label: "深青绿",
        material: "plastic",
        finish: "抗刮哑面塑胶",
        roughness: 0.78,
        metalness: 0.02,
      },
      secondary: {
        color: "#37423d",
        label: "岩灰",
        material: "rubber",
        finish: "粗纹理软胶",
        roughness: 0.92,
        metalness: 0,
      },
      accent: {
        color: "#d9ff3f",
        label: "酸性黄绿",
        material: "plastic",
        finish: "高识别色件",
        roughness: 0.5,
        metalness: 0.01,
      },
    },
  },
  {
    id: "office-mist-sage",
    name: "雾灰鼠尾草",
    shortName: "办公",
    category: "office",
    background: "#f3f5f2",
    edgeColor: "#56635d",
    slots: {
      primary: {
        color: "#c9d0ca",
        label: "雾灰",
        material: "plastic",
        finish: "细腻哑面塑胶",
        roughness: 0.7,
        metalness: 0.01,
      },
      secondary: {
        color: "#748176",
        label: "鼠尾草",
        material: "plastic",
        finish: "低饱和哑面件",
        roughness: 0.66,
        metalness: 0.02,
      },
      accent: {
        color: "#e5e0d2",
        label: "米灰",
        material: "plastic",
        finish: "暖调点缀件",
        roughness: 0.62,
        metalness: 0.01,
      },
    },
  },
  {
    id: "warm-taupe-champagne",
    name: "暖灰香槟",
    shortName: "暖灰",
    category: "premium",
    background: "#f4f1ec",
    edgeColor: "#4b4740",
    slots: {
      primary: {
        color: "#9a9287",
        label: "暖灰",
        material: "plastic",
        finish: "亲肤微纹理塑胶",
        roughness: 0.74,
        metalness: 0.02,
      },
      secondary: {
        color: "#d2b98d",
        label: "香槟",
        material: "metal",
        finish: "香槟阳极金属",
        roughness: 0.32,
        metalness: 0.62,
      },
      accent: {
        color: "#2d2926",
        label: "深咖黑",
        material: "rubber",
        finish: "细纹理软触件",
        roughness: 0.86,
        metalness: 0,
      },
    },
  },
  {
    id: "cyber-bone-cobalt",
    name: "骨白钴蓝",
    shortName: "赛博",
    category: "tech",
    background: "#edf2f6",
    edgeColor: "#222d38",
    slots: {
      primary: {
        color: "#e8e0d0",
        label: "骨白",
        material: "plastic",
        finish: "半哑工程塑胶",
        roughness: 0.56,
        metalness: 0.02,
      },
      secondary: {
        color: "#1e242b",
        label: "结构黑",
        material: "plastic",
        finish: "深色结构件",
        roughness: 0.64,
        metalness: 0.04,
      },
      accent: {
        color: "#245cff",
        label: "钴蓝",
        material: "plastic",
        finish: "高饱和饰件",
        roughness: 0.36,
        metalness: 0.03,
        clearcoat: 0.34,
      },
    },
  },
];
