import { app, BrowserWindow, ipcMain } from "electron";
import * as path from "path";
import { Kafka } from "kafkajs";

let win: BrowserWindow | null = null;

type StartConfig = {
    brokers: string;        // "localhost:29092"
    topic: string;
    groupId: string;
    fromBeginning: boolean; // earliest=true
    mask: boolean;          // masking on/off
};

type KafkaMsg = {
    topic: string;
    partition: number;
    offset: string;
    timestamp: number | null;
    key: string;
    value: string;
    headers: Record<string, string>;
};

let consumer: ReturnType<Kafka["consumer"]> | null = null;
let running = false;

function maskText(input: string): string {
    // conservative masking (good enough for “local for now”)
    // masks emails + long digit runs (IDs) without being overly destructive
    const email = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
    const longDigits = /\b\d{7,}\b/g;
    return input.replace(email, "[REDACTED_EMAIL]").replace(longDigits, "[REDACTED_NUM]");
}

function createWindow() {
    win = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false
        }
    });

    const devUrl = process.env.VITE_DEV_SERVER_URL || "http://localhost:5173";
    if (!app.isPackaged) {
        win.loadURL(devUrl);
    } else {
        win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
    }
}

async function stopConsumer() {
    running = false;
    if (consumer) {
        try {
            await consumer.stop();
            await consumer.disconnect();
        } catch {
            // ignore shutdown noise
        }
        consumer = null;
    }
}

ipcMain.handle("kafka:listTopics", async (_evt, brokers: string) => {
    const kafka = new Kafka({
        clientId: "kafka-desktop-viewer-admin",
        brokers: brokers.split(",").map((b) => b.trim())
    });
    const admin = kafka.admin();
    await admin.connect();
    try {
        const topics = await admin.listTopics();
        return topics.sort();
    } finally {
        await admin.disconnect();
    }
});

ipcMain.handle("kafka:start", async (_evt, cfg: StartConfig) => {
    await stopConsumer();

    const kafka = new Kafka({
        clientId: "kafka-desktop-viewer",
        brokers: cfg.brokers.split(",").map((b) => b.trim())
    });

    consumer = kafka.consumer({ groupId: cfg.groupId });
    await consumer.connect();
    await consumer.subscribe({ topic: cfg.topic, fromBeginning: cfg.fromBeginning });

    running = true;

    await consumer.run({
        eachMessage: async ({ topic, partition, message }) => {
            if (!running || !win) return;

            const key = message.key ? message.key.toString("utf8") : "";
            const value = message.value ? message.value.toString("utf8") : "";

            const headers: Record<string, string> = {};
            if (message.headers) {
                for (const [k, v] of Object.entries(message.headers)) {
                    headers[k] = v ? v.toString("utf8") : "";
                }
            }

            const out: KafkaMsg = {
                topic,
                partition,
                offset: message.offset,
                timestamp: message.timestamp ? Number(message.timestamp) : null,
                key: cfg.mask ? maskText(key) : key,
                value: cfg.mask ? maskText(value) : value,
                headers: cfg.mask
                    ? Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, maskText(v)]))
                    : headers
            };

            // Never log payloads to console by default
            win.webContents.send("kafka:message", out);
        }
    });

    return { ok: true };
});

ipcMain.handle("kafka:stop", async () => {
    await stopConsumer();
    return { ok: true };
});

app.whenReady().then(() => {
    createWindow();

    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on("window-all-closed", async () => {
    await stopConsumer();
    if (process.platform !== "darwin") app.quit();
});