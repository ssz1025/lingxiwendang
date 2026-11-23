const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  info: () => ipcRenderer.invoke('app:info'),

  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (patch) => ipcRenderer.invoke('config:set', patch),
  chooseRoot: () => ipcRenderer.invoke('root:choose'),
  addKb: () => ipcRenderer.invoke('kb:add'),
  switchKb: (kbPath) => ipcRenderer.invoke('kb:switch', kbPath),
  removeKb: (kbPath) => ipcRenderer.invoke('kb:remove', kbPath),

  getTree: () => ipcRenderer.invoke('kb:tree'),
  search: (query) => ipcRenderer.invoke('kb:search', query),
  retrieve: (query, options) => ipcRenderer.invoke('kb:retrieve', query, options),

  readFile: (filePath) => ipcRenderer.invoke('file:read', filePath),
  writeFile: (filePath, content) => ipcRenderer.invoke('file:write', { filePath, content }),
  createDoc: (dir, name, content) => ipcRenderer.invoke('file:create', { dir, name, content }),
  createFolder: (dir, name) => ipcRenderer.invoke('folder:create', { dir, name }),
  renameNode: (nodePath, newName) => ipcRenderer.invoke('node:rename', { nodePath, newName }),
  deleteNode: (nodePath) => ipcRenderer.invoke('node:delete', nodePath),
  saveAsset: (payload) => ipcRenderer.invoke('asset:save', payload),
  readClipboardImage: () => ipcRenderer.invoke('clipboard:readImage'),

  saveDialog: (payload) => ipcRenderer.invoke('dialog:save', payload),
  writePath: (filePath, content) => ipcRenderer.invoke('file:writePath', { filePath, content }),
  exportZip: () => ipcRenderer.invoke('export:zip'),

  openPath: (target) => ipcRenderer.invoke('shell:openPath', target),
  showItem: (target) => ipcRenderer.invoke('shell:showItem', target),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),

  aiChat: (payload) => ipcRenderer.invoke('ai:chat', payload),
  aiAbort: (id) => ipcRenderer.invoke('ai:abort', id),
  aiTest: () => ipcRenderer.invoke('ai:test'),
  onAiEvent: (callback) => {
    const handler = (_event, data) => callback(data)
    ipcRenderer.on('ai:event', handler)
    return () => ipcRenderer.removeListener('ai:event', handler)
  }
})
