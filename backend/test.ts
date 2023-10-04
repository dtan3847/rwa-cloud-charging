import { performance } from "perf_hooks";
import supertest from "supertest";
import async from "async";
import { buildApp } from "./app";

const app = supertest(buildApp());

async function basicLatencyTest() {
    await app.post("/reset").expect(204);
    const start = performance.now();
    await app.post("/charge").expect(200);
    await app.post("/charge").expect(200);
    await app.post("/charge").expect(200);
    await app.post("/charge").expect(200);
    await app.post("/charge").expect(200);
    console.log(`Latency: ${performance.now() - start} ms`);
}

function sendCharge() {
    console.log("In sendCharge")
    return app.post("/charge")
        .send({
            "account": "test",
            "charges": 20 
        })
        .expect(200)
        .end((err, res) => {
            if (err) {
                console.error("error", err)
            } else {
                console.log("res", res.body)
            }
        })
}

async function overchargeTest() {
    await app.post("/reset").send({ "account": "test" }).expect(204);
    const start = performance.now();
    async.times(10, sendCharge)
    await new Promise((resolve) => { setTimeout(resolve, 1000)})
    sendCharge()
}

async function runTests() {
    await basicLatencyTest();
    // await overchargeTest();
}

runTests().catch(console.error);
