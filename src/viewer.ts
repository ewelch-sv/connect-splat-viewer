import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";

export interface ViewerHandle {
  loadFromUrl: (url: string) => Promise<void>;
  dispose: () => void;
  setStatus: (message: string | null) => void;
}

export function createViewer(container: HTMLElement): ViewerHandle {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x12171c);

  const camera = new THREE.PerspectiveCamera(55, 1, 0.01, 5000);
  camera.position.set(2.5, 1.5, 3.5);

  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  const spark = new SparkRenderer({ renderer });
  scene.add(spark);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(0, 0, 0);

  let splat: SplatMesh | null = null;

  const overlay = document.createElement("div");
  overlay.className = "viewer-status";
  container.appendChild(overlay);

  function resize(): void {
    const width = container.clientWidth || 1;
    const height = container.clientHeight || 1;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  }

  function clearSplat(): void {
    if (!splat) {
      return;
    }
    scene.remove(splat);
    splat = null;
  }

  function frameObject(object: THREE.Object3D): void {
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) {
      return;
    }
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length();
    const distance = Math.max(size * 0.6, 1.5);
    controls.target.copy(center);
    camera.position.copy(center).add(new THREE.Vector3(distance, distance * 0.45, distance));
    camera.near = Math.max(distance / 200, 0.01);
    camera.far = distance * 40;
    camera.updateProjectionMatrix();
    controls.update();
  }

  const onResize = () => resize();
  window.addEventListener("resize", onResize);
  const resizeObserver = new ResizeObserver(onResize);
  resizeObserver.observe(container);
  resize();

  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
  });

  return {
    async loadFromUrl(url: string): Promise<void> {
      clearSplat();
      overlay.textContent = "Preparing splat renderer…";
      const mesh = new SplatMesh({ url });
      // 3DGS training frames are often Y-down relative to Three.js.
      mesh.quaternion.set(1, 0, 0, 0);
      splat = mesh;
      scene.add(mesh);
      await mesh.initialized;
      frameObject(mesh);
      overlay.textContent = "";
    },
    setStatus(message: string | null): void {
      overlay.textContent = message ?? "";
    },
    dispose(): void {
      window.removeEventListener("resize", onResize);
      resizeObserver.disconnect();
      renderer.setAnimationLoop(null);
      clearSplat();
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      overlay.remove();
    },
  };
}
