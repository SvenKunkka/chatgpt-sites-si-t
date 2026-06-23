"use client";

import {
  Archive,
  Box,
  Camera,
  Download,
  FileUp,
  ImageDown,
  Layers,
  LoaderCircle,
  Palette,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { cmfTemplates } from "./cmfTemplates";
import type { CmfSlot, CmfTemplate } from "./cmfTemplates";
import {
  createProductMaterial,
  getMaterialPreset,
  materialPresets,
} from "./materialSystem";

type Phase = "empty" | "loading" | "ready" | "error";
type QualityKey = "fast" | "balanced" | "fine";
type MaterialMode = "source" | "studio" | "clay";

type OcctFace = {
  first: number;
  last: number;
  color: [number, number, number] | null;
};

type OcctMesh = {
  name: string;
  color?: [number, number, number];
  brep_faces?: OcctFace[];
  attributes: {
    position: { array: number[] };
    normal?: { array: number[] };
  };
  index: { array: number[] };
};

type OcctResult = {
  success: boolean;
  root?: { name?: string };
  meshes: OcctMesh[];
};

type Metrics = {
  fileName: string;
  fileSize: string;
  meshes: number;
  vertices: number;
  triangles: number;
  bounds: string;
  parseTime: string;
};

type RenderViewKey = "hero" | "front" | "top";

type RenderImage = {
  id: string;
  templateId: string;
  templateName: string;
  viewKey: RenderViewKey;
  viewLabel: string;
  fileName: string;
  dataUrl: string;
};

type MaterialOverrides = Partial<Record<CmfSlot, string>>;

type RenderEnvironmentKey =
  | "soft-studio"
  | "ecommerce-white"
  | "black-contrast"
  | "warm-showcase"
  | "cool-tech";

type ReferenceStyle = {
  fileName: string;
  dataUrl: string;
  palette: [string, string, string];
  background: string;
  warmth: number;
  brightness: number;
  contrast: number;
  saturation: number;
};

type WorkerResponse =
  | { type: "result"; result: OcctResult }
  | { type: "error"; message: string };

const qualitySettings: Record<
  QualityKey,
  {
    label: string;
    params: {
      linearUnit: "millimeter";
      linearDeflectionType: "bounding_box_ratio";
      linearDeflection: number;
      angularDeflection: number;
    };
  }
> = {
  fast: {
    label: "快速",
    params: {
      linearUnit: "millimeter",
      linearDeflectionType: "bounding_box_ratio",
      linearDeflection: 0.004,
      angularDeflection: 0.5,
    },
  },
  balanced: {
    label: "均衡",
    params: {
      linearUnit: "millimeter",
      linearDeflectionType: "bounding_box_ratio",
      linearDeflection: 0.0015,
      angularDeflection: 0.3,
    },
  },
  fine: {
    label: "精细",
    params: {
      linearUnit: "millimeter",
      linearDeflectionType: "bounding_box_ratio",
      linearDeflection: 0.0006,
      angularDeflection: 0.18,
    },
  },
};

const backgroundOptions = [
  { label: "浅灰", value: "#f4f7f8" },
  { label: "白色", value: "#ffffff" },
  { label: "墨色", value: "#15181d" },
];

const renderViews: Array<{
  key: RenderViewKey;
  label: string;
  direction: [number, number, number];
}> = [
  { key: "hero", label: "三分之四", direction: [1.15, -1.35, 0.82] },
  { key: "front", label: "正面", direction: [0.05, -1, 0.28] },
  { key: "top", label: "俯视", direction: [0.25, -0.32, 1] },
];

const renderEnvironments: Array<{
  key: RenderEnvironmentKey;
  label: string;
  background: string;
  ambient: string;
  ground: string;
  keyLight: string;
  fill: string;
  keyIntensity: number;
  fillIntensity: number;
  hemiIntensity: number;
  exposure: number;
}> = [
  {
    key: "soft-studio",
    label: "柔光棚拍",
    background: "#f4f7f8",
    ambient: "#ffffff",
    ground: "#93a0a5",
    keyLight: "#ffffff",
    fill: "#b9d9d0",
    keyIntensity: 2.8,
    fillIntensity: 1.3,
    hemiIntensity: 1.6,
    exposure: 1.05,
  },
  {
    key: "ecommerce-white",
    label: "白底电商",
    background: "#ffffff",
    ambient: "#ffffff",
    ground: "#d7dde0",
    keyLight: "#ffffff",
    fill: "#ffffff",
    keyIntensity: 3.2,
    fillIntensity: 1.8,
    hemiIntensity: 1.9,
    exposure: 1.12,
  },
  {
    key: "black-contrast",
    label: "黑底高反差",
    background: "#101316",
    ambient: "#48525c",
    ground: "#2f363a",
    keyLight: "#ffffff",
    fill: "#6ca3ff",
    keyIntensity: 4.2,
    fillIntensity: 0.9,
    hemiIntensity: 0.9,
    exposure: 0.95,
  },
  {
    key: "warm-showcase",
    label: "暖光展示",
    background: "#f4efe7",
    ambient: "#fff4df",
    ground: "#c7b9a6",
    keyLight: "#ffd9a6",
    fill: "#c9d8ff",
    keyIntensity: 3.3,
    fillIntensity: 0.9,
    hemiIntensity: 1.5,
    exposure: 1.06,
  },
  {
    key: "cool-tech",
    label: "冷调科技",
    background: "#edf4f8",
    ambient: "#eaf8ff",
    ground: "#9aaab5",
    keyLight: "#e9fbff",
    fill: "#8ab5ff",
    keyIntensity: 3.1,
    fillIntensity: 1.5,
    hemiIntensity: 1.4,
    exposure: 1.02,
  },
];

function getCmfTemplate(templateId: string | null) {
  if (!templateId) {
    return null;
  }
  return cmfTemplates.find((template) => template.id === templateId) ?? null;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/\.(step|stp)$/i, "")
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[index]}`;
}

function formatLength(value: number) {
  if (!Number.isFinite(value)) {
    return "0";
  }
  if (Math.abs(value) >= 1000) {
    return value.toFixed(0);
  }
  if (Math.abs(value) >= 10) {
    return value.toFixed(1);
  }
  return value.toFixed(2);
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
      child.geometry.dispose();
      const material = child.material;
      if (Array.isArray(material)) {
        material.forEach((entry) => entry.dispose());
      } else {
        material.dispose();
      }
    }
  });
}

function materialForColor(color: THREE.Color, mode: MaterialMode) {
  if (mode === "clay") {
    return new THREE.MeshStandardMaterial({
      color: "#d7ded8",
      metalness: 0.02,
      roughness: 0.64,
    });
  }

  if (mode === "studio") {
    return new THREE.MeshStandardMaterial({
      color: color.lerp(new THREE.Color("#f1f6f4"), 0.28),
      metalness: 0.08,
      roughness: 0.42,
    });
  }

  return new THREE.MeshStandardMaterial({
    color,
    metalness: 0.04,
    roughness: 0.48,
  });
}

function materialForCmfSlot(
  slot: CmfTemplate["slots"][CmfSlot],
  presetOverride?: string,
) {
  return createProductMaterial({
    ...slot,
    materialPresetId: presetOverride ?? slot.materialPresetId,
  });
}

function getMeshVolume(source: OcctMesh) {
  const positions = source.attributes.position.array;
  if (positions.length < 3) {
    return 0;
  }

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (let index = 0; index < positions.length; index += 3) {
    const x = positions[index];
    const y = positions[index + 1];
    const z = positions[index + 2];
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }

  return Math.max(maxX - minX, 0) * Math.max(maxY - minY, 0) * Math.max(maxZ - minZ, 0);
}

function classifyCmfSlots(result: OcctResult) {
  const meshVolumes = result.meshes.map((mesh, index) => ({
    index,
    name: mesh.name.toLowerCase(),
    volume: getMeshVolume(mesh),
  }));
  const largest = meshVolumes.reduce(
    (current, entry) => (entry.volume > current.volume ? entry : current),
    { index: 0, name: "", volume: 0 },
  );
  const singleMesh = meshVolumes.length <= 1;
  const accentNamePattern =
    /accent|badge|button|cap|dial|foot|key|knob|logo|ring|trim|脚|按键|按钮|旋钮|饰条|铭牌|脚垫|键帽/i;

  return new Map<number, CmfSlot>(
    meshVolumes.map((entry) => {
      if (singleMesh || entry.index === largest.index) {
        return [entry.index, "primary"];
      }
      if (
        accentNamePattern.test(entry.name) ||
        (largest.volume > 0 && entry.volume / largest.volume <= 0.08)
      ) {
        return [entry.index, "accent"];
      }
      return [entry.index, "secondary"];
    }),
  );
}

function makeMesh(
  source: OcctMesh,
  showEdges: boolean,
  mode: MaterialMode,
  cmfTemplate: CmfTemplate | null,
  cmfSlot: CmfSlot,
  materialOverrides: MaterialOverrides,
) {
  const geometry = new THREE.BufferGeometry();
  const index = Uint32Array.from(source.index.array);
  const sourceColor = source.color
    ? new THREE.Color(source.color[0], source.color[1], source.color[2])
    : new THREE.Color("#aeb8bf");

  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(source.attributes.position.array, 3),
  );

  if (source.attributes.normal) {
    geometry.setAttribute(
      "normal",
      new THREE.Float32BufferAttribute(source.attributes.normal.array, 3),
    );
  } else {
    geometry.computeVertexNormals();
  }

  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const baseMaterial = cmfTemplate
    ? materialForCmfSlot(cmfTemplate.slots[cmfSlot], materialOverrides[cmfSlot])
    : materialForColor(sourceColor, mode);
  const materials: THREE.Material[] = [baseMaterial];
  const materialKeys = new Map<string, number>();

  if (!cmfTemplate && mode === "source" && source.brep_faces?.length) {
    for (const face of source.brep_faces) {
      if (!Number.isFinite(face.first) || !Number.isFinite(face.last)) {
        continue;
      }

      let materialIndex = 0;
      if (face.color) {
        const key = face.color.map((entry) => entry.toFixed(4)).join(",");
        const existing = materialKeys.get(key);
        if (existing !== undefined) {
          materialIndex = existing;
        } else {
          const material = materialForColor(
            new THREE.Color(face.color[0], face.color[1], face.color[2]),
            mode,
          );
          materialIndex = materials.push(material) - 1;
          materialKeys.set(key, materialIndex);
        }
      }

      const first = Math.max(0, face.first);
      const last = Math.max(first, face.last);
      geometry.addGroup(first * 3, (last - first + 1) * 3, materialIndex);
    }
  }

  const mesh = new THREE.Mesh(
    geometry,
    materials.length > 1 ? materials : materials[0],
  );
  mesh.name = source.name || "STEP mesh";
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const group = new THREE.Group();
  group.add(mesh);

  if (showEdges) {
    const edgeGeometry = new THREE.EdgesGeometry(geometry, 28);
    const edges = new THREE.LineSegments(
      edgeGeometry,
      new THREE.LineBasicMaterial({
        color: cmfTemplate
          ? cmfTemplate.edgeColor
          : mode === "clay"
            ? "#63706c"
            : "#1f2933",
        transparent: true,
        opacity: 0.34,
      }),
    );
    edges.name = `${mesh.name} edges`;
    group.add(edges);
  }

  return group;
}

function buildGroup(
  result: OcctResult,
  showEdges: boolean,
  mode: MaterialMode,
  cmfTemplate: CmfTemplate | null,
  materialOverrides: MaterialOverrides,
) {
  const group = new THREE.Group();
  group.name = result.root?.name || "STEP model";
  const slotsByMesh = cmfTemplate ? classifyCmfSlots(result) : new Map<number, CmfSlot>();

  for (const [index, mesh] of result.meshes.entries()) {
    if (!mesh.attributes?.position?.array?.length || !mesh.index?.array?.length) {
      continue;
    }
    group.add(
      makeMesh(
        mesh,
        showEdges,
        mode,
        cmfTemplate,
        slotsByMesh.get(index) ?? "primary",
        materialOverrides,
      ),
    );
  }

  return group;
}

function getMetrics(
  file: File,
  result: OcctResult,
  group: THREE.Group,
  elapsedMs: number,
): Metrics {
  let vertices = 0;
  let triangles = 0;

  for (const mesh of result.meshes) {
    vertices += Math.floor((mesh.attributes.position.array.length || 0) / 3);
    triangles += Math.floor((mesh.index.array.length || 0) / 3);
  }

  const box = new THREE.Box3().setFromObject(group);
  const size = new THREE.Vector3();
  box.getSize(size);

  return {
    fileName: file.name,
    fileSize: formatBytes(file.size),
    meshes: result.meshes.length,
    vertices,
    triangles,
    bounds: `${formatLength(size.x)} x ${formatLength(size.y)} x ${formatLength(size.z)} mm`,
    parseTime: `${(elapsedMs / 1000).toFixed(2)} s`,
  };
}

const cmfSlotLabels: Record<CmfSlot, string> = {
  primary: "主体",
  secondary: "结构/软胶",
  accent: "点缀",
};

function getRenderEnvironment(key: RenderEnvironmentKey) {
  return (
    renderEnvironments.find((environment) => environment.key === key) ??
    renderEnvironments[0]
  );
}

function isImageFile(file: File) {
  return file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name);
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片载入失败"));
    image.src = src;
  });
}

function drawImageCover(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  width: number,
  height: number,
) {
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  context.drawImage(
    image,
    (width - drawWidth) / 2,
    (height - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );
}

function rgbToHex(red: number, green: number, blue: number) {
  return `#${[red, green, blue]
    .map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0"))
    .join("")}`;
}

function hexToRgb(hex: string) {
  const normalized = hex.replace("#", "");
  const value = Number.parseInt(normalized, 16);
  return {
    red: (value >> 16) & 255,
    green: (value >> 8) & 255,
    blue: value & 255,
  };
}

function mixHex(a: string, b: string, amount: number) {
  const first = hexToRgb(a);
  const second = hexToRgb(b);
  const mix = (from: number, to: number) => from + (to - from) * amount;
  return rgbToHex(
    mix(first.red, second.red),
    mix(first.green, second.green),
    mix(first.blue, second.blue),
  );
}

function colorDistance(a: string, b: string) {
  const first = hexToRgb(a);
  const second = hexToRgb(b);
  return Math.hypot(
    first.red - second.red,
    first.green - second.green,
    first.blue - second.blue,
  );
}

function getFallbackAccent(color: string) {
  const { red, green, blue } = hexToRgb(color);
  return rgbToHex(255 - red * 0.78, 255 - green * 0.78, 255 - blue * 0.78);
}

async function extractReferenceStyle(file: File): Promise<ReferenceStyle> {
  const dataUrl = await readFileAsDataUrl(file);
  const image = await loadImage(dataUrl);
  const size = 160;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("当前浏览器无法分析参考图");
  }

  drawImageCover(context, image, size, size);
  const pixels = context.getImageData(0, 0, size, size).data;
  const buckets = new Map<string, { count: number; red: number; green: number; blue: number }>();
  let redSum = 0;
  let greenSum = 0;
  let blueSum = 0;
  let luminanceSum = 0;
  let luminanceSquaredSum = 0;
  let saturationSum = 0;
  let count = 0;

  for (let index = 0; index < pixels.length; index += 16) {
    const alpha = pixels[index + 3];
    if (alpha < 24) {
      continue;
    }
    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
    const saturation = max === 0 ? 0 : (max - min) / max;
    const bucketRed = Math.round(red / 32) * 32;
    const bucketGreen = Math.round(green / 32) * 32;
    const bucketBlue = Math.round(blue / 32) * 32;
    const bucketKey = `${bucketRed},${bucketGreen},${bucketBlue}`;
    const bucket = buckets.get(bucketKey);

    if (bucket) {
      bucket.count += 1;
      bucket.red += red;
      bucket.green += green;
      bucket.blue += blue;
    } else {
      buckets.set(bucketKey, {
        count: 1,
        red,
        green,
        blue,
      });
    }

    redSum += red;
    greenSum += green;
    blueSum += blue;
    luminanceSum += luminance;
    luminanceSquaredSum += luminance * luminance;
    saturationSum += saturation;
    count += 1;
  }

  if (count === 0) {
    throw new Error("参考图没有可分析的像素");
  }

  const average = rgbToHex(redSum / count, greenSum / count, blueSum / count);
  const palette = Array.from(buckets.values())
    .sort((a, b) => b.count - a.count)
    .map((bucket) =>
      rgbToHex(
        bucket.red / bucket.count,
        bucket.green / bucket.count,
        bucket.blue / bucket.count,
      ),
    )
    .reduce<string[]>((current, color) => {
      if (current.every((entry) => colorDistance(entry, color) > 42)) {
        current.push(color);
      }
      return current;
    }, []);

  while (palette.length < 3) {
    palette.push(
      palette.length === 0
        ? average
        : palette.length === 1
          ? mixHex(average, "#f2f5f4", 0.55)
          : getFallbackAccent(average),
    );
  }

  const brightness = luminanceSum / count;
  const contrast = Math.sqrt(
    Math.max(0, luminanceSquaredSum / count - brightness * brightness),
  );
  const saturation = saturationSum / count;
  const warmth =
    ((redSum / count) - (blueSum / count)) / 255;
  const background =
    brightness < 0.42
      ? mixHex(palette[0], "#11161a", 0.74)
      : mixHex(palette[0], "#f5f7f4", 0.76);

  return {
    fileName: file.name,
    dataUrl,
    palette: [palette[0], palette[1], palette[2]],
    background,
    warmth,
    brightness,
    contrast,
    saturation,
  };
}

function makeReferenceTemplate(style: ReferenceStyle): CmfTemplate {
  const primaryPreset =
    style.saturation < 0.18 && style.brightness > 0.58
      ? "sandblasted-anodized-aluminum"
      : style.contrast > 0.25
        ? "powder-coated-aluminum"
        : "fine-texture-plastic";
  const accentPreset =
    style.saturation > 0.36 ? "gloss-plastic" : "sandblasted-anodized-aluminum";

  return {
    id: "reference-style",
    name: "参考图风格",
    shortName: "参考",
    category: "reference",
    background: style.background,
    edgeColor: style.brightness < 0.45 ? "#d5dde1" : "#223039",
    slots: {
      primary: {
        color: style.palette[0],
        label: "主色",
        material: primaryPreset.includes("aluminum") ? "metal" : "plastic",
        finish: getMaterialPreset(primaryPreset).name,
        roughness: 0.64,
        metalness: primaryPreset.includes("aluminum") ? 0.58 : 0.03,
        materialPresetId: primaryPreset,
      },
      secondary: {
        color: style.palette[1],
        label: "辅色",
        material: style.brightness < 0.38 ? "rubber" : "plastic",
        finish: style.brightness < 0.38 ? "低反射软触" : "哑面塑胶",
        roughness: style.brightness < 0.38 ? 0.9 : 0.72,
        metalness: 0.01,
        materialPresetId: style.brightness < 0.38 ? "soft-touch-rubber" : "matte-plastic",
      },
      accent: {
        color: style.palette[2],
        label: "强调色",
        material: accentPreset.includes("aluminum") ? "metal" : "plastic",
        finish: getMaterialPreset(accentPreset).name,
        roughness: accentPreset.includes("aluminum") ? 0.34 : 0.26,
        metalness: accentPreset.includes("aluminum") ? 0.68 : 0.02,
        clearcoat: accentPreset.includes("aluminum") ? 0.16 : 0.58,
        materialPresetId: accentPreset,
      },
    },
  };
}

async function compositeReferenceRender(modelDataUrl: string, style: ReferenceStyle) {
  const [modelImage, referenceImage] = await Promise.all([
    loadImage(modelDataUrl),
    loadImage(style.dataUrl),
  ]);
  const width = modelImage.naturalWidth;
  const height = modelImage.naturalHeight;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("无法合成参考图渲染");
  }

  context.fillStyle = style.background;
  context.fillRect(0, 0, width, height);
  context.save();
  context.filter = `blur(28px) saturate(${1 + style.saturation * 0.8})`;
  context.globalAlpha = 0.72;
  drawImageCover(context, referenceImage, width, height);
  context.restore();

  const linearGradient = context.createLinearGradient(0, 0, width, height);
  linearGradient.addColorStop(0, `${style.palette[0]}d9`);
  linearGradient.addColorStop(0.56, `${style.background}cc`);
  linearGradient.addColorStop(1, `${style.palette[2]}aa`);
  context.globalCompositeOperation = "source-over";
  context.fillStyle = linearGradient;
  context.globalAlpha = 0.38;
  context.fillRect(0, 0, width, height);

  const radialGradient = context.createRadialGradient(
    width * 0.48,
    height * 0.36,
    width * 0.05,
    width * 0.5,
    height * 0.52,
    width * 0.68,
  );
  radialGradient.addColorStop(0, "rgba(255,255,255,0.62)");
  radialGradient.addColorStop(0.56, "rgba(255,255,255,0.12)");
  radialGradient.addColorStop(1, "rgba(0,0,0,0.18)");
  context.fillStyle = radialGradient;
  context.globalAlpha = style.brightness > 0.5 ? 0.76 : 0.56;
  context.fillRect(0, 0, width, height);

  context.globalAlpha = 1;
  context.shadowColor = "rgba(0,0,0,0.28)";
  context.shadowBlur = Math.round(width * 0.024);
  context.shadowOffsetY = Math.round(height * 0.018);
  context.drawImage(modelImage, 0, 0, width, height);
  context.shadowColor = "transparent";

  const vignette = context.createRadialGradient(
    width * 0.5,
    height * 0.48,
    width * 0.22,
    width * 0.5,
    height * 0.5,
    width * 0.74,
  );
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.24)");
  context.fillStyle = vignette;
  context.fillRect(0, 0, width, height);

  return canvas.toDataURL("image/png");
}

export default function StepRenderer() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const referenceInputRef = useRef<HTMLInputElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const modelRef = useRef<THREE.Group | null>(null);
  const hemiLightRef = useRef<THREE.HemisphereLight | null>(null);
  const keyLightRef = useRef<THREE.DirectionalLight | null>(null);
  const fillLightRef = useRef<THREE.DirectionalLight | null>(null);
  const gridRef = useRef<THREE.GridHelper | null>(null);
  const modelBoxRef = useRef<THREE.Box3 | null>(null);
  const lastResultRef = useRef<OcctResult | null>(null);
  const lastFileRef = useRef<File | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const parseStartRef = useRef(0);
  const lastElapsedRef = useRef(0);
  const animationRef = useRef<number | null>(null);
  const autoRotateRef = useRef(false);

  const [phase, setPhase] = useState<Phase>("empty");
  const [quality, setQuality] = useState<QualityKey>("balanced");
  const [materialMode, setMaterialMode] = useState<MaterialMode>("source");
  const [activeCmfId, setActiveCmfId] = useState<string | null>(null);
  const [activeEnvironment, setActiveEnvironment] =
    useState<RenderEnvironmentKey>("soft-studio");
  const [selectedMaterialSlot, setSelectedMaterialSlot] =
    useState<CmfSlot>("primary");
  const [materialOverrides, setMaterialOverrides] = useState<MaterialOverrides>({});
  const [showEdges, setShowEdges] = useState(true);
  const [autoRotate, setAutoRotate] = useState(false);
  const [background, setBackground] = useState(backgroundOptions[0].value);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [status, setStatus] = useState("等待 STEP 或 STP 文件");
  const [isDragging, setIsDragging] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isReferenceGenerating, setIsReferenceGenerating] = useState(false);
  const [referenceStyle, setReferenceStyle] = useState<ReferenceStyle | null>(null);
  const [renderImages, setRenderImages] = useState<RenderImage[]>([]);

  const resizeRenderer = useCallback(() => {
    const mount = mountRef.current;
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    if (!mount || !renderer || !camera) {
      return;
    }

    const rect = mount.getBoundingClientRect();
    const width = Math.min(
      4096,
      Math.max(1, Math.floor(rect.width || mount.clientWidth)),
    );
    const height = Math.min(
      4096,
      Math.max(1, Math.floor(rect.height || mount.clientHeight)),
    );
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }, []);

  const applyEnvironmentToScene = useCallback((environmentKey: RenderEnvironmentKey) => {
    const scene = sceneRef.current;
    const renderer = rendererRef.current;
    const hemiLight = hemiLightRef.current;
    const keyLight = keyLightRef.current;
    const fillLight = fillLightRef.current;
    const environment = getRenderEnvironment(environmentKey);

    if (scene) {
      scene.background = new THREE.Color(environment.background);
    }
    if (renderer) {
      renderer.setClearColor(environment.background);
      renderer.toneMappingExposure = environment.exposure;
    }
    if (hemiLight) {
      hemiLight.color.set(environment.ambient);
      hemiLight.groundColor.set(environment.ground);
      hemiLight.intensity = environment.hemiIntensity;
    }
    if (keyLight) {
      keyLight.color.set(environment.keyLight);
      keyLight.intensity = environment.keyIntensity;
    }
    if (fillLight) {
      fillLight.color.set(environment.fill);
      fillLight.intensity = environment.fillIntensity;
    }
  }, []);

  const frameModel = useCallback((directionTuple: [number, number, number]) => {
    const group = modelRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!group || !camera || !controls) {
      return;
    }

    resizeRenderer();
    const box = modelBoxRef.current ?? new THREE.Box3().setFromObject(group);
    if (box.isEmpty()) {
      return;
    }
    const center = new THREE.Vector3();
    const sphere = new THREE.Sphere();
    box.getBoundingSphere(sphere);
    center.copy(sphere.center);

    const radius = Math.max(sphere.radius, 1);
    const verticalFov = THREE.MathUtils.degToRad(camera.fov);
    const horizontalFov =
      2 * Math.atan(Math.tan(verticalFov / 2) * Math.max(camera.aspect, 0.01));
    const fitFov = Math.max(Math.min(verticalFov, horizontalFov), 0.1);
    const distance = (radius / Math.sin(fitFov / 2)) * 1.18;
    const direction = new THREE.Vector3(...directionTuple).normalize();

    camera.position.copy(center).add(direction.multiplyScalar(distance));
    camera.near = Math.max(radius / 1000, 0.001);
    camera.far = Math.max(distance + radius * 12, 1000);
    camera.updateProjectionMatrix();

    controls.target.copy(center);
    controls.minDistance = radius * 0.08;
    controls.maxDistance = radius * 28;
    controls.update();
  }, [resizeRenderer]);

  const focusModel = useCallback(() => {
    frameModel(renderViews[0].direction);
  }, [frameModel]);

  const replaceModel = useCallback(
    (
      result: OcctResult,
      file: File,
      elapsedMs: number,
      templateOverride?: CmfTemplate | null,
    ) => {
      const scene = sceneRef.current;
      if (!scene) {
        return;
      }

      if (modelRef.current) {
        scene.remove(modelRef.current);
        disposeObject(modelRef.current);
      }

      const cmfTemplate =
        templateOverride === undefined
          ? getCmfTemplate(activeCmfId)
          : templateOverride;
      const group = buildGroup(
        result,
        showEdges,
        materialMode,
        cmfTemplate,
        materialOverrides,
      );
      const sourceBox = new THREE.Box3().setFromObject(group);
      const sourceCenter = new THREE.Vector3();
      sourceBox.getCenter(sourceCenter);
      group.position.sub(sourceCenter);
      group.updateMatrixWorld(true);

      const normalizedBox = new THREE.Box3().setFromObject(group);
      const normalizedSize = new THREE.Vector3();
      normalizedBox.getSize(normalizedSize);
      modelBoxRef.current = normalizedBox.clone();

      const grid = gridRef.current;
      if (grid) {
        const maxDimension = Math.max(
          normalizedSize.x,
          normalizedSize.y,
          normalizedSize.z,
          1,
        );
        grid.scale.setScalar(Math.max(maxDimension / 9, 0.4));
        grid.position.z = normalizedBox.min.z - Math.max(maxDimension * 0.012, 0.004);
      }

      scene.add(group);
      modelRef.current = group;
      lastResultRef.current = result;
      lastFileRef.current = file;
      lastElapsedRef.current = elapsedMs;
      focusModel();
      setMetrics(getMetrics(file, result, group, elapsedMs));
      setPhase("ready");
      setStatus(cmfTemplate ? `已应用 ${cmfTemplate.name}` : "渲染完成");
    },
    [activeCmfId, focusModel, materialMode, materialOverrides, showEdges],
  );

  const parseFile = useCallback(
    async (file: File) => {
      const name = file.name.toLowerCase();
      if (!name.endsWith(".step") && !name.endsWith(".stp")) {
        setPhase("error");
        setStatus("仅支持 .step 或 .stp 文件");
        return;
      }

      workerRef.current?.terminate();
      setPhase("loading");
      setStatus("正在解析 STEP 几何");
      setMetrics(null);
      parseStartRef.current = performance.now();

      try {
        const buffer = await file.arrayBuffer();
        const worker = new Worker("/step-worker.js");
        workerRef.current = worker;

        worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
          worker.terminate();
          if (workerRef.current === worker) {
            workerRef.current = null;
          }

          const elapsed = performance.now() - parseStartRef.current;
          if (event.data.type === "error") {
            setPhase("error");
            setStatus(event.data.message);
            return;
          }

          replaceModel(event.data.result, file, elapsed);
        };

        worker.onerror = (event) => {
          worker.terminate();
          if (workerRef.current === worker) {
            workerRef.current = null;
          }
          setPhase("error");
          setStatus(event.message || "解析进程出错");
        };

        worker.postMessage(
          {
            buffer,
            params: qualitySettings[quality].params,
          },
          [buffer],
        );
      } catch (error) {
        setPhase("error");
        setStatus(error instanceof Error ? error.message : String(error));
      }
    },
    [quality, replaceModel],
  );

  const loadSample = useCallback(async () => {
    setStatus("正在载入示例 STEP");
    const response = await fetch("/samples/cube.step");
    const blob = await response.blob();
    const file = new File([blob], "demo-rounded-cube.step", {
      type: "application/step",
    });
    await parseFile(file);
  }, [parseFile]);

  const processReferenceFile = useCallback(async (file: File) => {
    if (!isImageFile(file)) {
      setStatus("参考图仅支持图片文件");
      return;
    }

    try {
      setStatus("正在分析参考图风格");
      const style = await extractReferenceStyle(file);
      setReferenceStyle(style);
      setBackground(style.background);
      setActiveEnvironment(
        style.brightness < 0.38
          ? "black-contrast"
          : style.warmth > 0.08
            ? "warm-showcase"
            : style.contrast > 0.24
              ? "cool-tech"
              : "soft-studio",
      );
      setStatus(`已读取参考图：${file.name}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "参考图分析失败");
    }
  }, []);

  const handleInputFile = useCallback(
    (file: File) => {
      if (isImageFile(file)) {
        void processReferenceFile(file);
        return;
      }
      void parseFile(file);
    },
    [parseFile, processReferenceFile],
  );

  const downloadPng = useCallback(() => {
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (!renderer || !scene || !camera || !metrics) {
      return;
    }

    renderer.render(scene, camera);
    const anchor = document.createElement("a");
    const fileStem = metrics.fileName.replace(/\.(step|stp)$/i, "");
    anchor.download = `${fileStem || "step-render"}.png`;
    anchor.href = renderer.domElement.toDataURL("image/png");
    anchor.click();
  }, [metrics]);

  const captureCanvasDataUrl = useCallback(
    (view: (typeof renderViews)[number], backgroundColor: string | null) => {
      const renderer = rendererRef.current;
      const scene = sceneRef.current;
      const camera = cameraRef.current;
      if (!renderer || !scene || !camera) {
        return null;
      }

      const previousBackground = scene.background;
      const previousClearColor = new THREE.Color();
      renderer.getClearColor(previousClearColor);
      const previousClearAlpha = renderer.getClearAlpha();
      const grid = gridRef.current;
      const previousGridVisible = grid?.visible ?? true;

      frameModel(view.direction);
      if (backgroundColor === null) {
        scene.background = null;
        renderer.setClearColor(0x000000, 0);
        if (grid) {
          grid.visible = false;
        }
      } else {
        scene.background = new THREE.Color(backgroundColor);
        renderer.setClearColor(backgroundColor, 1);
      }
      renderer.render(scene, camera);
      const dataUrl = renderer.domElement.toDataURL("image/png");

      scene.background = previousBackground;
      renderer.setClearColor(previousClearColor, previousClearAlpha);
      if (grid) {
        grid.visible = previousGridVisible;
      }
      return dataUrl;
    },
    [frameModel],
  );

  const captureCurrentCanvas = useCallback(
    (template: CmfTemplate, view: (typeof renderViews)[number]) => {
      const file = lastFileRef.current;
      if (!file) {
        return null;
      }

      const dataUrl = captureCanvasDataUrl(view, template.background);
      if (!dataUrl) {
        return null;
      }

      const fileStem = slugify(file.name) || "step-render";
      const fileName = `${fileStem}-${slugify(template.shortName)}-${view.key}.png`;

      return {
        id: `${template.id}-${view.key}-${Date.now()}`,
        templateId: template.id,
        templateName: template.name,
        viewKey: view.key,
        viewLabel: view.label,
        fileName,
        dataUrl,
      } satisfies RenderImage;
    },
    [captureCanvasDataUrl],
  );

  const generateReferenceRenders = useCallback(async () => {
    const result = lastResultRef.current;
    const file = lastFileRef.current;
    const style = referenceStyle;
    if (!result || !file) {
      setPhase("error");
      setStatus("请先载入 STEP 文件");
      return;
    }
    if (!style) {
      setStatus("请先拖入参考图");
      return;
    }

    setIsReferenceGenerating(true);
    try {
      const template = makeReferenceTemplate(style);
      const environmentKey =
        style.brightness < 0.38
          ? "black-contrast"
          : style.warmth > 0.08
            ? "warm-showcase"
            : style.contrast > 0.24
              ? "cool-tech"
              : "soft-studio";
      setActiveEnvironment(environmentKey);
      applyEnvironmentToScene(environmentKey);
      setBackground(style.background);
      setStatus("正在生成参考图风格渲染");
      replaceModel(result, file, lastElapsedRef.current, template);
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

      const fileStem = slugify(file.name) || "step-render";
      const stamp = Date.now();
      const captures: RenderImage[] = [];
      for (const view of renderViews) {
        const modelDataUrl = captureCanvasDataUrl(view, null);
        if (!modelDataUrl) {
          continue;
        }
        const dataUrl = await compositeReferenceRender(modelDataUrl, style);
        captures.push({
          id: `reference-${view.key}-${stamp}`,
          templateId: "reference-style",
          templateName: "参考图风格",
          viewKey: view.key,
          viewLabel: view.label,
          fileName: `${fileStem}-reference-${view.key}.png`,
          dataUrl,
        });
      }

      setRenderImages((current) => [
        ...captures,
        ...current.filter((image) => image.templateId !== "reference-style"),
      ]);
      setStatus(`已生成参考图风格 ${captures.length} 张图`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "参考图渲染失败");
    } finally {
      setIsReferenceGenerating(false);
    }
  }, [
    applyEnvironmentToScene,
    captureCanvasDataUrl,
    referenceStyle,
    replaceModel,
  ]);

  const applyCmfTemplate = useCallback((template: CmfTemplate) => {
    if (!lastResultRef.current) {
      setPhase("error");
      setStatus("请先载入 STEP 文件");
      return;
    }

    setActiveCmfId(template.id);
    setMaterialOverrides({});
    setBackground(template.background);
    setStatus(`已应用 ${template.name}`);
  }, []);

  const generateTemplateRenders = useCallback(
    async (template: CmfTemplate) => {
      const result = lastResultRef.current;
      const file = lastFileRef.current;
      if (!result || !file) {
        setPhase("error");
        setStatus("请先载入 STEP 文件");
        return;
      }

      setIsGenerating(true);
      setActiveCmfId(template.id);
      setBackground(template.background);
      setStatus(`正在生成 ${template.name}`);
      replaceModel(result, file, lastElapsedRef.current, template);
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

      const captures = renderViews
        .map((view) => captureCurrentCanvas(template, view))
        .filter((image): image is RenderImage => image !== null);

      setRenderImages((current) => [
        ...captures,
        ...current.filter((image) => image.templateId !== template.id),
      ]);
      setStatus(`已生成 ${template.name} ${captures.length} 张图`);
      setIsGenerating(false);
    },
    [captureCurrentCanvas, replaceModel],
  );

  const generateAllCmfRenders = useCallback(async () => {
    const result = lastResultRef.current;
    const file = lastFileRef.current;
    if (!result || !file) {
      setPhase("error");
      setStatus("请先载入 STEP 文件");
      return;
    }

    setIsGenerating(true);
    const captures: RenderImage[] = [];

    for (const [index, template] of cmfTemplates.entries()) {
      setActiveCmfId(template.id);
      setBackground(template.background);
      setStatus(`正在生成 ${index + 1}/${cmfTemplates.length}: ${template.name}`);
      replaceModel(result, file, lastElapsedRef.current, template);
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
      for (const view of renderViews) {
        const image = captureCurrentCanvas(template, view);
        if (image) {
          captures.push(image);
        }
      }
    }

    setRenderImages(captures);
    setIsGenerating(false);
    setStatus(`已生成 ${captures.length} 张 CMF 渲染图`);
  }, [captureCurrentCanvas, replaceModel]);

  const downloadRenderImage = useCallback((image: RenderImage) => {
    const anchor = document.createElement("a");
    anchor.download = image.fileName;
    anchor.href = image.dataUrl;
    anchor.click();
  }, []);

  const downloadRenderZip = useCallback(async () => {
    if (!renderImages.length) {
      return;
    }

    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();
    for (const image of renderImages) {
      const blob = await (await fetch(image.dataUrl)).blob();
      zip.file(image.fileName, blob);
    }
    const zipBlob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(zipBlob);
    const anchor = document.createElement("a");
    anchor.download = `${slugify(metrics?.fileName ?? "step-render")}-cmf-renders.zip`;
    anchor.href = url;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [metrics?.fileName, renderImages]);

  const rebuildCurrentModel = useCallback(() => {
    const result = lastResultRef.current;
    const file = lastFileRef.current;
    if (!result || !file) {
      return;
    }
    replaceModel(result, file, lastElapsedRef.current);
  }, [replaceModel]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) {
      return;
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(backgroundOptions[0].value);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 100000);
    camera.up.set(0, 0, 1);
    camera.position.set(8, -10, 7);
    cameraRef.current = camera;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        preserveDrawingBuffer: true,
        alpha: true,
      });
    } catch {
      window.setTimeout(() => {
        setPhase("error");
        setStatus("当前浏览器无法创建 WebGL 渲染环境");
      }, 0);
      return () => {
        sceneRef.current = null;
        cameraRef.current = null;
      };
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    rendererRef.current = renderer;
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = true;
    controls.autoRotateSpeed = 0.7;
    controlsRef.current = controls;

    const ambient = new THREE.HemisphereLight("#ffffff", "#8d999f", 1.6);
    scene.add(ambient);
    hemiLightRef.current = ambient;

    const keyLight = new THREE.DirectionalLight("#ffffff", 2.8);
    keyLight.position.set(6, -8, 9);
    keyLight.castShadow = true;
    scene.add(keyLight);
    keyLightRef.current = keyLight;

    const fillLight = new THREE.DirectionalLight("#b9d9d0", 1.3);
    fillLight.position.set(-6, 5, 4);
    scene.add(fillLight);
    fillLightRef.current = fillLight;

    const grid = new THREE.GridHelper(12, 12, "#91a1a9", "#d1d8dc");
    grid.rotation.x = Math.PI / 2;
    grid.position.z = -0.002;
    scene.add(grid);
    gridRef.current = grid;
    applyEnvironmentToScene("soft-studio");

    const resizeObserver = new ResizeObserver(resizeRenderer);
    resizeObserver.observe(mount);
    resizeRenderer();

    const animate = () => {
      controls.autoRotate = autoRotateRef.current;
      controls.update();
      renderer.render(scene, camera);
      animationRef.current = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      resizeObserver.disconnect();
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
      }
      workerRef.current?.terminate();
      controls.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
      if (modelRef.current) {
        disposeObject(modelRef.current);
      }
      rendererRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
      modelRef.current = null;
      hemiLightRef.current = null;
      keyLightRef.current = null;
      fillLightRef.current = null;
      gridRef.current = null;
      modelBoxRef.current = null;
    };
  }, [applyEnvironmentToScene, resizeRenderer]);

  useEffect(() => {
    autoRotateRef.current = autoRotate;
  }, [autoRotate]);

  useEffect(() => {
    applyEnvironmentToScene(activeEnvironment);
  }, [activeEnvironment, applyEnvironmentToScene]);

  useEffect(() => {
    const scene = sceneRef.current;
    const renderer = rendererRef.current;
    if (!scene || !renderer) {
      return;
    }
    const color = new THREE.Color(background);
    scene.background = color;
    renderer.setClearColor(color);
  }, [background]);

  useEffect(() => {
    rebuildCurrentModel();
  }, [activeCmfId, materialMode, showEdges, rebuildCurrentModel]);

  const activeCmfTemplate = getCmfTemplate(activeCmfId);
  const activeEnvironmentConfig = getRenderEnvironment(activeEnvironment);
  const activeSlotPresetId =
    materialOverrides[selectedMaterialSlot] ??
    activeCmfTemplate?.slots[selectedMaterialSlot]?.materialPresetId;
  const generationBusy = isGenerating || isReferenceGenerating;

  return (
    <main
      className="flex min-h-screen flex-col bg-[#eef2f3] text-[#172026] lg:h-[100dvh] lg:min-h-0 lg:flex-row lg:overflow-hidden"
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) {
          setIsDragging(false);
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        setIsDragging(false);
        const file = event.dataTransfer.files[0];
        if (file) {
          handleInputFile(file);
        }
      }}
    >
      <aside className="flex w-full shrink-0 flex-col border-b border-[#d3dcdf] bg-white lg:h-full lg:w-[340px] lg:border-b-0 lg:border-r">
        <div className="border-b border-[#dfe6e8] px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-lg bg-[#244f57] text-white">
              <Box size={19} aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-lg font-semibold">STEP 渲染器</h1>
              <p className="text-sm text-[#66747b]">STP / STEP to PNG</p>
            </div>
          </div>
        </div>

        <div className="grid gap-4 overflow-y-auto px-4 py-4 sm:grid-cols-2 lg:flex lg:flex-1 lg:flex-col">
          <section className="rounded-lg border border-[#d8e1e4] bg-[#f9fbfb] p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <FileUp size={16} aria-hidden="true" />
              文件
            </div>
            <input
              ref={inputRef}
              className="hidden"
              type="file"
              accept=".stp,.step"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  void parseFile(file);
                }
              }}
            />
            <button
              className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#244f57] px-3 text-sm font-semibold text-white transition hover:bg-[#1d444b]"
              type="button"
              onClick={() => inputRef.current?.click()}
            >
              <FileUp size={17} aria-hidden="true" />
              选择 STEP 文件
            </button>
            <button
              className="mt-2 flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-[#c8d4d8] bg-white px-3 text-sm font-semibold text-[#243238] transition hover:bg-[#edf4f4]"
              type="button"
              onClick={() => void loadSample()}
            >
              <Sparkles size={16} aria-hidden="true" />
              载入示例
            </button>
            <div className="mt-3 rounded-lg border border-dashed border-[#b8c6ca] bg-white px-3 py-4 text-center text-sm text-[#66747b]">
              拖放 STEP / STP
            </div>
          </section>

          <section className="rounded-lg border border-[#d8e1e4] bg-[#f9fbfb] p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <SlidersHorizontal size={16} aria-hidden="true" />
              参数
            </div>
            <label className="text-xs font-semibold uppercase text-[#66747b]">
              渲染质量
            </label>
            <div className="mt-2 grid grid-cols-3 rounded-lg border border-[#cbd8dc] bg-white p-1">
              {(Object.keys(qualitySettings) as QualityKey[]).map((key) => (
                <button
                  key={key}
                  className={`h-9 rounded-md text-sm font-semibold transition ${
                    quality === key
                      ? "bg-[#244f57] text-white"
                      : "text-[#59686f] hover:bg-[#edf4f4]"
                  }`}
                  type="button"
                  onClick={() => setQuality(key)}
                >
                  {qualitySettings[key].label}
                </button>
              ))}
            </div>

            <label className="mt-4 block text-xs font-semibold uppercase text-[#66747b]">
              材质
            </label>
            <div className="mt-2 grid grid-cols-3 rounded-lg border border-[#cbd8dc] bg-white p-1">
              {[
                ["source", "原色"],
                ["studio", "棚拍"],
                ["clay", "素模"],
              ].map(([key, label]) => (
                <button
                  key={key}
                  className={`h-9 rounded-md text-sm font-semibold transition ${
                    materialMode === key
                      ? "bg-[#244f57] text-white"
                      : "text-[#59686f] hover:bg-[#edf4f4]"
                  }`}
                  type="button"
                  onClick={() => {
                    setActiveCmfId(null);
                    setMaterialMode(key as MaterialMode);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <label className="flex h-10 items-center gap-2 rounded-lg border border-[#cbd8dc] bg-white px-3 text-sm font-semibold">
                <input
                  checked={showEdges}
                  className="size-4 accent-[#244f57]"
                  type="checkbox"
                  onChange={(event) => setShowEdges(event.target.checked)}
                />
                边线
              </label>
              <label className="flex h-10 items-center gap-2 rounded-lg border border-[#cbd8dc] bg-white px-3 text-sm font-semibold">
                <input
                  checked={autoRotate}
                  className="size-4 accent-[#244f57]"
                  type="checkbox"
                  onChange={(event) => setAutoRotate(event.target.checked)}
                />
                旋转
              </label>
            </div>
          </section>

          <section className="rounded-lg border border-[#d8e1e4] bg-[#f9fbfb] p-4 sm:col-span-2 lg:col-span-1">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Palette size={16} aria-hidden="true" />
                CMF
              </div>
              <button
                className="flex h-8 items-center gap-1 rounded-lg border border-[#cbd8dc] bg-white px-2 text-xs font-semibold text-[#243238] transition hover:bg-[#edf4f4] disabled:cursor-not-allowed disabled:opacity-45"
                type="button"
                disabled={phase !== "ready" || generationBusy}
                onClick={() => void generateAllCmfRenders()}
              >
                {isGenerating ? (
                  <LoaderCircle className="animate-spin" size={14} />
                ) : (
                  <ImageDown size={14} />
                )}
                生成全部
              </button>
            </div>

            <div className="grid gap-2">
              {cmfTemplates.map((template) => (
                <div
                  key={template.id}
                  className={`grid grid-cols-[1fr_42px] gap-2 rounded-lg border bg-white p-2 transition ${
                    activeCmfId === template.id
                      ? "border-[#244f57] ring-2 ring-[#d7e8e6]"
                      : "border-[#cbd8dc]"
                  }`}
                >
                  <button
                    className="flex min-w-0 items-center gap-3 text-left disabled:cursor-not-allowed disabled:opacity-45"
                    type="button"
                    disabled={phase !== "ready" || generationBusy}
                    onClick={() => applyCmfTemplate(template)}
                  >
                    <span className="flex shrink-0 overflow-hidden rounded-md border border-black/10">
                      {(["primary", "secondary", "accent"] as CmfSlot[]).map(
                        (slot) => (
                          <span
                            key={slot}
                            className="h-8 w-5"
                            style={{
                              backgroundColor: template.slots[slot].color,
                            }}
                          />
                        ),
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">
                        {template.name}
                      </span>
                      <span className="block truncate text-xs text-[#66747b]">
                        {template.slots.primary.finish}
                      </span>
                    </span>
                  </button>
                  <button
                    className="grid size-10 place-items-center rounded-lg border border-[#cbd8dc] bg-[#f7faf9] text-[#243238] transition hover:bg-[#edf4f4] disabled:cursor-not-allowed disabled:opacity-45"
                    type="button"
                    title={`生成 ${template.name}`}
                    disabled={phase !== "ready" || generationBusy}
                    onClick={() => void generateTemplateRenders(template)}
                  >
                    {isGenerating && activeCmfId === template.id ? (
                      <LoaderCircle className="animate-spin" size={16} />
                    ) : (
                      <ImageDown size={16} />
                    )}
                  </button>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-[#d8e1e4] bg-[#f9fbfb] p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Layers size={16} aria-hidden="true" />
              材质库
            </div>
            <div className="grid grid-cols-3 rounded-lg border border-[#cbd8dc] bg-white p-1">
              {(["primary", "secondary", "accent"] as CmfSlot[]).map((slot) => (
                <button
                  key={slot}
                  className={`h-9 rounded-md text-sm font-semibold transition ${
                    selectedMaterialSlot === slot
                      ? "bg-[#244f57] text-white"
                      : "text-[#59686f] hover:bg-[#edf4f4]"
                  }`}
                  type="button"
                  onClick={() => setSelectedMaterialSlot(slot)}
                >
                  {cmfSlotLabels[slot]}
                </button>
              ))}
            </div>

            <div className="mt-3 grid gap-2">
              {materialPresets.map((preset) => (
                <button
                  key={preset.id}
                  className={`rounded-lg border bg-white p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-45 ${
                    activeSlotPresetId === preset.id
                      ? "border-[#244f57] ring-2 ring-[#d7e8e6]"
                      : "border-[#cbd8dc] hover:bg-[#edf4f4]"
                  }`}
                  type="button"
                  disabled={phase !== "ready"}
                  onClick={() => {
                    if (!activeCmfId) {
                      setActiveCmfId(cmfTemplates[0].id);
                      setBackground(cmfTemplates[0].background);
                    }
                    setMaterialOverrides((current) => ({
                      ...current,
                      [selectedMaterialSlot]: preset.id,
                    }));
                    setStatus(`${cmfSlotLabels[selectedMaterialSlot]}：${preset.name}`);
                  }}
                >
                  <span className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold">{preset.name}</span>
                    <span className="rounded-md bg-[#eef2f3] px-2 py-0.5 text-xs font-semibold text-[#59686f]">
                      {preset.category}
                    </span>
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-[#66747b]">
                    {preset.description}
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-[#d8e1e4] bg-[#f9fbfb] p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <SlidersHorizontal size={16} aria-hidden="true" />
              环境
            </div>
            <div className="grid gap-2">
              {renderEnvironments.map((environment) => (
                <button
                  key={environment.key}
                  className={`flex h-10 items-center justify-between rounded-lg border px-3 text-sm font-semibold transition ${
                    activeEnvironment === environment.key
                      ? "border-[#244f57] bg-[#e4f0ee] text-[#20363b]"
                      : "border-[#cbd8dc] bg-white text-[#59686f] hover:bg-[#edf4f4]"
                  }`}
                  type="button"
                  onClick={() => {
                    setActiveEnvironment(environment.key);
                    setBackground(environment.background);
                  }}
                >
                  {environment.label}
                  <span
                    className="size-4 rounded-full border border-black/10"
                    style={{ backgroundColor: environment.background }}
                  />
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-[#d8e1e4] bg-[#f9fbfb] p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Palette size={16} aria-hidden="true" />
              背景
            </div>
            <div className="grid grid-cols-3 gap-2">
              {backgroundOptions.map((option) => (
                <button
                  key={option.value}
                  className={`flex h-10 items-center justify-center rounded-lg border text-sm font-semibold transition ${
                    background === option.value
                      ? "border-[#244f57] bg-[#e4f0ee] text-[#20363b]"
                      : "border-[#cbd8dc] bg-white text-[#59686f] hover:bg-[#edf4f4]"
                  }`}
                  type="button"
                  onClick={() => setBackground(option.value)}
                >
                  <span
                    className="mr-2 size-4 rounded-full border border-black/10"
                    style={{ backgroundColor: option.value }}
                  />
                  {option.label}
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-[#d8e1e4] bg-[#f9fbfb] p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Layers size={16} aria-hidden="true" />
              数据
            </div>
            {metrics ? (
              <dl className="grid grid-cols-[92px_1fr] gap-x-3 gap-y-2 text-sm">
                <dt className="text-[#66747b]">文件</dt>
                <dd className="min-w-0 truncate font-medium">{metrics.fileName}</dd>
                <dt className="text-[#66747b]">CMF</dt>
                <dd>{activeCmfTemplate?.name ?? "未应用"}</dd>
                <dt className="text-[#66747b]">大小</dt>
                <dd>{metrics.fileSize}</dd>
                <dt className="text-[#66747b]">网格</dt>
                <dd>{metrics.meshes.toLocaleString()}</dd>
                <dt className="text-[#66747b]">顶点</dt>
                <dd>{metrics.vertices.toLocaleString()}</dd>
                <dt className="text-[#66747b]">三角面</dt>
                <dd>{metrics.triangles.toLocaleString()}</dd>
                <dt className="text-[#66747b]">尺寸</dt>
                <dd>{metrics.bounds}</dd>
                <dt className="text-[#66747b]">耗时</dt>
                <dd>{metrics.parseTime}</dd>
              </dl>
            ) : (
              <div className="text-sm text-[#66747b]">未载入模型</div>
            )}
          </section>

        </div>
      </aside>

      <section className="flex min-h-[620px] min-w-0 flex-1 flex-col lg:h-full lg:min-h-0">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-[#d3dcdf] bg-white px-4">
          <div className="flex min-w-0 items-center gap-3">
            {phase === "loading" ? (
              <LoaderCircle
                className="animate-spin text-[#244f57]"
                size={19}
                aria-hidden="true"
              />
            ) : (
              <Camera className="text-[#244f57]" size={19} aria-hidden="true" />
            )}
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{status}</div>
              <div className="text-xs text-[#66747b]">
                {phase === "ready"
                  ? `${activeEnvironmentConfig.label} / ${activeCmfTemplate?.name ?? "原始材质"}`
                  : "本地浏览器解析"}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div className="hidden items-center gap-1 rounded-lg border border-[#cbd8dc] bg-[#f8fbfb] p-1 md:flex">
              {renderViews.map((view) => (
                <button
                  key={view.key}
                  className="h-8 rounded-md px-2 text-xs font-semibold text-[#59686f] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-45"
                  type="button"
                  disabled={phase !== "ready"}
                  onClick={() => frameModel(view.direction)}
                >
                  {view.label}
                </button>
              ))}
            </div>
            <button
              className="grid size-10 place-items-center rounded-lg border border-[#cbd8dc] bg-white text-[#243238] transition hover:bg-[#edf4f4] disabled:cursor-not-allowed disabled:opacity-45"
              type="button"
              title="重置视角"
              disabled={phase !== "ready"}
              onClick={focusModel}
            >
              <RotateCcw size={17} aria-hidden="true" />
            </button>
            <button
              className="grid size-10 place-items-center rounded-lg border border-[#cbd8dc] bg-white text-[#243238] transition hover:bg-[#edf4f4] disabled:cursor-not-allowed disabled:opacity-45"
              type="button"
              title="下载 PNG"
              disabled={phase !== "ready"}
              onClick={downloadPng}
            >
              <Download size={17} aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="relative min-h-0 flex-1">
          <div ref={mountRef} className="absolute inset-0" data-render-viewport />

          {phase === "empty" && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <div className="rounded-lg border border-[#d8e1e4] bg-white/92 px-7 py-6 text-center shadow-sm">
                <Box className="mx-auto mb-3 text-[#244f57]" size={34} />
                <div className="text-base font-semibold">选择 STEP 文件</div>
                <div className="mt-1 text-sm text-[#66747b]">
                  支持 .step 和 .stp
                </div>
              </div>
            </div>
          )}

          {phase === "loading" && (
            <div className="absolute inset-0 grid place-items-center bg-white/40 backdrop-blur-[1px]">
              <div className="rounded-lg border border-[#d8e1e4] bg-white px-6 py-5 text-center shadow-sm">
                <LoaderCircle
                  className="mx-auto mb-3 animate-spin text-[#244f57]"
                  size={30}
                />
                <div className="font-semibold">解析中</div>
              </div>
            </div>
          )}

          {isDragging && (
            <div className="absolute inset-4 grid place-items-center rounded-lg border-2 border-dashed border-[#244f57] bg-[#e3f1ef]/80 text-lg font-semibold text-[#20363b]">
              释放 STEP 或图片
            </div>
          )}
        </div>
      </section>

      <aside className="flex w-full shrink-0 flex-col border-t border-[#d3dcdf] bg-white lg:h-full lg:w-[340px] lg:border-l lg:border-t-0">
        <div className="border-b border-[#dfe6e8] px-4 py-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <ImageDown size={16} aria-hidden="true" />
            输出
          </div>
        </div>
        <div className="grid gap-4 overflow-y-auto px-4 py-4 sm:grid-cols-2 lg:flex lg:flex-1 lg:flex-col">
          <section className="rounded-lg border border-[#d8e1e4] bg-[#f9fbfb] p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Sparkles size={16} aria-hidden="true" />
                参考图
              </div>
              <button
                className="flex h-8 items-center gap-1 rounded-lg border border-[#cbd8dc] bg-white px-2 text-xs font-semibold text-[#243238] transition hover:bg-[#edf4f4]"
                type="button"
                onClick={() => referenceInputRef.current?.click()}
              >
                <FileUp size={14} />
                选择
              </button>
            </div>
            <input
              ref={referenceInputRef}
              className="hidden"
              type="file"
              accept="image/*"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  void processReferenceFile(file);
                }
              }}
            />

            {referenceStyle ? (
              <div className="grid gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  alt="参考图"
                  className="h-28 w-full rounded-lg border border-[#d8e1e4] object-cover"
                  src={referenceStyle.dataUrl}
                />
                <div className="grid grid-cols-3 gap-2">
                  {referenceStyle.palette.map((color) => (
                    <span
                      key={color}
                      className="h-8 rounded-lg border border-black/10"
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
                <div className="grid grid-cols-[72px_1fr] gap-x-3 gap-y-1 text-xs">
                  <span className="text-[#66747b]">文件</span>
                  <span className="min-w-0 truncate font-semibold">
                    {referenceStyle.fileName}
                  </span>
                  <span className="text-[#66747b]">亮度</span>
                  <span>{Math.round(referenceStyle.brightness * 100)}%</span>
                  <span className="text-[#66747b]">饱和度</span>
                  <span>{Math.round(referenceStyle.saturation * 100)}%</span>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-[#b8c6ca] bg-white px-3 py-8 text-center text-sm text-[#66747b]">
                拖放图片
              </div>
            )}

            <button
              className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#244f57] px-3 text-sm font-semibold text-white transition hover:bg-[#1d444b] disabled:cursor-not-allowed disabled:opacity-45"
              type="button"
              disabled={phase !== "ready" || !referenceStyle || generationBusy}
              onClick={() => void generateReferenceRenders()}
            >
              {isReferenceGenerating ? (
                <LoaderCircle className="animate-spin" size={16} />
              ) : (
                <Sparkles size={16} />
              )}
              生成参考图渲染
            </button>
          </section>

          <section className="rounded-lg border border-[#d8e1e4] bg-[#f9fbfb] p-4 sm:col-span-2 lg:col-span-1">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <ImageDown size={16} aria-hidden="true" />
                渲染图
              </div>
              <div className="flex items-center gap-1">
                <button
                  className="grid size-8 place-items-center rounded-lg border border-[#cbd8dc] bg-white text-[#243238] transition hover:bg-[#edf4f4] disabled:cursor-not-allowed disabled:opacity-45"
                  type="button"
                  title="导出 ZIP"
                  disabled={!renderImages.length}
                  onClick={() => void downloadRenderZip()}
                >
                  <Archive size={14} />
                </button>
                <button
                  className="grid size-8 place-items-center rounded-lg border border-[#cbd8dc] bg-white text-[#243238] transition hover:bg-[#edf4f4] disabled:cursor-not-allowed disabled:opacity-45"
                  type="button"
                  title="清空图库"
                  disabled={!renderImages.length}
                  onClick={() => setRenderImages([])}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>

            {renderImages.length ? (
              <div className="grid max-h-[560px] gap-2 overflow-y-auto pr-1">
                {renderImages.map((image) => (
                  <div
                    key={image.id}
                    className="grid grid-cols-[104px_1fr_38px] items-center gap-2 rounded-lg border border-[#d8e1e4] bg-white p-2"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      alt={`${image.templateName} ${image.viewLabel}`}
                      className="h-16 w-[104px] rounded-md bg-[#eef2f3] object-cover"
                      src={image.dataUrl}
                    />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">
                        {image.templateName}
                      </div>
                      <div className="text-xs text-[#66747b]">
                        {image.viewLabel}
                      </div>
                    </div>
                    <button
                      className="grid size-9 place-items-center rounded-lg border border-[#cbd8dc] bg-[#f7faf9] text-[#243238] transition hover:bg-[#edf4f4]"
                      type="button"
                      title="下载 PNG"
                      onClick={() => downloadRenderImage(image)}
                    >
                      <Download size={15} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-[#b8c6ca] bg-white px-3 py-8 text-center text-sm text-[#66747b]">
                暂无图片
              </div>
            )}
          </section>
        </div>
      </aside>
    </main>
  );
}
