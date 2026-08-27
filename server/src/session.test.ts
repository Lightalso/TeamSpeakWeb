import assert from "node:assert/strict";
import test from "node:test";
import type { ClientEntry } from "./protocol.js";
import { applyClientLeave } from "./session.js";

function client(id: number): ClientEntry {
  return {
    id,
    nickname: `client-${id}`,
    cid: "1",
    uid: `uid-${id}`,
    type: 0,
    serverGroups: [],
    isSelf: false,
    talking: false,
  };
}

for (const reasonID of [0, 1, 2, 3, 8]) {
  test(`left-view reason ${reasonID} removes the client`, () => {
    const clients = new Map([[42, client(42)]]);

    assert.equal(applyClientLeave(clients, 42, reasonID), true);
    assert.equal(clients.has(42), false);
  });
}
