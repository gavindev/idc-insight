// ============================================================
// UI：统计栏、图例、网络分层开关、详情面板、IP 搜索、悬浮提示
// ============================================================

import { STATUS, STATUS_LABEL, PLANE_INFO, DEVICE_TYPE_LABEL } from './constants.js';

const PLANE_ORDER = ['lan', 'wan', 'oob'];

export function buildUI(app) {
  const el = {
    stats: document.getElementById('stats'),
    panel: document.getElementById('panel'),
    tooltip: document.getElementById('tooltip'),
    toast: document.getElementById('toast'),
    planeToggles: document.getElementById('plane-toggles'),
    search: document.getElementById('ip-search'),
    btnSearch: document.getElementById('btn-search'),
    btnOverview: document.getElementById('btn-overview'),
    btnTour: document.getElementById('btn-tour'),
    btnFault: document.getElementById('btn-fault'),
    btnReset: document.getElementById('btn-reset'),
  };

  const ui = {
    updateStats,
    showInfo,
    hideInfo,
    setTooltip,
    hideTooltip,
    setTourButton,
    renderPlaneToggles,
    showToast,
  };

  // ---------- 按钮事件 ----------
  el.btnOverview.addEventListener('click', () => app.actions.overview());
  el.btnTour.addEventListener('click', () => app.actions.tour());
  el.btnFault.addEventListener('click', () => app.actions.fault());
  el.btnReset.addEventListener('click', () => app.actions.reset());

  // IP 搜索
  function doSearch() {
    app.actions.search(el.search.value);
  }
  el.btnSearch.addEventListener('click', doSearch);
  el.search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSearch();
  });

  // ---------- 统计栏 ----------
  function updateStats(stats) {
    const devFault = stats.leafFault + stats.spineFault + stats.edgeFault + stats.mgmtFault;
    const devWarning = stats.leafWarning + stats.spineWarning + stats.edgeWarning + stats.mgmtWarning;
    el.stats.innerHTML = `
      <span class="stat-item"><b>${stats.servers}</b> 服务器
        <span class="dot warning"></span>${stats.serverWarning}
        <span class="dot fault"></span>${stats.serverFault}</span>
      <span class="stat-item"><b>${stats.racks}</b> 机柜
        <span class="dot warning"></span>${stats.rackWarning}
        <span class="dot fault"></span>${stats.rackFault}</span>
      <span class="stat-item">交换机 Leaf ${stats.leaves} · Spine ${stats.spines} · Edge ${stats.edges} · MGMT ${stats.mgmts}
        <span class="dot warning"></span>${devWarning}
        <span class="dot fault"></span>${devFault}</span>
      <span class="stat-item"><b>${stats.links}</b> 链路
        <span class="dot warning"></span>${stats.linkWarning}
        <span class="dot fault"></span>${stats.linkFault}</span>
    `;
  }

  // ---------- 网络分层开关 ----------
  function renderPlaneToggles() {
    el.planeToggles.innerHTML = PLANE_ORDER.map((p) => {
      const info = PLANE_INFO[p];
      const on = app.status.planeVisible[p];
      return `<div class="plane-toggle ${on ? 'on' : ''}" data-plane="${p}">
        <span class="plane-dot" style="background:${info.css};box-shadow:0 0 6px ${info.css}"></span>
        <span class="plane-name">${info.name}</span>
        <span class="plane-state">${on ? '显示' : '隐藏'}</span>
      </div>`;
    }).join('');
    el.planeToggles.querySelectorAll('.plane-toggle').forEach((t) => {
      t.addEventListener('click', () => app.actions.togglePlane(t.getAttribute('data-plane')));
    });
  }

  // ---------- 详情面板 ----------
  function statusChip(status) {
    return `<span class="status-chip ${status}">${STATUS_LABEL[status]}</span>`;
  }

  function kv(k, v) {
    return `<div class="kv"><span class="k">${k}</span><span class="v">${v}</span></div>`;
  }

  function linksInvolving(data, objId, plane) {
    return data.links.filter(
      (l) => (l.aId === objId || l.bId === objId) && (!plane || l.plane === plane)
    );
  }

  function peerNames(data, obj, plane) {
    return linksInvolving(data, obj.id, plane).map((l) => {
      const other = data.byId.get(l.aId === obj.id ? l.bId : l.aId);
      return other.name;
    });
  }

  function showInfo(obj, data) {
    const byId = data.byId;
    let body = '';

    if (obj.kind === 'server') {
      const rack = byId.get(obj.rackId);
      const uEnd = obj.uStart + obj.uHeight - 1;
      body = `
        <div class="panel-head">
          <div class="panel-title">🖥 ${obj.name}</div>
          ${statusChip(obj.status)}
        </div>
        ${kv('类型', `服务器（${obj.uHeight}U 计算节点）`)}
        ${kv('设备型号', obj.model)}
        ${kv('业务 IP', obj.ip)}
        ${kv('带外管理 IP', obj.mgmt)}
        ${kv('关联业务', obj.business)}
        ${kv('所在位置', `${rack.rowName} · ${obj.rackName} · U${obj.uStart}~U${uEnd}`)}
      `;
    } else if (obj.kind === 'rack') {
      // 按 U 位从高到低（机柜顶部→底部）排列，与 3D 机柜的物理位置一致
      const servers = obj.serverIds
        .map((id) => byId.get(id))
        .sort((a, b) => b.uStart - a.uStart);
      const normal = servers.filter((s) => s.status === STATUS.NORMAL).length;
      const warning = servers.filter((s) => s.status === STATUS.WARNING).length;
      const fault = servers.filter((s) => s.status === STATUS.FAULT).length;
      const leaf = byId.get(obj.leafId);
      const rowsHtml = servers
        .map(
          (s) => `
        <div class="srv-row" data-id="${s.id}">
          <span class="srv-led ${s.status}"></span>
          <span class="srv-u">U${s.uStart}${s.uHeight > 1 ? `~${s.uStart + s.uHeight - 1}` : ''}</span>
          <span class="srv-name">${s.name}</span>
          <span class="srv-tag">${s.uHeight}U</span>
          <span class="srv-ip">${s.ip}</span>
        </div>`
        )
        .join('');
      body = `
        <div class="panel-head">
          <div class="panel-title">▤ ${obj.name}</div>
          ${statusChip(obj.status)}
        </div>
        ${kv('机柜型号', obj.model)}
        ${kv('所在位置', obj.rowName + ' · 第 ' + (obj.indexInRow + 1) + ' 位')}
        ${kv('机柜 Leaf', leaf ? leaf.name : '-')}
        <div class="panel-section">
          <div class="mini-stats">
            <span><span class="dot normal"></span>正常 ${normal}</span>
            <span><span class="dot warning"></span>告警 ${warning}</span>
            <span><span class="dot fault"></span>故障 ${fault}</span>
          </div>
          <h3>柜内服务器（42U）</h3>
          <div class="srv-list">${rowsHtml}</div>
        </div>
      `;
    } else if (['leaf', 'spine', 'edge', 'mgmt'].includes(obj.kind)) {
      const extras = [];
      if (obj.kind === 'leaf') {
        const rack = byId.get(obj.rackId);
        extras.push(kv('所属机柜', `${obj.rackName}（${rack.rowName}）`));
        extras.push(kv('内网上联', peerNames(data, obj, 'lan').join('、') || '-'));
      } else if (obj.kind === 'spine') {
        extras.push(kv('内网下联 Leaf', `${peerNames(data, obj, 'lan').length} 台（Full-Mesh）`));
        extras.push(kv('外网上联 Edge', peerNames(data, obj, 'wan').join('、') || '-'));
      } else if (obj.kind === 'edge') {
        extras.push(kv('外网下联 Spine', peerNames(data, obj, 'wan').join('、') || '-'));
      } else if (obj.kind === 'mgmt') {
        extras.push(kv('纳管设备数', `${peerNames(data, obj, 'oob').length} 台`));
      }
      body = `
        <div class="panel-head">
          <div class="panel-title">◧ ${obj.name}</div>
          ${statusChip(obj.status)}
        </div>
        ${kv('类型', DEVICE_TYPE_LABEL[obj.kind])}
        ${kv('设备型号', obj.model)}
        ${kv('业务 IP', obj.ip)}
        ${kv('带外管理 IP', obj.mgmt)}
        ${kv('关联业务', obj.business)}
        ${extras.join('')}
      `;
    } else if (obj.kind === 'link') {
      const a = byId.get(obj.aId);
      const b = byId.get(obj.bId);
      const plane = PLANE_INFO[obj.plane];
      body = `
        <div class="panel-head">
          <div class="panel-title">〰 网络链路</div>
          ${statusChip(obj.status)}
        </div>
        ${kv('所属网络', plane.label)}
        ${kv('链路', `${a.name} ⇄ ${b.name}`)}
        ${kv('一端 IP', a.ip)}
        ${kv('另一端 IP', b.ip)}
      `;
    }

    el.panel.innerHTML =
      body + '<button class="panel-close" style="position:absolute;top:10px;right:10px;">✕</button>';
    el.panel.classList.remove('hidden');

    el.panel.querySelector('.panel-close').addEventListener('click', () => app.actions.deselect());
    el.panel.querySelectorAll('.srv-row').forEach((row) => {
      row.addEventListener('click', () => app.actions.selectById(row.getAttribute('data-id')));
    });
  }

  function hideInfo() {
    el.panel.classList.add('hidden');
    el.panel.innerHTML = '';
  }

  // ---------- 悬浮提示 ----------
  function setTooltip(obj, clientX, clientY) {
    let name = obj.name;
    let sub = STATUS_LABEL[obj.status];
    if (obj.kind === 'link') {
      const a = app.data.byId.get(obj.aId);
      const b = app.data.byId.get(obj.bId);
      name = `${a.name} ⇄ ${b.name}`;
      sub = `${PLANE_INFO[obj.plane].name} · ${sub}`;
    } else if (obj.kind === 'server') {
      sub = `${obj.ip} · ${sub}`;
    } else if (obj.kind === 'rack') {
      sub = `${obj.rowName} · ${sub}`;
    } else {
      sub = `${DEVICE_TYPE_LABEL[obj.kind]} · ${sub}`;
    }

    el.tooltip.innerHTML = `<div class="tt-name">${name}</div><div class="tt-sub">${sub}</div>`;
    el.tooltip.classList.remove('hidden');
    el.tooltip.style.left = clientX + 'px';
    el.tooltip.style.top = clientY + 'px';
  }

  function hideTooltip() {
    el.tooltip.classList.add('hidden');
  }

  function setTourButton(on) {
    el.btnTour.textContent = on ? '■ 停止巡检' : '▶ 巡检';
    el.btnTour.classList.toggle('btn-active', on);
  }

  // ---------- 轻提示 ----------
  let toastTimer = null;
  function showToast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.remove('hidden');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.add('hidden'), 2600);
  }

  return ui;
}
