import * as THREE from "three";

export type MaterialPresetId =
  | "matte-plastic"
  | "gloss-plastic"
  | "fine-texture-plastic"
  | "soft-touch-rubber"
  | "transparent-pc"
  | "sandblasted-anodized-aluminum"
  | "powder-coated-aluminum"
  | "magnesium-alloy"
  | "brushed-aluminum";

export type MaterialPreset = {
  id: MaterialPresetId;
  name: string;
  category: string;
  description: string;
  roughness: number;
  metalness: number;
  clearcoat: number;
  bumpScale: number;
  opacity?: number;
  transmission?: number;
  texture: "none" | "fine-noise" | "orange-peel" | "sandblast" | "brushed" | "cast-metal";
};

export type ProductMaterialInput = {
  color: string;
  material?: string;
  finish?: string;
  roughness?: number;
  metalness?: number;
  clearcoat?: number;
  opacity?: number;
  transmission?: number;
  materialPresetId?: string;
};

export const materialPresets: MaterialPreset[] = [
  {
    id: "matte-plastic",
    name: "哑面塑胶",
    category: "塑胶",
    description: "细腻注塑哑面，适合外壳主体",
    roughness: 0.72,
    metalness: 0.01,
    clearcoat: 0.04,
    bumpScale: 0.018,
    texture: "fine-noise",
  },
  {
    id: "gloss-plastic",
    name: "亮面塑胶",
    category: "塑胶",
    description: "高光塑胶，反射更明显",
    roughness: 0.24,
    metalness: 0,
    clearcoat: 0.55,
    bumpScale: 0.004,
    texture: "none",
  },
  {
    id: "fine-texture-plastic",
    name: "细纹理塑胶",
    category: "塑胶",
    description: "微砂纹注塑质感，适合耐磨表面",
    roughness: 0.82,
    metalness: 0.01,
    clearcoat: 0.02,
    bumpScale: 0.035,
    texture: "fine-noise",
  },
  {
    id: "soft-touch-rubber",
    name: "软触橡胶",
    category: "软胶",
    description: "低反射软触，适合脚垫和防滑件",
    roughness: 0.92,
    metalness: 0,
    clearcoat: 0,
    bumpScale: 0.028,
    texture: "fine-noise",
  },
  {
    id: "transparent-pc",
    name: "透明 PC",
    category: "透明",
    description: "半透明高光聚碳酸酯",
    roughness: 0.12,
    metalness: 0,
    clearcoat: 0.8,
    bumpScale: 0.002,
    opacity: 0.48,
    transmission: 0.22,
    texture: "none",
  },
  {
    id: "sandblasted-anodized-aluminum",
    name: "喷砂阳极铝",
    category: "金属",
    description: "细喷砂阳极氧化铝合金",
    roughness: 0.38,
    metalness: 0.78,
    clearcoat: 0.18,
    bumpScale: 0.018,
    texture: "sandblast",
  },
  {
    id: "powder-coated-aluminum",
    name: "铝合金喷粉",
    category: "金属",
    description: "粉末喷涂铝件，颗粒感更强",
    roughness: 0.74,
    metalness: 0.18,
    clearcoat: 0.06,
    bumpScale: 0.045,
    texture: "orange-peel",
  },
  {
    id: "magnesium-alloy",
    name: "镁合金",
    category: "金属",
    description: "轻量镁合金压铸微纹理",
    roughness: 0.54,
    metalness: 0.55,
    clearcoat: 0.12,
    bumpScale: 0.028,
    texture: "cast-metal",
  },
  {
    id: "brushed-aluminum",
    name: "拉丝铝",
    category: "金属",
    description: "方向性拉丝金属纹理",
    roughness: 0.3,
    metalness: 0.82,
    clearcoat: 0.15,
    bumpScale: 0.02,
    texture: "brushed",
  },
];

const textureCache = new Map<string, THREE.CanvasTexture>();

function randomFor(x: number, y: number, seed: number) {
  const value = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return value - Math.floor(value);
}

function makeTexture(kind: MaterialPreset["texture"]) {
  if (kind === "none") {
    return null;
  }

  const cached = textureCache.get(kind);
  if (cached) {
    return cached;
  }

  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) {
    return null;
  }

  const imageData = context.createImageData(size, size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = (y * size + x) * 4;
      let value = 128;

      if (kind === "fine-noise") {
        value = 112 + randomFor(x, y, 3) * 38;
      } else if (kind === "orange-peel") {
        const wave = Math.sin(x * 0.24 + randomFor(x, y, 8) * 1.6) * 14;
        value = 118 + wave + randomFor(x, y, 4) * 55;
      } else if (kind === "sandblast") {
        value = 106 + randomFor(x, y, 11) * 72;
      } else if (kind === "brushed") {
        value = 112 + Math.sin(y * 0.62) * 18 + randomFor(x, y, 13) * 20;
      } else if (kind === "cast-metal") {
        const pores = randomFor(Math.floor(x / 3), Math.floor(y / 3), 21) > 0.94 ? -42 : 0;
        value = 120 + randomFor(x, y, 17) * 46 + pores;
      }

      const clamped = Math.max(0, Math.min(255, Math.round(value)));
      imageData.data[index] = clamped;
      imageData.data[index + 1] = clamped;
      imageData.data[index + 2] = clamped;
      imageData.data[index + 3] = 255;
    }
  }
  context.putImageData(imageData, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(kind === "brushed" ? 3 : 10, kind === "brushed" ? 18 : 10);
  texture.colorSpace = THREE.NoColorSpace;
  textureCache.set(kind, texture);
  return texture;
}

export function getMaterialPreset(presetId?: string | null, fallback?: ProductMaterialInput) {
  const direct = materialPresets.find((preset) => preset.id === presetId);
  if (direct) {
    return direct;
  }

  const finish = `${fallback?.finish ?? ""} ${fallback?.material ?? ""}`;
  if (/喷粉|粉末/.test(finish)) {
    return materialPresets.find((preset) => preset.id === "powder-coated-aluminum")!;
  }
  if (/镁/.test(finish)) {
    return materialPresets.find((preset) => preset.id === "magnesium-alloy")!;
  }
  if (/拉丝/.test(finish)) {
    return materialPresets.find((preset) => preset.id === "brushed-aluminum")!;
  }
  if (/阳极|铝|金属/.test(finish)) {
    return materialPresets.find((preset) => preset.id === "sandblasted-anodized-aluminum")!;
  }
  if (/透明|PC/.test(finish)) {
    return materialPresets.find((preset) => preset.id === "transparent-pc")!;
  }
  if (/软胶|橡胶|rubber/.test(finish)) {
    return materialPresets.find((preset) => preset.id === "soft-touch-rubber")!;
  }
  if (/亮面|高光/.test(finish)) {
    return materialPresets.find((preset) => preset.id === "gloss-plastic")!;
  }
  return materialPresets.find((preset) => preset.id === "matte-plastic")!;
}

export function createProductMaterial(input: ProductMaterialInput) {
  const preset = getMaterialPreset(input.materialPresetId, input);
  const texture = makeTexture(preset.texture);
  const opacity = input.opacity ?? preset.opacity ?? 1;
  const transmission = input.transmission ?? preset.transmission ?? 0;
  const transparent = opacity < 1 || transmission > 0;

  const material = new THREE.MeshPhysicalMaterial({
    color: input.color,
    roughness: input.roughness ?? preset.roughness,
    metalness: input.metalness ?? preset.metalness,
    clearcoat: input.clearcoat ?? preset.clearcoat,
    transparent,
    opacity,
    transmission,
    depthWrite: !transparent,
    thickness: transparent ? 0.7 : 0,
    ior: transparent ? 1.48 : 1.5,
  });

  if (texture) {
    material.bumpMap = texture;
    material.bumpScale = preset.bumpScale;
    material.roughnessMap = texture;
  }

  return material;
}
