import { flow, types } from "mobx-state-tree";
import type { Instance, SnapshotIn } from "mobx-state-tree";

type ChannelEventDetail = {
    from: string;
    to: string;
    packetId: string;
    route: string[];
    payload: string;
    iv: string;
    digest: string;
    sentAt: number;
};

type EventBus = EventTarget;
type KeyStore = Map<string, CryptoKey>;
type DeliveryHandler = (peerId: string, detail: ChannelEventDetail, body: string) => void;

function textToBytes(value: string): Uint8Array {
    return new TextEncoder().encode(value);
}

function bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64(bytes: Uint8Array): string {
    let value = "";
    for (const byte of bytes) {
        value += String.fromCharCode(byte);
    }
    return btoa(value);
}

function base64ToBytes(value: string): Uint8Array {
    const decoded = atob(value);
    return Uint8Array.from(decoded, (char) => char.charCodeAt(0));
}

async function deriveChannelKey(channelName: string): Promise<CryptoKey> {
    const digest = await crypto.subtle.digest("SHA-256", textToBytes(channelName));
    return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function digestPayload(payload: Uint8Array): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", payload);
    return bytesToHex(new Uint8Array(digest));
}

async function encryptMessage(channelKey: CryptoKey, message: string) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const payload = textToBytes(message);
    const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, channelKey, payload);

    return {
        payload: bytesToBase64(new Uint8Array(encrypted)),
        iv: bytesToBase64(iv),
        digest: await digestPayload(payload),
    };
}

async function decryptMessage(channelKey: CryptoKey, payload: string, iv: string) {
    const decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: base64ToBytes(iv) },
        channelKey,
        base64ToBytes(payload),
    );

    return new TextDecoder().decode(decrypted);
}

function routeFor(from: string, to: string, peers: Map<string, Instance<typeof PeerModel>>) {
    const visited = new Set<string>([from]);
    const queue: string[][] = [[from]];

    while (queue.length > 0) {
        const path = queue.shift();
        if (!path) {
            continue;
        }

        const current = path[path.length - 1];
        if (current === to) {
            return path;
        }

        const peer = peers.get(current);
        if (!peer) {
            continue;
        }

        for (const nextHop of peer.links) {
            if (!visited.has(nextHop)) {
                visited.add(nextHop);
                queue.push([...path, nextHop]);
            }
        }
    }

    return [from];
}

const PacketModel = types.model("Packet", {
    id: types.identifier,
    from: types.string,
    to: types.string,
    route: types.array(types.string),
    digest: types.string,
    cipherText: types.string,
    sentAt: types.number,
    status: types.enumeration("PacketStatus", ["queued", "delivered"]),
});

const InboxMessageModel = types.model("InboxMessage", {
    id: types.identifier,
    from: types.string,
    body: types.string,
    digest: types.string,
    route: types.array(types.string),
    receivedAt: types.number,
});

const PeerModel = types
    .model("Peer", {
        id: types.identifier,
        label: types.string,
        channel: types.string,
        links: types.array(types.string),
        trustScore: types.number,
        inbox: types.array(InboxMessageModel),
        sentCount: types.optional(types.number, 0),
    })
    .actions((self) => ({
        receiveMessage(message: SnapshotIn<typeof InboxMessageModel>) {
            self.inbox.unshift(message);
        },
        markSent() {
            self.sentCount += 1;
        },
    }));

const MeshNetworkModel = types
    .model("MeshNetwork", {
        id: types.optional(types.identifier, "browser-mesh"),
        peers: types.map(PeerModel),
        packets: types.array(PacketModel),
        events: types.array(types.string),
    })
    .volatile(() => ({
        bus: new EventTarget() as EventBus,
        listeners: new Map<string, EventListener>(),
        channelKeys: new Map<string, CryptoKey>() as KeyStore,
        ready: false,
    }))
    .views((self) => ({
        get peerList() {
            return Array.from(self.peers.values());
        },
        get deliveredPackets() {
            return self.packets.filter((packet) => packet.status === "delivered").length;
        },
    }))
    .actions((self) => {
        const remember = (message: string) => {
            self.events.unshift(message);
            if (self.events.length > 12) {
                self.events.pop();
            }
        };

        const attachPeerListener = (peerId: string) => {
            const listener: EventListener = async (event) => {
                const detail = (event as CustomEvent<ChannelEventDetail>).detail;
                if (detail.to !== peerId) {
                    return;
                }

                const peer = self.peers.get(peerId);
                if (!peer) {
                    return;
                }

                const channelKey = self.channelKeys.get(peer.channel);
                if (!channelKey) {
                    remember(`Missing channel key for ${peer.label}`);
                    return;
                }

                const body = await decryptMessage(channelKey, detail.payload, detail.iv);
                (self as typeof self & { finalizeDelivery: DeliveryHandler }).finalizeDelivery(peerId, detail, body);
            };

            self.listeners.set(peerId, listener);
            self.bus.addEventListener(`mesh:${peerId}`, listener);
        };

        const detachPeerListeners = () => {
            for (const [peerId, listener] of self.listeners.entries()) {
                self.bus.removeEventListener(`mesh:${peerId}`, listener);
            }
            self.listeners.clear();
        };

        const finalizeDelivery = (peerId: string, detail: ChannelEventDetail, body: string) => {
            const peer = self.peers.get(peerId);
            if (!peer) {
                return;
            }

            peer.receiveMessage({
                id: `${detail.packetId}:inbox`,
                from: detail.from,
                body,
                digest: detail.digest,
                route: detail.route,
                receivedAt: Date.now(),
            });

            const packet = self.packets.find((item) => item.id === detail.packetId);
            if (packet) {
                packet.status = "delivered";
            }

            remember(`${detail.route.join(" -> ")} delivered to ${peer.label}`);
        };

        const initialize = flow(function* initialize() {
            if (self.ready) {
                return;
            }

            for (const peer of self.peers.values()) {
                const key = yield deriveChannelKey(peer.channel);
                self.channelKeys.set(peer.channel, key);
                attachPeerListener(peer.id);
            }
            self.ready = true;
            remember(`Secure channels armed for ${self.peers.size} peers`);
        });

        const beforeDestroy = () => {
            detachPeerListeners();
        };

        const sendSecureMessage = flow(function* sendSecureMessage(from: string, to: string, body: string) {
            if (!self.ready) {
                yield initialize();
            }

            const sender = self.peers.get(from);
            const recipient = self.peers.get(to);

            if (!sender || !recipient) {
                remember(`Rejected packet from ${from} to ${to}`);
                return;
            }

            const channelKey = self.channelKeys.get(recipient.channel);
            if (!channelKey) {
                remember(`No secure channel for ${recipient.label}`);
                return;
            }

            const route = routeFor(from, to, self.peers);
            if (route[route.length - 1] !== to) {
                remember(`No route from ${sender.label} to ${recipient.label}`);
                return;
            }

            const packetId = `${from}-${to}-${Date.now()}`;
            const encrypted = yield encryptMessage(channelKey, body);

            self.packets.unshift({
                id: packetId,
                from,
                to,
                route,
                digest: encrypted.digest,
                cipherText: encrypted.payload,
                sentAt: Date.now(),
                status: "queued",
            });
            sender.markSent();
            remember(`${sender.label} queued encrypted packet for ${recipient.label}`);

            self.bus.dispatchEvent(
                new CustomEvent<ChannelEventDetail>(`mesh:${to}`, {
                    detail: {
                        from,
                        to,
                        packetId,
                        route,
                        payload: encrypted.payload,
                        iv: encrypted.iv,
                        digest: encrypted.digest,
                        sentAt: Date.now(),
                    },
                }),
            );
        });

        return { beforeDestroy, finalizeDelivery, initialize, sendSecureMessage };
    });

export const meshNetwork = MeshNetworkModel.create({
    peers: {
        alpha: {
            id: "alpha",
            label: "Alpha relay",
            channel: "channel:alpha",
            links: ["beta", "delta"],
            trustScore: 0.98,
            inbox: [],
        },
        beta: {
            id: "beta",
            label: "Beta relay",
            channel: "channel:beta",
            links: ["alpha", "gamma"],
            trustScore: 0.95,
            inbox: [],
        },
        gamma: {
            id: "gamma",
            label: "Gamma client",
            channel: "channel:gamma",
            links: ["beta", "delta"],
            trustScore: 0.91,
            inbox: [],
        },
        delta: {
            id: "delta",
            label: "Delta bridge",
            channel: "channel:delta",
            links: ["alpha", "gamma"],
            trustScore: 0.93,
            inbox: [],
        },
    },
    packets: [],
    events: [],
});
