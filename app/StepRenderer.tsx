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

function materialForCmf(slot: CmfTemplate["slots"][CmfSlot]) {
  const isTransparent = slot.material === "transparent" || (slot.opacity ?? 1) < 1;

  return new THREE.MeshPhysicalMaterial({
    color: slot.color,
    metalness: slot.metalness,
    roughness: slot.roughness,
    clearcoat: slot.clearcoat ?? (slot.material === "metal" ? 0.28 : 0.08),
    transmission: slot.transmission ?? 0,
    transparent: isTransparent,
    opacity: slot.opacity ?? 1,
    depthWrite: !isTransparent,
    thickness: isTransparent ? 0.8 : 0,
    ior: isTransparent ? 1.48 : 1.5,
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
    ? materialForCmf(cmfTemplate.slots[cmfSlot])
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

export default function StepRenderer() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const modelRef = useRef<THREE.Group | null>(null);
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
  const [showEdges, setShowEdges] = useState(true);
  const [autoRotate, setAutoRotate] = useState(false);
  const [background, setBackground] = useState(backgroundOptions[0].value);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [status, setStatus] = useState("等待 STEP 或 STP 文件");
  const [isDragging, setIsDragging] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
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

  const frameModel = useCallback((directionTuple: [number, number, number]) => {
    const group = modelRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!group || !camera || !controls) {
      return;
    }

    const box = new THREE.Box3().setFromObject(group);
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);

    const maxDimension = Math.max(size.x, size.y, size.z, 1);
    const distance =
      (maxDimension / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2))) *
      2.15;
    const direction = new THREE.Vector3(...directionTuple).normalize();

    camera.position.copy(center).add(direction.multiplyScalar(distance));
    camera.near = Math.max(maxDimension / 2000, 0.001);
    camera.far = Math.max(maxDimension * 200, 1000);
    camera.updateProjectionMatrix();

    controls.target.copy(center);
    controls.minDistance = maxDimension * 0.025;
    controls.maxDistance = maxDimension * 30;
    controls.update();
  }, []);

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
      const group = buildGroup(result, showEdges, materialMode, cmfTemplate);
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
    [activeCmfId, focusModel, materialMode, showEdges],
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

  const captureCurrentCanvas = useCallback(
    (template: CmfTemplate, view: (typeof renderViews)[number]) => {
      const renderer = rendererRef.current;
      const scene = sceneRef.current;
      const camera = cameraRef.current;
      const file = lastFileRef.current;
      if (!renderer || !scene || !camera || !file) {
        return null;
      }

      frameModel(view.direction);
      scene.background = new THREE.Color(template.background);
      renderer.setClearColor(template.background);
      renderer.render(scene, camera);

      const fileStem = slugify(file.name) || "step-render";
      const fileName = `${fileStem}-${slugify(template.shortName)}-${view.key}.png`;

      return {
        id: `${template.id}-${view.key}-${Date.now()}`,
        templateId: template.id,
        templateName: template.name,
        viewKey: view.key,
        viewLabel: view.label,
        fileName,
        dataUrl: renderer.domElement.toDataURL("image/png"),
      } satisfies RenderImage;
    },
    [frameModel],
  );

  const applyCmfTemplate = useCallback((template: CmfTemplate) => {
    if (!lastResultRef.current) {
      setPhase("error");
      setStatus("请先载入 STEP 文件");
      return;
    }

    setActiveCmfId(template.id);
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

    const keyLight = new THREE.DirectionalLight("#ffffff", 2.8);
    keyLight.position.set(6, -8, 9);
    keyLight.castShadow = true;
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight("#b9d9d0", 1.3);
    fillLight.position.set(-6, 5, 4);
    scene.add(fillLight);

    const grid = new THREE.GridHelper(12, 12, "#91a1a9", "#d1d8dc");
    grid.rotation.x = Math.PI / 2;
    grid.position.z = -0.002;
    scene.add(grid);

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
    };
  }, [resizeRenderer]);

  useEffect(() => {
    autoRotateRef.current = autoRotate;
  }, [autoRotate]);

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

  return (
    <main
      className="flex min-h-screen flex-col bg-[#eef2f3] text-[#172026] lg:flex-row"
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
          void parseFile(file);
        }
      }}
    >
      <aside className="flex w-full shrink-0 flex-col border-b border-[#d3dcdf] bg-white lg:h-screen lg:w-[340px] lg:border-b-0 lg:border-r">
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

        <div className="grid gap-5 overflow-y-auto px-5 py-5 sm:grid-cols-2 lg:flex lg:flex-1 lg:flex-col">
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
              拖放 .step 或 .stp
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
                disabled={phase !== "ready" || isGenerating}
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
                    disabled={phase !== "ready" || isGenerating}
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
                    disabled={phase !== "ready" || isGenerating}
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
              <div className="grid max-h-[420px] gap-2 overflow-y-auto pr-1">
                {renderImages.map((image) => (
                  <div
                    key={image.id}
                    className="grid grid-cols-[92px_1fr_38px] items-center gap-2 rounded-lg border border-[#d8e1e4] bg-white p-2"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      alt={`${image.templateName} ${image.viewLabel}`}
                      className="h-14 w-[92px] rounded-md bg-[#eef2f3] object-cover"
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
              <div className="rounded-lg border border-dashed border-[#b8c6ca] bg-white px-3 py-5 text-center text-sm text-[#66747b]">
                暂无图片
              </div>
            )}
          </section>
        </div>
      </aside>

      <section className="flex min-h-[560px] min-w-0 flex-1 flex-col lg:min-h-screen">
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
                {phase === "ready" ? "鼠标拖拽查看模型" : "本地浏览器解析"}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
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

        <div className="relative min-h-[520px] flex-1 lg:min-h-0">
          <div ref={mountRef} className="absolute inset-0" />

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
              释放文件
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
