'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const LISTEN = new Set([
  'tab:open', 'shield:update', 'permission:request', 'download:update', 'window:state', 'shortcut',
  'settings:changed', 'bookmarks:changed', 'mail:unread', 'account:changed',
  'ui:toast', 'ai:ask', 'ai:close-tab'
]);

contextBridge.exposeInMainWorld('gipUI', {
  invoke: (channel, ...args) => {
    if (!String(channel).startsWith('ui:')) throw new Error('Canal refusé');
    return ipcRenderer.invoke(channel, ...args);
  },
  on: (channel, fn) => {
    if (!LISTEN.has(channel)) throw new Error('Canal refusé');
    const h = (e, data) => fn(data);
    ipcRenderer.on(channel, h);
    return () => ipcRenderer.removeListener(channel, h);
  },
  preloadPath: null
});
