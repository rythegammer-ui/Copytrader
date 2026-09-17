import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { retryTransientReads } from "@/lib/db";

/** No waiting in tests; the delay values are not what is under test. */
const NOW: readonly number[] = [0, 0];

function connectionError(code: string): Error {
  return new Prisma.PrismaClientKnownRequestError(`simulated ${code}`, {
    code,
    clientVersion: "test",
  });
}

/** Resolves on the nth call; every call before that throws `err`. */
function failsUntil(n: number, err: Error) {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    run: async () => {
      calls += 1;
      if (calls < n) throw err;
      return "ok";
    },
  };
}

describe("retryTransientReads", () => {
  it("replays a read that failed because the database was unreachable", async () => {
    const op = failsUntil(2, connectionError("P1001"));
    await expect(retryTransientReads("findMany", op.run, NOW)).resolves.toBe("ok");
    expect(op.calls).toBe(2);
  });

  it("covers every connection-class code, including a closed pool", async () => {
    for (const code of ["P1001", "P1002", "P1008", "P1017", "P2024"]) {
      const op = failsUntil(3, connectionError(code));
      await expect(retryTransientReads("findUnique", op.run, NOW)).resolves.toBe("ok");
      expect(op.calls, code).toBe(3);
    }
  });

  it("retries a client that could not initialise a connection at all", async () => {
    const op = failsUntil(
      2,
      new Prisma.PrismaClientInitializationError("cannot reach database", "test"),
    );
    await expect(retryTransientReads("count", op.run, NOW)).resolves.toBe("ok");
    expect(op.calls).toBe(2);
  });

  it("gives up after the configured attempts rather than retrying forever", async () => {
    const op = failsUntil(99, connectionError("P1001"));
    await expect(retryTransientReads("findMany", op.run, NOW)).rejects.toThrow("simulated P1001");
    expect(op.calls).toBe(NOW.length + 1);
  });

  // The point of the whole design: a write that timed out may already have
  // landed, so replaying it could charge a card or draw down stock twice.
  it("never replays a write, however transient the failure looks", async () => {
    for (const action of ["create", "update", "upsert", "delete", "deleteMany", "updateMany"]) {
      const op = failsUntil(2, connectionError("P1017"));
      await expect(retryTransientReads(action, op.run, NOW)).rejects.toThrow("simulated P1017");
      expect(op.calls, action).toBe(1);
    }
  });

  it("does not retry a real query error — a unique violation is an answer", async () => {
    const op = failsUntil(2, connectionError("P2002"));
    await expect(retryTransientReads("findFirst", op.run, NOW)).rejects.toThrow("simulated P2002");
    expect(op.calls).toBe(1);
  });

  it("passes a successful read straight through", async () => {
    const op = failsUntil(1, connectionError("P1001"));
    await expect(retryTransientReads("groupBy", op.run, NOW)).resolves.toBe("ok");
    expect(op.calls).toBe(1);
  });
});
