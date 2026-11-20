import { contextBridge, ipcRenderer } from 'electron'
import { API_METHODS, EVENTS, type WindowApi } from '@shared/api'

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: Electron.IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = Object.fromEntries(
  API_METHODS.map((name) => [name, (...args: unknown[]) => ipcRenderer.invoke(name, ...args)])
) as unknown as WindowApi

api.onLiveUpdate = (cb) => subscribe(EVENTS.liveUpdate, cb)
api.onDownloadProgress = (cb) => subscribe(EVENTS.downloadProgress, cb)

contextBridge.exposeInMainWorld('api', api)
