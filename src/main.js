// ============================================================
// 入口：从 CMDB（SQLite）加载数据，初始化渲染器 / 相机 / 灯光 / 场景
// 以及动画循环（状态呼吸灯、标签显隐、相机飞行、自动巡检）
// ============================================================

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { loadData, findByIp, randomizeFaults, resetAll } from './data.js';
import { buildScene } from './scene.js';
import { buildLabels } from './labels.js';
import { buildUI } from './ui.js';
import { setupInteraction } from './interaction.js';
import { ROW_GAP_Z } from './constants.js';

const loadingEl = document.getElementById('loading');
const errorEl = document.getElementById('load-error');

async function bootstrap() {
  // ---------- 从 CMDB 加载数据 ----------
  const data = await loadData();

  // ---------- 渲染器 ----------
  const container = document.getElementById('scene-container');
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0e14);
  scene.fog = new THREE.Fog(0x0a0e14, 45, 130);

  const camera = new THREE.PerspectiveCamera(
    50,
    container.clientWidth / container.clientHeight,
    0.1,
    400
  );

  // ---------- 标签渲染器 ----------
  const labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(container.clientWidth, container.clientHeight);
  labelRenderer.domElement.style.position = 'absolute';
  labelRenderer.domElement.style.top = '0';
  labelRenderer.domElement.style.left = '0';
  labelRenderer.domElement.style.pointerEvents = 'none';
  container.appendChild(labelRenderer.domElement);

  // ---------- 控制器 ----------
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.48;
  controls.minDistance = 0.4;
  controls.maxDistance = 70;

  // ---------- 灯光 ----------
  scene.add(new THREE.HemisphereLight(0x8899bb, 0x0a0e14, 1.0));
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.7);
  keyLight.position.set(12, 20, 10);
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0x3a4a66, 0.5);
  fillLight.position.set(-10, 8, -8);
  scene.add(fillLight);

  // ---------- 场景 / 标签 ----------
  const sceneModel = buildScene(data);
  scene.add(sceneModel.root);
  sceneModel.setLinkResolution(container.clientWidth, container.clientHeight);
  const labels = buildLabels(data);

  const grid = new THREE.GridHelper(60, 60, 0x1b2735, 0x111a26);
  grid.position.y = 0.001;
  scene.add(grid);

  // ---------- 相机取景 ----------
  function computeCenter() {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const r of data.racks) {
      minX = Math.min(minX, r.x); maxX = Math.max(maxX, r.x);
      minZ = Math.min(minZ, r.z); maxZ = Math.max(maxZ, r.z);
    }
    for (const s of data.spines) {
      minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x);
      minZ = Math.min(minZ, s.z); maxZ = Math.max(maxZ, s.z);
    }
    return new THREE.Vector3((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
  }

  const center = computeCenter();
  const overviewPos = new THREE.Vector3(center.x + 9, 13, center.z + 14);
  const overviewTarget = new THREE.Vector3(center.x, 0.4, center.z);
  camera.position.copy(overviewPos);
  controls.target.copy(overviewTarget);
  controls.update();

  // ---------- App 上下文 ----------
  const app = {
    data,
    scene,
    camera,
    renderer,
    labelRenderer,
    controls,
    sceneModel,
    labels,
    status: { selected: null, touring: false, planeVisible: { lan: true, wan: false, oob: false } },
    tween: null,
    tourWaypoints: [],
    tourIndex: 0,
    actions: {},
  };

  const ui = buildUI(app);
  app.ui = ui;

  // 网络分层初始可见性
  for (const [p, on] of Object.entries(app.status.planeVisible)) {
    sceneModel.meshes.planeGroups[p].visible = on;
  }
  ui.renderPlaneToggles();

  app.sync = () => {
    sceneModel.sync();
    ui.updateStats(data.stats);
    if (app.status.selected) ui.showInfo(app.status.selected, data);
  };

  setupInteraction(app);

  // ---------- 相机飞行 ----------
  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  app.flyTo = (pos, target, duration = 1.1) => {
    app.tween = {
      t: 0,
      duration,
      fromPos: camera.position.clone(),
      fromTarget: controls.target.clone(),
      toPos: pos.clone(),
      toTarget: target.clone(),
    };
    controls.enabled = false;
  };

  // ---------- 动作 ----------
  app.actions.overview = () => {
    app.status.touring = false;
    ui.setTourButton(false);
    app.flyTo(overviewPos, overviewTarget, 1.2);
  };

  app.actions.togglePlane = (plane) => {
    app.status.planeVisible[plane] = !app.status.planeVisible[plane];
    sceneModel.meshes.planeGroups[plane].visible = app.status.planeVisible[plane];
    ui.renderPlaneToggles();
  };

  app.actions.search = (ip) => {
    const found = findByIp(data, ip);
    if (!found) {
      ui.showToast(`未找到 IP「${ip.trim()}」`);
      return;
    }
    app.selectObject(found);
    app.focusObject(found);
    ui.showToast(`已定位：${found.name}（${found.ip || found.mgmt}）`);
  };

  app.actions.fault = () => {
    randomizeFaults(data);
    app.sync();
  };

  app.actions.reset = () => {
    resetAll(data);
    app.sync();
  };

  app.actions.deselect = () => app.deselect && app.deselect();

  // ---------- 自动巡检 ----------
  function buildTourWaypoints() {
    const wps = [{ pos: overviewPos.clone(), target: overviewTarget.clone() }];
    for (const row of data.rows) {
      const z = (row.index - (data.rows.length - 1) / 2) * ROW_GAP_Z;
      wps.push({
        pos: new THREE.Vector3(0, 5.5, z + 7),
        target: new THREE.Vector3(0, 0.6, z),
      });
    }
    const spineZ = ((data.rows.length - 1) / 2 + 1) * ROW_GAP_Z + 1.0;
    wps.push({
      pos: new THREE.Vector3(0, 5.5, spineZ + 5),
      target: new THREE.Vector3(0, 0.6, spineZ),
    });
    wps.push({ pos: overviewPos.clone(), target: overviewTarget.clone() });
    return wps;
  }

  function advanceTour() {
    if (!app.status.touring) return;
    app.tourIndex = (app.tourIndex + 1) % app.tourWaypoints.length;
    const wp = app.tourWaypoints[app.tourIndex];
    app.flyTo(wp.pos, wp.target, 1.5);
  }

  app.actions.tour = () => {
    if (app.status.touring) {
      app.status.touring = false;
      app.tween = null;
      controls.enabled = true;
      ui.setTourButton(false);
      return;
    }
    app.status.touring = true;
    app.tourWaypoints = buildTourWaypoints();
    app.tourIndex = 0;
    ui.setTourButton(true);
    app.flyTo(app.tourWaypoints[0].pos, app.tourWaypoints[0].target, 1.5);
  };

  // 用户拖拽即停止巡检
  controls.addEventListener('start', () => {
    if (app.status.touring) {
      app.status.touring = false;
      ui.setTourButton(false);
    }
  });

  // ---------- 动画循环 ----------
  const clock = new THREE.Clock();

  function animate() {
    requestAnimationFrame(animate);
    const dt = clock.getDelta();
    const t = clock.getElapsedTime();

    // 故障/告警呼吸灯（服务器面板 + 网络设备端口面板自发光脉动）
    const faces = sceneModel.materials.faces;
    for (const m of faces.fault) m.emissiveIntensity = 0.4 + 0.3 * (0.5 + 0.5 * Math.sin(t * 5));
    for (const m of faces.warning) m.emissiveIntensity = 0.28 + 0.14 * (0.5 + 0.5 * Math.sin(t * 2.2));
    for (const m of faces.normal) m.emissiveIntensity = 0.13 + 0.1 * (0.5 + 0.5 * Math.sin(t * 1.6));

    // 相机飞行补间
    if (app.tween) {
      const tw = app.tween;
      tw.t += dt;
      const k = Math.min(tw.t / tw.duration, 1);
      const e = easeInOutCubic(k);
      camera.position.lerpVectors(tw.fromPos, tw.toPos, e);
      controls.target.lerpVectors(tw.fromTarget, tw.toTarget, e);
      if (k >= 1) {
        app.tween = null;
        controls.enabled = true;
        if (app.status.touring) advanceTour();
      }
    }

    // 机柜标签按距离显隐（避免总览时拥挤）
    for (const { label } of labels.rackLabels) {
      label.visible = camera.position.distanceTo(label.position) < 24;
    }

    controls.update();
    renderer.render(scene, camera);
    labelRenderer.render(labels.scene, camera);
  }

  // ---------- 窗口自适应 ----------
  window.addEventListener('resize', () => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    labelRenderer.setSize(w, h);
    sceneModel.setLinkResolution(w, h);
  });

  // 首次刷新统计
  app.sync();
  loadingEl.classList.add('hidden');
  animate();
}

bootstrap().catch((err) => {
  loadingEl.classList.add('hidden');
  errorEl.textContent = 'CMDB 数据加载失败：' + (err && err.message ? err.message : err);
  errorEl.classList.remove('hidden');
  console.error(err);
});
