"use client";

import {
  Box,
  Camera,
  Download,
  FileUp,
  Layers,
  LoaderCircle,
  Palette,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

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

function makeMesh(source: OcctMesh, showEdges: boolean, mode: MaterialMode) {
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

  const baseMaterial = materialForColor(sourceColor, mode);
  const materials: THREE.Material[] = [baseMaterial];
  const materialKeys = new Map<string, number>();

  if (mode === "source" && source.brep_faces?.length) {
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
        color: mode === "clay" ? "#63706c" : "#1f2933",
        transparent: true,
        opacity: 0.34,
      }),
    );
    edges.name = `${mesh.name} edges`;
    group.add(edges);
  }

  return group;
}

function buildGroup(result: OcctResult, showEdges: boolean, mode: MaterialMode) {
  const group = new THREE.Group();
  group.name = result.root?.name || "STEP model";

  for (const mesh of result.meshes) {
    if (!mesh.attributes?.position?.array?.length || !mesh.index?.array?.length) {
      continue;
    }
    group.add(makeMesh(mesh, showEdges, mode));
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
  const [showEdges, setShowEdges] = useState(true);
  const [autoRotate, setAutoRotate] = useState(false);
  const [background, setBackground] = useState(backgroundOptions[0].value);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [status, setStatus] = useState("等待 STEP 或 STP 文件");
  const [isDragging, setIsDragging] = useState(false);

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

  const focusModel = useCallback(() => {
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
    const direction = new THREE.Vector3(1.15, -1.35, 0.82).normalize();

    camera.position.copy(center).add(direction.multiplyScalar(distance));
    camera.near = Math.max(maxDimension / 2000, 0.001);
    camera.far = Math.max(maxDimension * 200, 1000);
    camera.updateProjectionMatrix();

    controls.target.copy(center);
    controls.minDistance = maxDimension * 0.025;
    controls.maxDistance = maxDimension * 30;
    controls.update();
  }, []);

  const replaceModel = useCallback(
    (result: OcctResult, file: File, elapsedMs: number) => {
      const scene = sceneRef.current;
      if (!scene) {
        return;
      }

      if (modelRef.current) {
        scene.remove(modelRef.current);
        disposeObject(modelRef.current);
      }

      const group = buildGroup(result, showEdges, materialMode);
      scene.add(group);
      modelRef.current = group;
      lastResultRef.current = result;
      lastFileRef.current = file;
      lastElapsedRef.current = elapsedMs;
      focusModel();
      setMetrics(getMetrics(file, result, group, elapsedMs));
      setPhase("ready");
      setStatus("渲染完成");
    },
    [focusModel, materialMode, showEdges],
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
  }, [materialMode, showEdges, rebuildCurrentModel]);

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
                  onClick={() => setMaterialMode(key as MaterialMode)}
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
