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

describe("retryTransientReads time budget", () => {
  /** A clock the test drives, so no test actually waits. */
  function fakeClock(perAttemptMs: number) {
    let t = 0;
    const calls: number[] = [];
    return {
      calls,
      now: () => t,
      run: async () => {
        calls.push(t);
        t += perAttemptMs;
        throw new Prisma.PrismaClientKnownRequestError("unreachable", {
          code: "P1001",
          clientVersion: "test",
        });
      },
    };
  }

  // The whole point of the budget: connect_timeout=15 means an unroutable
  // database burns 15s per attempt. Retrying that would blow the serverless
  // function's maxDuration and replace the error page with a platform 504.
  it("does not retry when one attempt already exhausted the budget", async () => {
    const c = fakeClock(15_000);
    await expect(
      retryTransientReads("findMany", c.run, [150, 600], 2_500, c.now),
    ).rejects.toThrow("unreachable");
    expect(c.calls).toEqual([0]);
  });

  it("still retries the fast failures the budget was sized for", async () => {
    const c = fakeClock(50);
    await expect(
      retryTransientReads("findMany", c.run, [150, 600], 2_500, c.now),
    ).rejects.toThrow("unreachable");
    expect(c.calls.length).toBe(3);
  });

  it("keeps going while each attempt plus its wait stays inside the budget", async () => {
    // The clock advances only inside an attempt, so these are attempt start
    // times: 0, 900, 1800. After attempt 1, 900 + 150 = 1050 is inside 2_500;
    // after attempt 2, 1800 + 600 = 2400 still is. Attempt 3 runs and there
    // are no delays left, so it stops there having never overrun.
    const c = fakeClock(900);
    await expect(
      retryTransientReads("findMany", c.run, [150, 600], 2_500, c.now),
    ).rejects.toThrow("unreachable");
    expect(c.calls).toEqual([0, 900, 1800]);
  });

  it("counts the pending wait, not just time already spent", async () => {
    // 1_000ms per attempt against a 1_100ms budget: after attempt 1 only 100ms
    // has been "spent", but the 150ms wait would cross the line, so it stops.
    const c = fakeClock(1_000);
    await expect(
      retryTransientReads("findMany", c.run, [150, 600], 1_100, c.now),
    ).rejects.toThrow("unreachable");
    expect(c.calls).toEqual([0]);
  });
});
