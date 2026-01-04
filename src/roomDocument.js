const fs = require('fs');
const path = require('path');
const JSON5 = require('json5');

class PropRecord {
  constructor(jsonObj) {
    this.json = jsonObj;
    this.id = 0;
    this.parentId = 0;
    this.displayName = '(Unnamed)';
    this.propId = null;
    this.children = [];
  }
}

class RoomDocument {
  constructor(roomPath, rootObj, propsArray, rootRecords, recordsMap, maxId) {
    this.roomPath = roomPath;
    this.root = rootObj;
    this.propsArray = propsArray;
    this._rootRecords = rootRecords;
    this._records = recordsMap;
    this._maxId = maxId;
  }

  static loadSync(roomPath) {
    const text = fs.readFileSync(roomPath, 'utf8');
    const rootObj = JSON5.parse(text);
    return RoomDocument._createFromRoot(roomPath, rootObj);
  }

  static _createFromRoot(roomPath, rootObj) {
    if (!rootObj || typeof rootObj !== 'object' || Array.isArray(rootObj)) {
      throw new Error('Room file is not a JSON object.');
    }

    let propsArray = rootObj.props;
    if (!Array.isArray(propsArray)) {
      propsArray = [];
      rootObj.props = propsArray;
    }

    const records = new Map();
    const flat = [];
    let maxId = 0;

    for (const node of propsArray) {
      if (!node || typeof node !== 'object' || Array.isArray(node)) continue;
      const rec = RoomDocument._createRecordFromJson(node);
      records.set(rec.id, rec);
      flat.push(rec);
      if (rec.id > maxId) maxId = rec.id;
    }

    const roots = [];
    for (const rec of flat) {
      if (rec.parentId !== 0 && records.has(rec.parentId)) {
        records.get(rec.parentId).children.push(rec);
      } else {
        roots.push(rec);
      }
    }

    return new RoomDocument(roomPath, rootObj, propsArray, roots, records, maxId);
  }

  propsCount() {
    return this._records.size;
  }

  _generateNewId() {
    this._maxId += 1;
    return this._maxId;
  }

  static _getInt(obj, propertyName) {
    const v = obj?.[propertyName];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const nested = v.value;
      if (typeof nested === 'number') return nested;
    }
    if (typeof v === 'number') return v;
    return 0;
  }

  static _getString(obj, propertyName, fallback) {
    const v = obj?.[propertyName];
    if (typeof v === 'string' && v.length) return v;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const nested = v.value;
      if (typeof nested === 'string' && nested.length) return nested;
    }
    return fallback;
  }

  static _setInt(obj, propertyName, value) {
    let nested = obj[propertyName];
    if (!nested || typeof nested !== 'object' || Array.isArray(nested)) {
      nested = {};
      obj[propertyName] = nested;
    }
    nested.value = value;
  }

  static _createRecordFromJson(obj) {
    const rec = new PropRecord(obj);
    rec.id = RoomDocument._getInt(obj, 'ID');
    rec.parentId = RoomDocument._getInt(obj, 'parentID');
    rec.displayName = RoomDocument._getString(obj, 'displayName', '(Unnamed)') || '(Unnamed)';
    rec.propId = RoomDocument._getString(obj, 'propID', null);
    return rec;
  }

  createPropNodesSnapshot(expandParents = false) {
    const cloneToNode = (record, expand) => {
      const node = {
        id: record.id,
        parentId: record.parentId,
        displayName: record.displayName,
        propId: record.propId,
        isExpanded: !!expand,
        children: []
      };
      for (const child of record.children) {
        node.children.push(cloneToNode(child, expand));
      }
      return node;
    };

    return this._rootRecords.map(r => cloneToNode(r, expandParents));
  }

  getRecord(id) {
    return this._records.get(id) || null;
  }

  insertSubtree(sourceRootRecord, targetParentId) {
    if (!sourceRootRecord) throw new Error('sourceRootRecord missing');

    let parentRecord = null;
    if (targetParentId !== 0) {
      parentRecord = this._records.get(targetParentId);
      if (!parentRecord) throw new Error('The selected target parent no longer exists.');
    }

    let inserted = 0;
    const idMap = new Map();
    const clonedJsonNodes = [];

    const cloneRecursive = (source, parentId, parentRec) => {
      const cloneJson = deepClone(source.json);
      const cloneRecord = RoomDocument._createRecordFromJson(cloneJson);
      cloneRecord.id = this._generateNewId();
      cloneRecord.parentId = parentId;
      cloneRecord.displayName = source.displayName;
      cloneRecord.propId = source.propId;

      RoomDocument._setInt(cloneJson, 'ID', cloneRecord.id);
      RoomDocument._setInt(cloneJson, 'parentID', parentId);

      this.propsArray.push(cloneJson);
      this._records.set(cloneRecord.id, cloneRecord);

      idMap.set(source.id, cloneRecord.id);
      clonedJsonNodes.push(cloneJson);

      if (parentRec) {
        parentRec.children.push(cloneRecord);
      } else {
        this._rootRecords.push(cloneRecord);
      }

      inserted++;
      for (const child of source.children) {
        cloneRecursive(child, cloneRecord.id, cloneRecord);
      }
    };

    cloneRecursive(sourceRootRecord, targetParentId || 0, parentRecord);
    RoomDocument._fixLinkedPropReferences(clonedJsonNodes, idMap);
    return inserted;
  }

  saveSync(destinationPath, indented = true) {
    const text = indented ? JSON.stringify(this.root, null, 2) : JSON.stringify(this.root);
    fs.writeFileSync(destinationPath, text, 'utf8');
  }

  getAssetPathsForSubtree(rootId) {
    const record = this._records.get(rootId);
    if (!record) return [];

    const set = new Set();
    RoomDocument._collectAssetPathsRecord(record, set);
    this._expandMaterialDependencies(set);
    return [...set];
  }

  static _collectAssetPathsRecord(record, sink) {
    RoomDocument._collectAssetPathsNode(record.json, sink, false, null);
    for (const child of record.children) RoomDocument._collectAssetPathsRecord(child, sink);
  }

  static _shouldIgnoreProperty(name) {
    if (!name) return false;
    const n = String(name).toLowerCase();
    return n === 'propid' || n === 'sourceprefabid' || n === 'sourcematerialpath';
  }

  static _tryAddScriptAsset(propertyName, value, sink) {
    if (!propertyName || String(propertyName).toLowerCase() !== 'scriptlocation') return false;
    if (typeof value !== 'string' || !value.trim()) return false;
    const fileName = value.toLowerCase().endsWith('.lua') ? value : value + '.lua';
    sink.add(RoomDocument._normalizeAssetPath(fileName));
    return true;
  }

  static _normalizeAssetPath(p) {
    let trimmed = String(p || '').trim();
    trimmed = trimmed.replace(/^[/\\]+/, '');
    return trimmed.replace(/\\/g, '/');
  }

  static _isNumericExtension(ext) {
    for (let i = 1; i < ext.length; i++) {
      if (ext[i] < '0' || ext[i] > '9') return false;
    }
    return true;
  }

  static get KnownAssetExtensions() {
    return new Set([
      'gltf', 'glb', 'png', 'jpg', 'jpeg', 'bmp', 'tga', 'tif', 'tiff',
      'dds', 'exr', 'hdr', 'wav', 'mp3', 'ogg', 'flac', 'es2mat',
      'json', 'mtl', 'obj', 'fbx'
    ]);
  }

  static _looksLikeAssetPath(value) {
    if (!value || !String(value).trim()) return false;
    const trimmed = String(value).trim();
    const hasSep = trimmed.includes('/') || trimmed.includes('\\');

    const ext = path.extname(trimmed);
    if (!ext || ext.length <= 1 || ext.length > 8) return false;
    if (RoomDocument._isNumericExtension(ext)) return false;

    if (hasSep) return true;
    return RoomDocument.KnownAssetExtensions.has(ext.slice(1).toLowerCase());
  }

  static _collectAssetPathsNode(node, sink, ignorePaths, propertyName) {
    if (node === null || node === undefined) return;

    if (Array.isArray(node)) {
      for (const child of node) RoomDocument._collectAssetPathsNode(child, sink, ignorePaths, propertyName);
      return;
    }

    if (typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        const childIgnore = ignorePaths || RoomDocument._shouldIgnoreProperty(k);
        RoomDocument._collectAssetPathsNode(v, sink, childIgnore, k);
      }
      return;
    }

    if (ignorePaths) return;

    if (RoomDocument._tryAddScriptAsset(propertyName, node, sink)) return;

    if (typeof node === 'string' && RoomDocument._looksLikeAssetPath(node)) {
      sink.add(RoomDocument._normalizeAssetPath(node));
    }
  }

  _expandMaterialDependencies(assetSet) {
    const roomDir = path.dirname(this.roomPath);
    if (!roomDir || assetSet.size === 0) return;

    const enqueued = new Set();
    const processed = new Set();
    const queue = [];

    for (const p of assetSet) {
      if (RoomDocument._isMaterialFile(p) && !enqueued.has(p.toLowerCase())) {
        enqueued.add(p.toLowerCase());
        queue.push(p);
      }
    }

    while (queue.length) {
      const relPath = queue.shift();
      const key = relPath.toLowerCase();
      if (processed.has(key)) continue;
      processed.add(key);

      const normalizedOs = relPath.replace(/\//g, path.sep);
      const fullPath = path.join(roomDir, normalizedOs);
      if (!fs.existsSync(fullPath)) continue;

      try {
        const matText = fs.readFileSync(fullPath, 'utf8');
        const matObj = JSON5.parse(matText);
        if (!matObj || typeof matObj !== 'object') continue;

        const discovered = new Set();
        RoomDocument._collectAssetPathsNode(matObj, discovered, false, null);

        for (const candidate of discovered) {
          if (RoomDocument._isMaterialFile(candidate)) {
            if (!assetSet.has(candidate)) assetSet.add(candidate);
            const ckey = candidate.toLowerCase();
            if (!enqueued.has(ckey)) {
              enqueued.add(ckey);
              queue.push(candidate);
            }
            continue;
          }

          const resolved = RoomDocument._resolveMaterialAssetPath(candidate, relPath, roomDir);
          assetSet.add(resolved);
        }
      } catch {
        // ignore malformed material files
      }
    }
  }

  static _isMaterialFile(p) {
    return String(p || '').toLowerCase().endsWith('.es2mat');
  }

  static _containsPathSeparator(v) {
    return String(v).includes('/') || String(v).includes('\\');
  }

  static _toAbsolute(roomDir, relativeNormalizedPath) {
    const osPath = relativeNormalizedPath.replace(/\//g, path.sep);
    return path.join(roomDir, osPath);
  }

  static _resolveMaterialAssetPath(assetPath, materialRelativePath, roomDir) {
    if (RoomDocument._containsPathSeparator(assetPath)) return RoomDocument._normalizeAssetPath(assetPath);

    const matDir = path.dirname(materialRelativePath.replace(/\//g, path.sep));
    if (matDir && matDir !== '.') {
      const candidate = RoomDocument._normalizeAssetPath(path.join(matDir, assetPath));
      if (fs.existsSync(RoomDocument._toAbsolute(roomDir, candidate))) return candidate;
    }

    const customModelsCandidate = RoomDocument._normalizeAssetPath(path.join('_CustomModels', assetPath));
    if (fs.existsSync(RoomDocument._toAbsolute(roomDir, customModelsCandidate))) return customModelsCandidate;

    if (matDir && matDir !== '.') return RoomDocument._normalizeAssetPath(path.join(matDir, assetPath));
    return assetPath;
  }

  // ---------------------- Link Fixups ----------------------

  static _fixLinkedPropReferences(clonedNodes, idMap) {
    for (const node of clonedNodes) {
      RoomDocument._updateLinkReferences(node, idMap);
    }
  }

  static _updateLinkReferences(node, idMap) {
    if (node === null || node === undefined) return;

    if (Array.isArray(node)) {
      if (!RoomDocument._tryProcessLinkArray(node, idMap)) {
        for (const child of node) RoomDocument._updateLinkReferences(child, idMap);
      }
      return;
    }

    if (typeof node === 'object') {
      for (const v of Object.values(node)) RoomDocument._updateLinkReferences(v, idMap);
      return;
    }
  }

  static _tryGetLinkId(obj) {
    if (!obj || typeof obj !== 'object') return null;
    const v = obj.value;
    if (typeof v === 'number') return v;
    if (v && typeof v === 'object' && typeof v.value === 'number') return v.value;
    return null;
  }

  static _tryProcessLinkArray(arr, idMap) {
    if (!Array.isArray(arr) || arr.length === 0) return false;

    const linkObjects = [];
    for (const item of arr) {
      if (item && typeof item === 'object' && !Array.isArray(item) && RoomDocument._tryGetLinkId(item) !== null) {
        linkObjects.push(item);
        continue;
      }
      return false;
    }

    // Rebuild array, only keeping IDs that were remapped.
    arr.length = 0;
    for (const obj of linkObjects) {
      const oldId = RoomDocument._tryGetLinkId(obj);
      if (oldId === null) continue;
      const newId = idMap.get(oldId);
      if (!newId) continue;
      obj.value = newId;
      arr.push(obj);
    }

    return true;
  }
}

function deepClone(obj) {
  // Fast enough and keeps plain JSON structures.
  return JSON.parse(JSON.stringify(obj));
}

module.exports = RoomDocument;
