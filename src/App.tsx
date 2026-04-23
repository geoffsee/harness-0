import {useEffect, useState} from "react";
import {
    Background,
    BackgroundVariant,
    BaseEdge,
    Controls,
    EdgeLabelRenderer,
    Handle,
    MarkerType,
    Panel,
    ReactFlow,
    type Edge,
    type EdgeProps,
    type Node,
    type NodeProps,
    Position,
    getSmoothStepPath,
} from "@xyflow/react";
import {onSnapshot} from "mobx-state-tree";
import {meshNetwork} from "./meshNetwork";

type PeerNodeData = {
    label: string;
    trustScore: number;
    sentCount: number;
    inboxCount: number;
    latestMessage?: string;
    role: string;
    health: string;
};

type MeshSnapshot = {
    nodes: Node<PeerNodeData>[];
    edges: Edge[];
    packets: Array<{
        id: string;
        from: string;
        to: string;
        route: string[];
        digest: string;
        status: string;
    }>;
    events: string[];
    deliveredPackets: number;
};

type PacketEdgeData = {
    label?: string;
    labelColor: string;
    stroke: string;
};

function PacketEdge({
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    markerEnd,
    data,
}: EdgeProps<Edge<PacketEdgeData>>) {
    const [path, labelX, labelY] = getSmoothStepPath({
        sourceX,
        sourceY,
        targetX,
        targetY,
        sourcePosition,
        targetPosition,
    });

    return (
        <>
            <BaseEdge id={id} path={path} markerEnd={markerEnd} style={{stroke: data?.stroke, strokeWidth: 3.5}}/>
            {data?.label ? (
                <EdgeLabelRenderer>
                    <div
                        style={{
                            position: "absolute",
                            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
                            background: "#141414",
                            color: data.labelColor,
                            padding: "4px 6px",
                            borderRadius: 4,
                            fontSize: 10,
                            fontWeight: 700,
                            lineHeight: 1,
                            pointerEvents: "none",
                            whiteSpace: "nowrap",
                        }}
                    >
                        {data.label}
                    </div>
                </EdgeLabelRenderer>
            ) : null}
        </>
    );
}

function PeerNode({data}: NodeProps<Node<PeerNodeData>>) {
    return (
        <div
            style={{
                width: 250,
                padding: 14,
                borderRadius: 10,
                border: "1px solid #223849",
                background: "linear-gradient(180deg, #0d1821 0%, #0a131a 100%)",
                color: "#d9e6ec",
                boxShadow: "0 10px 24px rgba(0, 0, 0, 0.28)",
                fontFamily: '"IBM Plex Sans", "Avenir Next", sans-serif',
            }}
        >
            <Handle type="target" position={Position.Left} style={{opacity: 0}}/>
            <Handle type="target" position={Position.Right} style={{opacity: 0}}/>
            <Handle type="source" position={Position.Left} style={{opacity: 0}}/>
            <Handle type="source" position={Position.Right} style={{opacity: 0}}/>
            <div style={{display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8}}>
                <div>
                    <div style={{fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "#6ca2bb"}}>
                        {data.role}
                    </div>
                    <div style={{marginTop: 3, fontSize: 18, fontWeight: 700}}>{data.label}</div>
                </div>
                <div
                    style={{
                        padding: "4px 8px",
                        borderRadius: 999,
                        border: "1px solid #1f4d40",
                        background: "rgba(41, 161, 116, 0.12)",
                        color: "#7ce3b7",
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                    }}
                >
                    {data.health}
                </div>
            </div>
            <div style={{display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginTop: 12}}>
                <div style={nodeMetricStyle}>
                    <div style={nodeMetricLabelStyle}>Trust</div>
                    <div style={nodeMetricValueStyle}>{(data.trustScore * 100).toFixed(0)}%</div>
                </div>
                <div style={nodeMetricStyle}>
                    <div style={nodeMetricLabelStyle}>Sent</div>
                    <div style={nodeMetricValueStyle}>{data.sentCount}</div>
                </div>
                <div style={nodeMetricStyle}>
                    <div style={nodeMetricLabelStyle}>Inbox</div>
                    <div style={nodeMetricValueStyle}>{data.inboxCount}</div>
                </div>
            </div>
            <div
                style={{
                    marginTop: 12,
                    paddingTop: 10,
                    borderTop: "1px solid rgba(108, 162, 187, 0.18)",
                    fontSize: 12,
                    lineHeight: 1.45,
                    color: data.latestMessage ? "#d9e6ec" : "#7090a0",
                }}
            >
                {data.latestMessage ?? "No inbound packet content"}
            </div>
        </div>
    );
}

const nodeTypes = {peer: PeerNode};
const edgeTypes = {packet: PacketEdge};

const peerMeta: Record<string, { position: { x: number; y: number }; role: string }> = {
    alpha: {position: {x: 310, y: 120}, role: "EDGE RELAY A"},
    beta: {position: {x: 700, y: 120}, role: "EDGE RELAY B"},
    gamma: {position: {x: 700, y: 430}, role: "CLIENT NODE"},
    delta: {position: {x: 90, y: 430}, role: "BRIDGE NODE"},
};

function createGraph(): MeshSnapshot {
    const nodes = meshNetwork.peerList.map((peer) => ({
        id: peer.id,
        type: "peer",
        position: peerMeta[peer.id]?.position ?? {x: 0, y: 0},
        sourcePosition: peer.id === "alpha" || peer.id === "delta" ? Position.Right : Position.Left,
        targetPosition: peer.id === "alpha" || peer.id === "delta" ? Position.Right : Position.Left,
        data: {
            label: peer.label,
            trustScore: peer.trustScore,
            sentCount: peer.sentCount,
            inboxCount: peer.inbox.length,
            latestMessage: peer.inbox[0]?.body,
            role: peerMeta[peer.id]?.role ?? "PEER",
            health: peer.trustScore > 0.9 ? "STABLE" : "WATCH",
        },
    }));

    const linkEdges = meshNetwork.peerList.flatMap((peer) =>
        peer.links
            .filter((link) => peer.id < link)
            .map((link) => ({
                id: `link:${peer.id}:${link}`,
                source: peer.id,
                target: link,
                type: "smoothstep",
                animated: false,
                style: {stroke: "#294252", strokeWidth: 1.5},
            })),
    );

    const packetEdges = meshNetwork.packets.flatMap((packet) =>
        packet.route.slice(0, -1).map((hop, index) => ({
            id: `packet:${packet.id}:${hop}:${packet.route[index + 1]}`,
            source: hop,
            target: packet.route[index + 1]!,
            type: "packet",
            animated: true,
            markerEnd: {
                type: MarkerType.ArrowClosed,
                color: packet.status === "delivered" ? "#4dd0a8" : "#d69b3b",
            },
            data: {
                label: index === 0 ? `${packet.from} -> ${packet.to}` : undefined,
                labelColor: packet.status === "delivered" ? "#9be7cf" : "#e7c07a",
                stroke: packet.status === "delivered" ? "#4dd0a8" : "#d69b3b",
            },
        })),
    );

    return {
        nodes,
        edges: [...linkEdges, ...packetEdges],
        packets: meshNetwork.packets.map((packet) => ({
            id: packet.id,
            from: packet.from,
            to: packet.to,
            route: [...packet.route],
            digest: packet.digest,
            status: packet.status,
        })),
        events: [...meshNetwork.events],
        deliveredPackets: meshNetwork.deliveredPackets,
    };
}

function OverviewHeaderText(props: { compact: boolean }) {
    return (
        <div
            style={{
                ...overlayPanelStyle,
                width: props.compact ? "calc(50vw - 120px)" : "50vw",
                minHeight: 56,
                display: "flex",
                alignItems: "center",
                gap: 16,
                padding: "10px 14px",
            }}
        >
            <div style={{ minWidth: 0, flex: 1 }}>
                <div style={eyebrowStyle}>NOC OVERVIEW</div>
                <div
                    style={{
                        marginTop: 2,
                        fontSize: props.compact ? 18 : 20,
                        fontWeight: 700,
                        lineHeight: 1.05,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                    }}
                >
                    Mesh Operations Dashboard
                </div>
            </div>
        </div>
    );
}

export default function App() {
    const [graph, setGraph] = useState<MeshSnapshot>(() => createGraph());
    const [isCompact, setIsCompact] = useState(() => window.innerWidth < 1220);

    useEffect(() => {
        const dispose = onSnapshot(meshNetwork, () => setGraph(createGraph()));
        const onResize = () => setIsCompact(window.innerWidth < 1220);
        window.addEventListener("resize", onResize);

        void (async () => {
            await meshNetwork.initialize();
            await meshNetwork.sendSecureMessage("alpha", "gamma", "Ephemeral session key rotated at the edge.");
            await meshNetwork.sendSecureMessage("delta", "beta", "Forwarding signed topology update.");
            await meshNetwork.sendSecureMessage("gamma", "alpha", "Acknowledged over secure event channel.");
        })();

        return () => {
            window.removeEventListener("resize", onResize);
            dispose();
        };
    }, []);

    return (
        <main
            style={{
                minHeight: "100vh",
                padding: 16,
                background: "linear-gradient(180deg, #081118 0%, #0a141c 100%)",
                color: "#d9e6ec",
                fontFamily: '"IBM Plex Sans", "Avenir Next", sans-serif',
            }}
        >
            <section
                style={{
                    display: "grid",
                    gridTemplateColumns: isCompact ? "1fr" : "minmax(0, 1fr) 340px",
                    gap: 14,
                    minHeight: isCompact ? "auto" : "calc(100vh - 32px)",
                }}
            >
                <article
                    style={{
                        position: "relative",
                        overflow: "hidden",
                        borderRadius: 14,
                        border: "1px solid #1a2d3a",
                        background: "linear-gradient(180deg, #0a141c 0%, #091118 100%)",
                        minHeight: isCompact ? 780 : undefined,
                    }}
                >
                    <div style={scanlineStyle}/>
                    <div style={{position: "absolute", inset: 0}}>
                        <ReactFlow
                            nodes={graph.nodes}
                            edges={graph.edges}
                            nodeTypes={nodeTypes}
                            edgeTypes={edgeTypes}
                            fitView
                            fitViewOptions={{padding: 0.12}}
                            nodesDraggable={false}
                            nodesConnectable={false}
                            elementsSelectable={false}
                            zoomOnScroll={false}
                            minZoom={0.65}
                            maxZoom={1.35}
                            colorMode="dark"
                            proOptions={{hideAttribution: true}}
                        >
                            <Background variant={BackgroundVariant.Lines} gap={28} size={1}
                                        color="rgba(76, 108, 124, 0.16)"/>
                            <Controls
                                position="bottom-left"
                                style={{
                                    background: "#0d1821",
                                    border: "1px solid #223849",
                                    boxShadow: "none",
                                }}
                            />
                            <Panel position="top-left">
                                <OverviewHeaderText compact={isCompact}/>
                            </Panel>
                            <Panel position="top-right">
                                <div style={{...legendPanelStyle, display: "flex", gap: 8}}>
                                    <div style={compactKpiStyle}>
                                        <span style={compactKpiLabelStyle}>Peers</span>
                                        <span style={compactKpiValueStyle}>{graph.nodes.length}</span>
                                    </div>
                                    <div style={compactKpiStyle}>
                                        <span style={compactKpiLabelStyle}>Routes</span>
                                        <span style={compactKpiValueStyle}>{graph.packets.length}</span>
                                    </div>
                                    <div style={compactKpiStyle}>
                                        <span style={compactKpiLabelStyle}>Delivered</span>
                                        <span style={compactKpiValueStyle}>{graph.deliveredPackets}</span>
                                    </div>
                                </div>
                            </Panel>
                            <Panel position="bottom-right">
                                <div style={legendPanelStyle}>
                                    <div style={legendRowStyle}>
                                        <span style={{...legendSwatchStyle, background: "#4dd0a8"}}/>
                                        Delivered route
                                    </div>
                                    <div style={legendRowStyle}>
                                        <span style={{...legendSwatchStyle, background: "#294252"}}/>
                                        Mesh link
                                    </div>
                                </div>
                            </Panel>
                            <Panel position="bottom-center">
                                <div style={tickerStyle}>
                                    <span style={tickerLabelStyle}>Latest</span>
                                    <span>{graph.events[0] ?? "No active events"}</span>
                                </div>
                            </Panel>
                        </ReactFlow>
                    </div>
                </article>
                <aside style={{...sidePanelStyle, display: "grid", gridTemplateRows: "auto auto auto 1fr", gap: 12, minHeight: isCompact ? "auto" : "calc(100vh - 32px)", overflow: "hidden"}}>
                    <section style={{display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8}}>
                        <div style={summaryCardStyle}>
                            <div style={summaryLabelStyle}>Channel Integrity</div>
                            <div style={summaryValueStyle}>Nominal</div>
                        </div>
                        <div style={summaryCardStyle}>
                            <div style={summaryLabelStyle}>Link Drift</div>
                            <div style={summaryValueStyle}>0 Alerts</div>
                        </div>
                    </section>
                    <section>
                        <div style={panelTitleStyle}>Route Status</div>
                        <div style={{display: "grid", gap: 6, marginTop: 8}}>
                            {graph.packets.map((packet) => (
                                <div key={packet.id} style={denseStatusRowStyle}>
                                    <div style={{minWidth: 0}}>
                                        <div style={{fontWeight: 700, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"}}>
                                            {packet.from} -&gt; {packet.to}
                                        </div>
                                        <div style={denseSubtleStyle}>{packet.route.join(" -> ")}</div>
                                    </div>
                                    <div style={statusBadgeStyle(packet.status)}>{packet.status}</div>
                                </div>
                            ))}
                        </div>
                    </section>
                    <section>
                        <div style={panelTitleStyle}>Packet Ledger</div>
                        <ul style={{...listStyle, gap: 6, marginTop: 8}}>
                            {graph.packets.map((packet) => (
                                <li key={packet.id} style={denseListRowStyle}>
                                    <strong style={{display: "block", fontSize: 13}}>{packet.from} -&gt; {packet.to}</strong>
                                    <div style={denseSubtleStyle}>Digest {packet.digest.slice(0, 16)}...</div>
                                    <div style={denseSubtleStyle}>Route {packet.route.join(" -> ")}</div>
                                </li>
                            ))}
                        </ul>
                    </section>
                    <section style={{minHeight: 0, overflow: "hidden"}}>
                        <div style={panelTitleStyle}>Event Feed</div>
                        <ul style={{...listStyle, gap: 6, marginTop: 8}}>
                            {graph.events.slice(0, 6).map((event) => (
                                <li key={event} style={denseFeedRowStyle}>
                                    {event}
                                </li>
                            ))}
                        </ul>
                    </section>
                </aside>
            </section>
        </main>
    );
}

const nodeMetricStyle: React.CSSProperties = {
    padding: 8,
    borderRadius: 8,
    background: "#101d26",
    border: "1px solid #1a2c38",
};

const nodeMetricLabelStyle: React.CSSProperties = {
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "#7b9aaa",
};

const nodeMetricValueStyle: React.CSSProperties = {
    marginTop: 4,
    fontSize: 16,
    fontWeight: 700,
};

const scanlineStyle: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
    background:
        "linear-gradient(rgba(98, 132, 149, 0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(98, 132, 149, 0.04) 1px, transparent 1px)",
    backgroundSize: "24px 24px",
};

const overlayPanelStyle: React.CSSProperties = {
    borderRadius: 10,
    background: "rgba(10, 19, 26, 0.9)",
    border: "1px solid #223849",
    boxShadow: "0 12px 24px rgba(0, 0, 0, 0.22)",
};

const eyebrowStyle: React.CSSProperties = {
    fontSize: 11,
    letterSpacing: "0.14em",
    textTransform: "uppercase",
    color: "#66aec4",
};

const kpiStyle: React.CSSProperties = {
    padding: 10,
    borderRadius: 8,
    border: "1px solid #1a2d3a",
    background: "#0d1821",
};

const kpiLabelStyle: React.CSSProperties = {
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "#7b9aaa",
};

const kpiValueStyle: React.CSSProperties = {
    marginTop: 6,
    fontSize: 24,
    fontWeight: 700,
};

const compactKpiStyle: React.CSSProperties = {
    minWidth: 78,
    padding: "7px 10px",
    borderRadius: 8,
    border: "1px solid #1a2d3a",
    background: "#0d1821",
    display: "grid",
    gap: 2,
};

const compactKpiLabelStyle: React.CSSProperties = {
    fontSize: 9,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "#7b9aaa",
};

const compactKpiValueStyle: React.CSSProperties = {
    fontSize: 18,
    fontWeight: 700,
    lineHeight: 1,
};

const legendPanelStyle: React.CSSProperties = {
    display: "grid",
    gap: 8,
    padding: "12px 14px",
    borderRadius: 10,
    background: "rgba(10, 19, 26, 0.9)",
    border: "1px solid #223849",
    fontSize: 12,
};

const legendRowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
};

const legendSwatchStyle: React.CSSProperties = {
    width: 12,
    height: 3,
    display: "inline-block",
    borderRadius: 999,
};

const tickerStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 14px",
    borderRadius: 10,
    background: "rgba(10, 19, 26, 0.9)",
    border: "1px solid #223849",
    fontSize: 12,
    color: "#b8cbd5",
};

const tickerLabelStyle: React.CSSProperties = {
    color: "#66aec4",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    fontWeight: 700,
};

const sidePanelStyle: React.CSSProperties = {
    borderRadius: 12,
    padding: 12,
    border: "1px solid #1a2d3a",
    background: "#0b141b",
};

const summaryCardStyle: React.CSSProperties = {
    padding: 12,
    borderRadius: 8,
    border: "1px solid #1a2d3a",
    background: "#0f1921",
};

const summaryLabelStyle: React.CSSProperties = {
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "#7b9aaa",
};

const summaryValueStyle: React.CSSProperties = {
    marginTop: 4,
    fontWeight: 700,
    color: "#d9e6ec",
    fontSize: 14,
};

const panelTitleStyle: React.CSSProperties = {
    margin: 0,
    fontSize: 13,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: "#66aec4",
};

const statusRowStyle: React.CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "center",
    padding: 10,
    borderRadius: 8,
    border: "1px solid #1a2d3a",
    background: "#0f1921",
};

const statusSubtleStyle: React.CSSProperties = {
    marginTop: 4,
    fontSize: 12,
    color: "#7f99a7",
};

const statusBadgeStyle = (status: string): React.CSSProperties => ({
    padding: "4px 8px",
    borderRadius: 999,
    border: `1px solid ${status === "delivered" ? "#1f4d40" : "#5a4320"}`,
    background: status === "delivered" ? "rgba(41, 161, 116, 0.12)" : "rgba(198, 141, 39, 0.12)",
    color: status === "delivered" ? "#7ce3b7" : "#efc26d",
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    fontWeight: 700,
});

const listStyle: React.CSSProperties = {
    margin: "12px 0 0",
    padding: 0,
    listStyle: "none",
    display: "grid",
    gap: 8,
};

const listRowStyle: React.CSSProperties = {
    padding: 10,
    borderRadius: 8,
    border: "1px solid #1a2d3a",
    background: "#0f1921",
    lineHeight: 1.45,
};

const feedRowStyle: React.CSSProperties = {
    padding: "10px 12px",
    borderLeft: "3px solid #1f4d40",
    background: "#0f1921",
    color: "#d9e6ec",
    lineHeight: 1.45,
};

const denseStatusRowStyle: React.CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
    padding: "8px 10px",
    borderRadius: 8,
    border: "1px solid #1a2d3a",
    background: "#0f1921",
};

const denseSubtleStyle: React.CSSProperties = {
    marginTop: 2,
    fontSize: 11,
    color: "#7f99a7",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
};

const denseListRowStyle: React.CSSProperties = {
    padding: "8px 10px",
    borderRadius: 8,
    border: "1px solid #1a2d3a",
    background: "#0f1921",
    lineHeight: 1.35,
};

const denseFeedRowStyle: React.CSSProperties = {
    padding: "8px 10px",
    borderLeft: "2px solid #1f4d40",
    background: "#0f1921",
    color: "#d9e6ec",
    lineHeight: 1.35,
    fontSize: 12,
};
