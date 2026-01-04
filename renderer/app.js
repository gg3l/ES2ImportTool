const $ = (id) => document.getElementById(id);

const state = {
  ugcRoot: '',
  ugcValid: false,
  rooms: [],

  appVersion: '',

  source: {
    roomPath: null,
    allRoots: [],
    filterText: '',
    searchName: true,
    searchPropId: true,
    searchId: true,
    selectedId: null,
    propCount: 0,
  },

  target: {
    roomPath: null,
    allRoots: [],
    filterText: '',
    searchName: true,
    searchPropId: true,
    searchId: true,
    selectedId: null,
    propCount: 0,
    restorePoints: [],
    selectedRestoreFile: null,
  },

  busy: false,
  sessionLog: [],
};

function formatNodeLabel(n) {
  const base = `${n.displayName}   (ID: ${n.id}, parent: ${n.parentId})`;
  return n.propId ? `${base}   [${n.propId}]` : base;
}

function countNodes(roots) {
  let c = 0;
  const walk = (node) => {
    c++;
    for (const ch of node.children || []) walk(ch);
  };
  for (const r of roots || []) walk(r);
  return c;
}

function cloneNode(n, expandParents = false) {
  return {
    id: n.id,
    parentId: n.parentId,
    displayName: n.displayName,
    propId: n.propId,
    isExpanded: !!expandParents,
    children: (n.children || []).map(ch => cloneNode(ch, expandParents))
  };
}

function filterNode(node, f, searchName, searchPropId, searchId) {
  const filter = (f || '').trim().toLowerCase();
  const hasFilter = filter.length > 0;

  let selfMatches = !hasFilter;
  if (hasFilter) {
    if (!selfMatches && searchName && (node.displayName || '').toLowerCase().includes(filter)) selfMatches = true;
    if (!selfMatches && searchPropId && (node.propId || '').toLowerCase().includes(filter)) selfMatches = true;
    if (!selfMatches && searchId && String(node.id).includes(filter)) selfMatches = true;
  }

  const keptChildren = [];
  for (const child of node.children || []) {
    const kept = filterNode(child, f, searchName, searchPropId, searchId);
    if (kept) keptChildren.push(kept);
  }

  if (!selfMatches && keptChildren.length === 0) return null;

  return {
    id: node.id,
    parentId: node.parentId,
    displayName: node.displayName,
    propId: node.propId,
    isExpanded: keptChildren.length > 0,
    children: keptChildren
  };
}

function filterRoots(roots, f, searchName, searchPropId, searchId) {
  const hasText = (f || '').trim().length > 0;
  if (!hasText) {
    return (roots || []).map(r => cloneNode(r, false));
  }
  return (roots || []).map(r => filterNode(r, f, searchName, searchPropId, searchId)).filter(Boolean);
}

function renderTree(container, roots, selectedId, side) {
  if (!roots || roots.length === 0) {
    container.innerHTML = `<div class="empty">No props.</div>`;
    return;
  }

  const renderNodeHtml = (n) => {
    const label = escapeHtml(formatNodeLabel(n));
    const selectedClass = (n.id === selectedId) ? ' node-label--selected' : '';
    const hasChildren = (n.children || []).length > 0;

    if (hasChildren) {
      const open = n.isExpanded ? ' open' : '';
      const kids = n.children.map(renderNodeHtml).join('');
      return `
        <details data-side="${side}" data-id="${n.id}"${open}>
          <summary><span class="node-label${selectedClass}">${label}</span></summary>
          <div class="children">${kids}</div>
        </details>
      `;
    }

    return `
      <div class="leaf" data-side="${side}" data-id="${n.id}">
        <span class="node-label${selectedClass}">${label}</span>
      </div>
    `;
  };

  container.innerHTML = roots.map(renderNodeHtml).join('');
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function setBusy(busy, rightStatus, busyMsg) {
  state.busy = busy;
  const overlay = $('busy');
  if (overlay) {
    overlay.classList.toggle('hidden', !busy);
    if (busy) {
      $('busyTitle').textContent = rightStatus || 'Working…';
      $('busyMsg').textContent = busyMsg || 'Please wait…';
    }
  }

  updateButtons();
}

let toastTimer = null;
function showToast(title, body, ms = 2600) {
  state.sessionLog.push({
    time: new Date(),
    title: title || 'Info',
    body: body || ''
  });
  if (!$('logModal')?.classList.contains('hidden')) {
    renderSessionLog();
  }

  const el = $('toast');
  if (!el) return;
  $('toastTitle').textContent = title || 'Info';
  $('toastBody').textContent = body || '';
  el.classList.add('show');
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    el.classList.remove('show');
  }, ms);
}

function openConfirmModal({ title, message, detail, okText = 'OK', cancelText = 'Cancel' }) {
  return new Promise((resolve) => {
    const modal = $('confirmModal');
    if (!modal) return resolve(false);

    $('confirmTitle').textContent = title || 'Confirm';
    $('confirmMsg').textContent = message || '';
    $('confirmDetail').textContent = detail || '';
    $('btnConfirmOk').textContent = okText;
    $('btnConfirmCancel').textContent = cancelText;

    const cleanup = () => {
      modal.removeEventListener('click', onBackdrop);
      window.removeEventListener('keydown', onKey);
      $('btnConfirmCancel').removeEventListener('click', onCancel);
      $('btnConfirmOk').removeEventListener('click', onOk);
      $('btnCloseConfirm').removeEventListener('click', onCloseX);
    };

    const close = (result) => {
      modal.classList.add('hidden');
      cleanup();
      resolve(!!result);
    };

    const onBackdrop = (ev) => {
      const t = ev.target;
      if (t && t.getAttribute && t.getAttribute('data-close') === '1') close(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close(false);
    };
    const onCancel = () => close(false);
    const onOk = () => close(true);
    const onCloseX = () => close(false);

    modal.addEventListener('click', onBackdrop);
    window.addEventListener('keydown', onKey);
    $('btnConfirmCancel').addEventListener('click', onCancel);
    $('btnConfirmOk').addEventListener('click', onOk);
    $('btnCloseConfirm').addEventListener('click', onCloseX);

    modal.classList.remove('hidden');
    $('btnConfirmCancel').focus();
  });
}

function renderSessionLog() {
  const list = $('logList');
  if (!list) return;

  const rows = [];

  if (state.appVersion) {
    rows.push({
      _meta: true,
      title: 'Version',
      body: `v${state.appVersion}`,
      time: null,
    });
  }

  if (!state.sessionLog.length) {
    if (!rows.length) {
      list.innerHTML = '<div class="empty">No messages yet.</div>';
    } else {
      list.innerHTML = rows.map(renderLogRow).join('');
    }
    return;
  }

  const items = [...state.sessionLog].reverse();
  for (const it of items) rows.push(it);

  list.innerHTML = rows.map(renderLogRow).join('');
}

function renderLogRow(it) {
  const ts = it.time ? (it.time instanceof Date ? it.time : new Date(it.time)) : null;
  const timeTxt = ts && !isNaN(ts.getTime()) ? ts.toLocaleTimeString() : '';
  const cls = it._meta ? 'logitem logitem--meta' : 'logitem';
  return `
      <div class="${cls}">
        <div class="logitem__top">
          <div class="logitem__title">${escapeHtml(it.title)}</div>
          <div class="logitem__time">${escapeHtml(timeTxt)}</div>
        </div>
        <div class="logitem__body">${escapeHtml(it.body || '')}</div>
      </div>
    `;
}

function updateButtons() {
  const canCopy = !state.busy && !!state.source.roomPath && !!state.target.roomPath && (state.source.roomPath !== state.target.roomPath) && !!state.source.selectedId;
  $('btnCopy').disabled = !canCopy;

  const canRestore = !state.busy && !!state.target.roomPath && !!state.target.selectedRestoreFile;
  $('btnRestore').disabled = !canRestore;

  $('btnRescan').disabled = state.busy || !state.ugcValid;
  $('ugcPickBtn').disabled = state.busy;
}

function syncRoomSelectConstraints() {
  const sSel = $('sourceSelect');
  const tSel = $('targetSelect');
  if (!sSel || !tSel) return;

  const sVal = sSel.value || '';
  const tVal = tSel.value || '';

  for (const opt of [...sSel.options]) {
    if (!opt.value) { opt.disabled = true; continue; }
    opt.disabled = !!tVal && opt.value === tVal;
  }
  for (const opt of [...tSel.options]) {
    if (!opt.value) { opt.disabled = true; continue; }
    opt.disabled = !!sVal && opt.value === sVal;
  }
}

function populateRoomSelect(selectEl, rooms, selectedRoomPath) {
  selectEl.innerHTML = '';

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Select room';
  placeholder.disabled = true;
  placeholder.hidden = (rooms || []).length > 0;
  placeholder.selected = !selectedRoomPath;
  selectEl.appendChild(placeholder);

  for (const r of rooms) {
    const opt = document.createElement('option');
    opt.value = r.roomPath;
    opt.textContent = `${r.roomName}  (${r.folderName})`;
    if (selectedRoomPath && selectedRoomPath === r.roomPath) opt.selected = true;
    selectEl.appendChild(opt);
  }
}

function populateEmptySelect(selectEl, label) {
  selectEl.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = label || 'Select room';
  placeholder.disabled = true;
  placeholder.selected = true;
  selectEl.appendChild(placeholder);
}

async function refreshRooms() {
  if (!state.ugcValid) {
    state.rooms = [];
    populateEmptySelect($('sourceSelect'), 'Select UGC folder');
    populateEmptySelect($('targetSelect'), 'Select UGC folder');
    await loadRoom('source', null);
    await loadRoom('target', null);
    syncRoomSelectConstraints();
    return;
  }

  const rooms = await es2.scanRooms(state.ugcRoot);
  state.rooms = rooms;
  if (!rooms || rooms.length === 0) {
    populateEmptySelect($('sourceSelect'), 'No rooms found');
    populateEmptySelect($('targetSelect'), 'No rooms found');
    await loadRoom('source', null);
    await loadRoom('target', null);
  } else {
    populateRoomSelect($('sourceSelect'), rooms, state.source.roomPath);
    populateRoomSelect($('targetSelect'), rooms, state.target.roomPath);
  }
  syncRoomSelectConstraints();
}

async function loadRoom(side, roomPath) {
  const st = state[side];
  st.selectedId = null;

  if (!roomPath) {
    st.roomPath = null;
    st.allRoots = [];
    st.propCount = 0;
    if (side === 'source') {
      renderTree($('sourceTree'), [], null, 'source');
    } else {
      renderTree($('targetTree'), [], null, 'target');
      await refreshRestorePoints();
    }
    updateButtons();
    return;
  }

  st.roomPath = roomPath;

  const roomName = state.rooms.find(r => r.roomPath === roomPath)?.roomName || 'Room';

  try {
    const data = await es2.loadRoom(roomPath);
    st.allRoots = data.roots || [];
    st.propCount = data.propCount || 0;

    const filtered = filterRoots(st.allRoots, st.filterText, st.searchName, st.searchPropId, st.searchId);

    if (side === 'source') {
      renderTree($('sourceTree'), filtered, st.selectedId, 'source');
      showToast('Source room loaded', `${roomName} (${st.propCount} props)`, 1600);
    } else {
      renderTree($('targetTree'), filtered, st.selectedId, 'target');
      await refreshRestorePoints();
      showToast('Target room loaded', `${roomName} (${st.propCount} props)`, 1600);
    }
  } catch (e) {
    console.error(e);
    alert(`Failed to load room:\n${e.message || e}`);
    showToast('Failed to load room', e.message || String(e), 3600);
  }

  updateButtons();
}

function applyFilter(side) {
  const st = state[side];
  const roots = filterRoots(st.allRoots, st.filterText, st.searchName, st.searchPropId, st.searchId);
  const container = side === 'source' ? $('sourceTree') : $('targetTree');
  renderTree(container, roots, st.selectedId, side);
}

function bindTreeSelection(container, side) {
  container.addEventListener('click', (ev) => {
    const label = ev.target.closest('.node-label');
    if (!label) return;

    const host = ev.target.closest('[data-id]');
    if (!host) return;

    const id = parseInt(host.getAttribute('data-id'), 10);
    if (!Number.isFinite(id)) return;

    state[side].selectedId = id;
    applyFilter(side);
    updateButtons();

    ev.preventDefault();
    ev.stopPropagation();
  });
}

async function refreshRestorePoints() {
  const roomPath = state.target.roomPath;
  state.target.restorePoints = [];
  state.target.selectedRestoreFile = null;

  const sel = $('restoreSelect');
  sel.innerHTML = '';

  if (!roomPath) {
    populateEmptySelect(sel, '—');
    $('btnRestore').disabled = true;
    return;
  }

  try {
    const pts = await es2.listRestorePoints(roomPath);
    state.target.restorePoints = pts || [];

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = pts.length ? '— Select restore point —' : 'No restore points';
    placeholder.disabled = true;
    placeholder.selected = true;
    placeholder.hidden = pts.length > 0;
    sel.appendChild(placeholder);

    for (const p of pts) {
      const opt = document.createElement('option');
      opt.value = p.filePath;
      const ts = new Date(p.timestamp);
      const nice = isNaN(ts.getTime()) ? '' : ts.toLocaleString();
      opt.textContent = `${p.displayName}  •  ${nice}`;
      sel.appendChild(opt);
    }

    if (pts.length) {
      sel.selectedIndex = 1;
      state.target.selectedRestoreFile = pts[0].filePath;
    }
  } catch (e) {
    console.error(e);
  }

  updateButtons();
}

async function doCopy() {
  if (state.busy) return;
  if (!state.source.roomPath || !state.target.roomPath || !state.source.selectedId) return;

  setBusy(true, 'Copying…');
  const targetParentId = state.target.selectedId || 0;

  const sourceName = state.rooms.find(r => r.roomPath === state.source.roomPath)?.roomName || 'Source';
  const targetName = state.rooms.find(r => r.roomPath === state.target.roomPath)?.roomName || 'Target';

  try {
    const res = await es2.copySubtree({
      sourceRoomPath: state.source.roomPath,
      targetRoomPath: state.target.roomPath,
      sourcePropId: state.source.selectedId,
      targetParentId,
    });

    state.target.allRoots = res.target.roots || [];
    state.target.propCount = res.target.propCount || countNodes(state.target.allRoots);
    applyFilter('target');

    state.target.restorePoints = res.restorePoints || [];
    await refreshRestorePoints();

    const missing = (res.assets?.missing || []).length;
    const assetsTxt = `Assets ${res.assets?.copied || 0}/${res.assets?.total || 0}${missing ? `, missing: ${missing}` : ''}`;
    showToast('Copy completed', `${assetsTxt}`);

  } catch (e) {
    console.error(e);
    alert(`Copy failed:\n${e.message || e}`);
    showToast('Copy failed', e.message || String(e), 3600);
  } finally {
    setBusy(false);
  }
}

async function doRestore() {
  if (state.busy) return;
  if (!state.target.roomPath || !state.target.selectedRestoreFile) return;

  const point = state.target.restorePoints.find(p => p.filePath === state.target.selectedRestoreFile);
  const label = point ? point.displayName : 'selected restore point';
  const ok = await openConfirmModal({
    title: 'Confirm restore',
    message: `Restore Room.room to ${label}?`,
    detail: 'This will overwrite the current Room.room and revert copied assets. This cannot be undone.',
    okText: 'Restore',
    cancelText: 'Cancel',
  });
  if (!ok) return;

  setBusy(true, 'Restoring…');

  try {
    const res = await es2.restoreTarget({
      targetRoomPath: state.target.roomPath,
      restoreFilePath: state.target.selectedRestoreFile,
    });

    state.target.allRoots = res.target.roots || [];
    state.target.propCount = res.target.propCount || countNodes(state.target.allRoots);
    state.target.selectedId = null;
    applyFilter('target');

    await refreshRestorePoints();
    showToast('Restore completed', `(${state.target.propCount} props)`);
  } catch (e) {
    console.error(e);
    alert(`Restore failed:\n${e.message || e}`);
    showToast('Restore failed', e.message || String(e), 3600);
  } finally {
    setBusy(false);
  }
}

async function init() {
  try {
    state.appVersion = await es2.getVersion();
  } catch {
    state.appVersion = '';
  }

  $('ugcPickBtn').textContent = 'Browse…';
  state.ugcRoot = '';
  state.ugcValid = false;
  populateEmptySelect($('sourceSelect'), 'Select UGC folder');
  populateEmptySelect($('targetSelect'), 'Select UGC folder');
  populateEmptySelect($('restoreSelect'), '—');
  showToast('ES2 Import Tool', 'Select the path to the UGC folder to begin.', 2600);
  updateButtons();

  async function validateUgcAndRefresh() {
    state.ugcValid = await es2.validateDir(state.ugcRoot);
    updateButtons();
    await refreshRooms();
    if (state.ugcValid) {
      showToast('Rooms found', `Found ${state.rooms.length} room(s). Pick source + target.`);
    } else {
      showToast('Invalid folder', state.ugcRoot ? 'Selected folder is not a valid UGC folder.' : 'Select the path to the UGC folder to begin.', 3200);
    }
  }

  $('btnRescan').addEventListener('click', async () => {
    if (!state.ugcValid) return;
    await refreshRooms();
    showToast('Rooms updated', `Found ${state.rooms.length} room(s). Pick source + target.`);
  });

  $('ugcPickBtn').addEventListener('click', async () => {
    const picked = await es2.chooseFolder({ title: 'Select Escape Simulator 2 UGC folder' });
    if (!picked) return;
    state.ugcRoot = picked;
    $('ugcPickBtn').textContent = picked;
    await validateUgcAndRefresh();
  });

  $('sourceSelect').addEventListener('change', async () => {
    $('sourceFilter').value = '';
    state.source.filterText = '';
    const next = $('sourceSelect').value;
    if (next && next === $('targetSelect').value) {
      $('sourceSelect').value = '';
      syncRoomSelectConstraints();
      await loadRoom('source', null);
      showToast('Selection not allowed', 'Source and target rooms must be different.', 2400);
      return;
    }
    await loadRoom('source', next);
    syncRoomSelectConstraints();
  });

  $('targetSelect').addEventListener('change', async () => {
    $('targetFilter').value = '';
    state.target.filterText = '';
    const next = $('targetSelect').value;
    if (next && next === $('sourceSelect').value) {
      $('targetSelect').value = '';
      syncRoomSelectConstraints();
      await loadRoom('target', null);
      showToast('Selection not allowed', 'Source and target rooms must be different.', 2400);
      return;
    }
    await loadRoom('target', next);
    syncRoomSelectConstraints();
  });

  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
      const ae = document.activeElement;
      const allow = ae === $('sourceFilter') || ae === $('targetFilter');
      if (!allow) e.preventDefault();
    }
  }, true);

  $('sourceFilter').addEventListener('input', () => {
    state.source.filterText = $('sourceFilter').value;
    applyFilter('source');
  });
  $('targetFilter').addEventListener('input', () => {
    state.target.filterText = $('targetFilter').value;
    applyFilter('target');
  });

  for (const [id, key] of [['sourceSearchName','searchName'], ['sourceSearchPropId','searchPropId'], ['sourceSearchId','searchId']]) {
    $(id).addEventListener('change', () => {
      state.source[key] = $(id).checked;
      applyFilter('source');
    });
  }

  for (const [id, key] of [['targetSearchName','searchName'], ['targetSearchPropId','searchPropId'], ['targetSearchId','searchId']]) {
    $(id).addEventListener('change', () => {
      state.target[key] = $(id).checked;
      applyFilter('target');
    });
  }

  bindTreeSelection($('sourceTree'), 'source');
  bindTreeSelection($('targetTree'), 'target');

  $('btnCopy').addEventListener('click', doCopy);

  const closeLog = () => $('logModal')?.classList.add('hidden');
  $('btnLog')?.addEventListener('click', () => {
    renderSessionLog();
    $('logModal')?.classList.remove('hidden');
  });
  $('btnCloseLog')?.addEventListener('click', closeLog);
  $('logModal')?.addEventListener('click', (ev) => {
    const target = ev.target;
    if (target && target.getAttribute && target.getAttribute('data-close') === '1') closeLog();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeLog();
  });

  $('restoreSelect').addEventListener('change', () => {
    state.target.selectedRestoreFile = $('restoreSelect').value || null;
    updateButtons();
  });

  $('btnRestore').addEventListener('click', doRestore);

  updateButtons();
}

window.addEventListener('DOMContentLoaded', init);
