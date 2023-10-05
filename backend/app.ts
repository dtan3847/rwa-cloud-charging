import express from "express";
import { v4 as uuidv4 } from "uuid";
import { createClient, WatchError } from "redis";
import { json } from "body-parser";

type RedisClientType = ReturnType<typeof createClient>

const DEFAULT_BALANCE = 100;

interface ChargeResult {
    isAuthorized: boolean;
    remainingBalance: number;
    charges: number;
}

async function connect(): Promise<RedisClientType> {
    const url = `redis://${process.env.REDIS_HOST ?? "localhost"}:${process.env.REDIS_PORT ?? "6379"}`;
    console.log(`Using redis URL ${url}`);
    const client = createClient({ url });
    await client.connect();
    return client;
}

async function reset(account: string): Promise<void> {
    const client = await connect();
    try {
        const id = await acquireLock(client, account);
        if (!id) throw Error("Could not acquire lock");
        try {
            await client.set(`${account}/balance`, DEFAULT_BALANCE);
        } finally {
            await releaseLock(client, account, id);
        }
    } finally {
        await client.disconnect();
    }
}

async function charge(account: string, charges: number): Promise<ChargeResult> {
    const client = await connect();
    try {
        const id = await acquireLock(client, account);
        if (!id) throw Error("Could not acquire lock");
        try {
            const balance = parseInt((await client.get(`${account}/balance`)) ?? "");
            if (balance >= charges) {
                await client.set(`${account}/balance`, balance - charges);
                const remainingBalance = parseInt((await client.get(`${account}/balance`)) ?? "");
                return { isAuthorized: true, remainingBalance, charges };
            } else {
                return { isAuthorized: false, remainingBalance: balance, charges: 0 };
            }
        } finally {
            await releaseLock(client, account, id);
        }
    } finally {
        await client.disconnect();
    }
}

// Adapted from https://redis.com/glossary/redis-lock/
async function acquireLock(client: RedisClientType, account: string, acquireTimeout: number = 10, lockTimeout: number = 10): Promise<string | false> {
    const id = uuidv4();
    const lockKey = "lock:" + account;
    const end = Date.now() + acquireTimeout * 1000;
    while (Date.now() < end) {
        if (await client.set(lockKey, id, {
            EX: lockTimeout,
            NX: true,
        })) {
            return id;
        }
        await new Promise((resolve) => { setTimeout(resolve, 1)});
    }
    return false;
}

async function releaseLock(client: RedisClientType, account: string, id: string): Promise<boolean> {
    const lockKey = "lock:" + account;
    while (true) {
        try {
            client.watch(lockKey);
            if (await client.get(lockKey) === id) {
                await client.multi()
                    .del(lockKey)
                    .exec();
                return true;
            }
            client.unwatch();
        } catch (e) {
            if (!(e instanceof WatchError)) {
                throw e;
            }
        }
        return false;
    }
}

export function buildApp(): express.Application {
    const app = express();
    app.use(json());
    app.post("/reset", async (req, res) => {
        try {
            const account = req.body.account ?? "account";
            await reset(account);
            console.log(`Successfully reset account ${account}`);
            res.sendStatus(204);
        } catch (e) {
            console.error("Error while resetting account", e);
            res.status(500).json({ error: String(e) });
        }
    });
    app.post("/charge", async (req, res) => {
        try {
            const account = req.body.account ?? "account";
            const result = await charge(account, req.body.charges ?? 10);
            console.log(`Successfully charged account ${account}`);
            res.status(200).json(result);
        } catch (e) {
            console.error("Error while charging account", e);
            res.status(500).json({ error: String(e) });
        }
    });
    return app;
}
