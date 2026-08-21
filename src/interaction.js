// ============================================================
// 交互：射线拾取（点击/悬浮）、高亮、相机聚焦、链路加粗高亮
// ============================================================

import * as THREE from 'three';
import { LINK_HIGHLIGHT } from './constants.js';

export function setupInteraction(app) {
  const raycaster = new THREE.Raycaster();
  raycaster.params.Line2 = { threshold: 5 };
  const ndc = new THREE.Vector2();

  // 可拾取对象集合
  const pickables = [];
  for (const m of app.sceneModel.meshes.servers.values()) pickables.push(m);
  for (const m of app.sceneModel.meshes.leaves.values()) pickables.push(m);
  for (const m of app.sceneModel.meshes.spines.values()) pickables.push(m);
  for (const m of app.sceneModel.meshes.edges.values()) pickables.push(m);
  for (const m of app.sceneModel.meshes.mgmts.values()) pickables.push(m);
  for (const m of app.sceneModel.meshes.pedestals) pickables.push(m);
  for (const m of app.sceneModel.meshes.frames) pickables.push(m);
  for (const m of app.sceneModel.meshes.links.values()) pickables.push(m);

  const hoverHelper = new THREE.BoxHelper(new THREE.Mesh(), 0x9fd7ff);
  hoverHelper.visible = false;
  app.scene.add(hoverHelper);

  const selHelper = new THREE.BoxHelper(new THREE.Mesh(), 0xffffff);
  selHelper.visible = false;
  app.scene.add(selHelper);

  function getMesh(dataObj) {
    switch (dataObj.kind) {
      case 'server':
        return app.sceneModel.meshes.servers.get(dataObj.id);
      case 'leaf':
        return app.sceneModel.meshes.leaves.get(dataObj.id);
      case 'spine':
        return app.sceneModel.meshes.spines.get(dataObj.id);
      case 'edge':
        return app.sceneModel.meshes.edges.get(dataObj.id);
      case 'mgmt':
        return app.sceneModel.meshes.mgmts.get(dataObj.id);
      case 'rack':
        return app.sceneModel.meshes.racks.get(dataObj.id);
      case 'link':
        return app.sceneModel.meshes.links.get(dataObj.id);
      default:
        return null;
    }
  }

  function setNDC(e) {
    const r = app.renderer.domElement.getBoundingClientRect();
    ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  }

  function pick(e) {
    setNDC(e);
    raycaster.setFromCamera(ndc, app.camera);
    const hits = raycaster.intersectObjects(pickables, false);
    const hit = hits.find((h) => h.object.userData && h.object.userData.kind);
    return hit || null;
  }

  // 选中对象相关的链路
  function relatedLinkIds(selected) {
    const ids = new Set();
    if (!selected) return ids;
    const links = app.data.links;
    if (selected.kind === 'link') {
      ids.add(selected.id);
      return ids;
    }
    if (selected.kind === 'rack') {
      for (const l of links) if (l.aId === selected.leafId || l.bId === selected.leafId) ids.add(l.id);
      return ids;
    }
    for (const l of links) if (l.aId === selected.id || l.bId === selected.id) ids.add(l.id);
    return ids;
  }

  function applyLinks() {
    const selected = app.status.selected;
    const linkAffecting =
      selected && ['leaf', 'spine', 'edge', 'mgmt', 'rack', 'link'].includes(selected.kind);
    const related = relatedLinkIds(selected);

    for (const l of app.data.links) {
      const isHovered = l.id === app.status.hoveredLink;
      const isRelated = related.has(l.id);
      if (isHovered || isRelated) {
        app.sceneModel.setLink(l.id, { width: 2, colorHex: LINK_HIGHLIGHT, opacity: 0.95 });
      } else if (linkAffecting) {
        app.sceneModel.dimLink(l.id);
      } else {
        app.sceneModel.resetLink(l.id);
      }
    }
  }

  // ---------- 选中 ----------
  function select(dataObj) {
    app.status.selected = dataObj;
    const mesh = getMesh(dataObj);

    if (mesh && dataObj.kind !== 'link') {
      selHelper.setFromObject(mesh);
      selHelper.visible = true;
    } else {
      selHelper.visible = false;
    }

    app.ui.showInfo(dataObj, app.data);
    applyLinks();

    if (['rack', 'spine', 'edge', 'mgmt'].includes(dataObj.kind)) {
      focusFor(dataObj, mesh);
    }
  }

  function deselect() {
    app.status.selected = null;
    app.ui.hideInfo();
    selHelper.visible = false;
    applyLinks();
  }

  app.selectObject = select;
  app.deselect = deselect;
  app.actions.selectById = (id) => select(app.data.byId.get(id));

  // ---------- 相机聚焦 ----------
  function focusFor(dataObj, mesh) {
    const pos = new THREE.Vector3();
    mesh.getWorldPosition(pos);
    let target;
    let camPos;

    if (dataObj.kind === 'rack') {
      // 正面视角：相机高度只比机柜顶(2.06m)略高一点（尽量平视），
      // 距离 3.4m < 排间距 3.8m，前排机柜始终落在相机身后，不会被遮挡
      target = pos.clone().add(new THREE.Vector3(0, 1.0, 0));
      camPos = pos.clone().add(new THREE.Vector3(0, 2.3, 3.4));
    } else if (dataObj.kind === 'server') {
      target = pos.clone();
      camPos = pos.clone().add(new THREE.Vector3(0, 0.25, 1.2));
    } else if (dataObj.kind === 'leaf') {
      target = pos.clone();
      camPos = pos.clone().add(new THREE.Vector3(0, 0.5, 1.6));
    } else {
      // spine / edge / mgmt
      target = pos.clone().add(new THREE.Vector3(0, -0.1, 0));
      camPos = pos.clone().add(new THREE.Vector3(0, 1.0, 2.2));
    }
    app.flyTo(camPos, target, 0.9);
  }

  // 供 IP 搜索等外部调用：选中 + 聚焦任意对象
  app.focusObject = (dataObj) => {
    const mesh = getMesh(dataObj);
    if (!mesh) return;
    focusFor(dataObj, mesh);
  };

  // ---------- 事件监听 ----------
  const el = app.renderer.domElement;
  let downPos = null;

  el.addEventListener('pointerdown', (e) => {
    downPos = { x: e.clientX, y: e.clientY };
  });

  el.addEventListener('pointerup', (e) => {
    if (!downPos) return;
    const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
    downPos = null;
    if (moved > 5) return;
    const hit = pick(e);
    if (hit) select(hit.object.userData);
    else deselect();
  });

  el.addEventListener('pointermove', (e) => {
    const hit = pick(e);
    const newHoverLink = hit && hit.object.userData.kind === 'link' ? hit.object.userData.id : null;

    if (newHoverLink !== app.status.hoveredLink) {
      app.status.hoveredLink = newHoverLink;
      applyLinks();
    }

    if (hit) {
      el.style.cursor = 'pointer';
      app.ui.setTooltip(hit.object.userData, e.clientX, e.clientY);
      if (hit.object.userData.kind !== 'link') {
        const highlightMesh = getMesh(hit.object.userData) || hit.object;
        hoverHelper.setFromObject(highlightMesh);
        hoverHelper.visible = true;
      } else {
        hoverHelper.visible = false;
      }
    } else {
      el.style.cursor = 'default';
      app.ui.hideTooltip();
      hoverHelper.visible = false;
    }
  });

  el.addEventListener('pointerleave', () => {
    app.ui.hideTooltip();
    hoverHelper.visible = false;
    if (app.status.hoveredLink) {
      app.status.hoveredLink = null;
      applyLinks();
    }
  });
}
