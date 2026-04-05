import { createHmac } from "crypto";
const BOT_API_URL = process.env.BOT_API_URL ?? "";
const BOT_API_SECRET = process.env.BOT_API_SECRET ?? "";
export class BridgeEmitter {
    static async send(signal) {
        if (!BOT_API_URL) {
            console.warn("[Bridge] BOT_API_URL not set — signal not sent");
            return;
        }
        const body = JSON.stringify(signal);
        const signature = BridgeEmitter.sign(body);
        const res = await fetch(`${BOT_API_URL}/api/signal`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Swarm-Signature": signature,
                "X-Swarm-Source": "btc-swarm-intelligence",
            },
            body,
        });
        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Bridge send failed (${res.status}): ${err}`);
        }
        console.log(`[Bridge] Signal delivered to VPS bot — status: ${res.status}`);
    }
    // HMAC-SHA256 signature untuk verifikasi di bot
    static sign(body) {
        return createHmac("sha256", BOT_API_SECRET)
            .update(body)
            .digest("hex");
    }
}
