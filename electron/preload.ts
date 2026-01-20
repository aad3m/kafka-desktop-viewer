import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("kafkaAPI", {
    listTopics: (brokers: string) => ipcRenderer.invoke("kafka:listTopics", brokers),
    start: (cfg: any) => ipcRenderer.invoke("kafka:start", cfg),
    stop: () => ipcRenderer.invoke("kafka:stop"),
    onMessage: (cb: (msg: any) => void) => ipcRenderer.on("kafka:message", (_e, msg) => cb(msg))
});