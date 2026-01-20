import React, { useEffect, useMemo, useRef, useState } from "react";

type KafkaMsg = {
    topic: string;
    partition: number;
    offset: string;
    timestamp: number | null;
    key: string;
    value: string;
    headers: Record<string, string>;
};

declare global {
    interface Window {
        kafkaAPI: {
            listTopics: (brokers: string) => Promise<string[]>;
            start: (cfg: any) => Promise<{ ok: boolean }>;
            stop: () => Promise<{ ok: boolean }>;
            onMessage: (cb: (msg: KafkaMsg) => void) => void;
        };
    }
}

const MAX_MESSAGES = 500;
const UI_FLUSH_MS = 120;

export default function App() {
    const [brokers, setBrokers] = useState("localhost:29092");
    const [topics, setTopics] = useState<string[]>([]);
    const [topic, setTopic] = useState("");
    const [groupId, setGroupId] = useState("kafka-desktop-viewer");
    const [fromBeginning, setFromBeginning] = useState(false);
    const [mask, setMask] = useState(true);
    const [status, setStatus] = useState<"stopped" | "running" | "starting" | "error">("stopped");

    const [search, setSearch] = useState("");
    const [selected, setSelected] = useState<KafkaMsg | null>(null);

    const [messages, setMessages] = useState<KafkaMsg[]>([]);
    const queueRef = useRef<KafkaMsg[]>([]);
    const timerRef = useRef<number | null>(null);

    useEffect(() => {
        window.kafkaAPI.onMessage((msg) => {
            queueRef.current.push(msg);
        });

        timerRef.current = window.setInterval(() => {
            if (queueRef.current.length === 0) return;

            setMessages((prev) => {
                const merged = prev.concat(queueRef.current);
                queueRef.current = [];
                if (merged.length <= MAX_MESSAGES) return merged;
                return merged.slice(merged.length - MAX_MESSAGES);
            });
        }, UI_FLUSH_MS);

        return () => {
            if (timerRef.current) window.clearInterval(timerRef.current);
        };
    }, []);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return messages;
        return messages.filter((m) => `${m.key} ${m.value}`.toLowerCase().includes(q));
    }, [messages, search]);

    async function refreshTopics() {
        try {
            const list = await window.kafkaAPI.listTopics(brokers);
            setTopics(list);
            if (!topic && list.length) setTopic(list[0]);
        } catch (e) {
            console.error(e);
            setTopics([]);
        }
    }

    async function start() {
        if (!brokers.trim() || !topic.trim() || !groupId.trim()) return;
        setSelected(null);
        setMessages([]);
        queueRef.current = [];
        setStatus("starting");

        try {
            await window.kafkaAPI.start({
                brokers,
                topic,
                groupId,
                fromBeginning,
                mask
            });
            setStatus("running");
        } catch (e) {
            console.error(e);
            setStatus("error");
        }
    }

    async function stop() {
        await window.kafkaAPI.stop();
        setStatus("stopped");
    }

    return (
        <div className="wrap">
            <header className="header">
                <div>
                    <h1>Kafka Desktop Viewer</h1>
                    <div className="sub">Local (PLAINTEXT) • bounded memory • masking default ON</div>
                </div>
                <div className={`pill ${status}`}>{status}</div>
            </header>

            <section className="card">
                <div className="row">
                    <label>Brokers</label>
                    <input value={brokers} onChange={(e) => setBrokers(e.target.value)} />
                    <button onClick={refreshTopics}>Load topics</button>
                </div>

                <div className="row">
                    <label>Topic</label>
                    <select value={topic} onChange={(e) => setTopic(e.target.value)}>
                        <option value="" disabled>
                            {topics.length ? "Select a topic" : "Load topics first"}
                        </option>
                        {topics.map((t) => (
                            <option key={t} value={t}>
                                {t}
                            </option>
                        ))}
                    </select>

                    <label>Group</label>
                    <input value={groupId} onChange={(e) => setGroupId(e.target.value)} />

                    <label>Offset</label>
                    <select value={fromBeginning ? "earliest" : "latest"} onChange={(e) => setFromBeginning(e.target.value === "earliest")}>
                        <option value="latest">latest</option>
                        <option value="earliest">earliest</option>
                    </select>

                    <label className="check">
                        <input type="checkbox" checked={mask} onChange={(e) => setMask(e.target.checked)} />
                        Mask sensitive strings
                    </label>

                    <button className="primary" onClick={start} disabled={status === "running" || status === "starting"}>
                        Start
                    </button>
                    <button onClick={stop} disabled={status !== "running"}>
                        Stop
                    </button>
                </div>

                <div className="row">
                    <label>Search</label>
                    <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="filter key/value..." />
                    <button
                        onClick={() => {
                            setMessages([]);
                            queueRef.current = [];
                            setSelected(null);
                        }}
                    >
                        Clear
                    </button>
                    <div className="hint">Showing {filtered.length} / {messages.length} (max {MAX_MESSAGES})</div>
                </div>
            </section>

            <main className="grid">
                <section className="card list">
                    <div className="tableHead">
                        <div>Topic</div>
                        <div>Part</div>
                        <div>Offset</div>
                        <div>Time</div>
                        <div>Key</div>
                        <div>Value (preview)</div>
                    </div>

                    <div className="rows">
                        {[...filtered].reverse().map((m, idx) => {
                            const ts = m.timestamp ? new Date(m.timestamp).toLocaleString() : "";
                            const preview = m.value.length > 140 ? m.value.slice(0, 140) + "…" : m.value;
                            const isSel = selected?.offset === m.offset && selected?.partition === m.partition && selected?.topic === m.topic;
                            return (
                                <button
                                    key={`${m.topic}-${m.partition}-${m.offset}-${idx}`}
                                    className={`rowBtn ${isSel ? "selected" : ""}`}
                                    onClick={() => setSelected(m)}
                                >
                                    <div>{m.topic}</div>
                                    <div>{m.partition}</div>
                                    <div>{m.offset}</div>
                                    <div>{ts}</div>
                                    <div className="mono">{m.key}</div>
                                    <div className="mono">{preview}</div>
                                </button>
                            );
                        })}
                    </div>
                </section>

                <section className="card detail">
                    <h2>Message details</h2>
                    {!selected ? (
                        <div className="empty">Click a message to inspect it.</div>
                    ) : (
                        <>
                            <div className="kv">
                                <div><b>Topic:</b> {selected.topic}</div>
                                <div><b>Partition:</b> {selected.partition}</div>
                                <div><b>Offset:</b> {selected.offset}</div>
                                <div><b>Timestamp:</b> {selected.timestamp ? new Date(selected.timestamp).toISOString() : ""}</div>
                            </div>

                            <div className="block">
                                <div className="blockTitle">Key</div>
                                <pre className="mono pre">{selected.key}</pre>
                            </div>

                            <div className="block">
                                <div className="blockTitle">Value</div>
                                <pre className="mono pre">{tryPrettyJson(selected.value)}</pre>
                            </div>

                            <div className="block">
                                <div className="blockTitle">Headers</div>
                                <pre className="mono pre">{JSON.stringify(selected.headers, null, 2)}</pre>
                            </div>
                        </>
                    )}
                </section>
            </main>
        </div>
    );
}

function tryPrettyJson(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return "";
    if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return value;
    try {
        return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
        return value;
    }
}