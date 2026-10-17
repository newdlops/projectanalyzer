/** Source-free monotonic clock exchange. Offset bounds cover ready emission/IPC without assuming shared clock epochs. */
import { randomUUID } from "node:crypto";
import { requireNative, isNativeRecord } from "./protocol";

/** The worker contract uses monotonic nanoseconds at the same rate as process.hrtime.bigint(), with an arbitrary epoch. */
export type NativeReadyClockBounds = {
  basis: "monotonic-exchange-v1";
  earliestHostNs: string; latestHostNs: string; uncertaintyMs: number;
};
export type NativeReadyDuration = {
  hostReadyReceiptMs?: number;
  /** An interval, never an exact latency. Qualification must use its upper bound. */
  workerReadyMs?: { lowerBound: number; upperBound: number; uncertaintyMs: number };
};

function nanoseconds(value: unknown): bigint {
  requireNative(typeof value === "string" && /^[0-9]{1,40}$/u.test(value), "worker-clock-timestamp");
  return BigInt(value as string);
}

/** Exactly one fresh nonce binds the source-free exchange to this child and ready event. No model/source packet is accepted meanwhile. */
export class NativeReadyClockExchange {
  private readonly nonce = randomUUID();
  private readonly workerReadyNs: bigint;
  private sentNs?: bigint;
  public constructor(ready: unknown, private readonly readyReceiptNs: bigint) {
    requireNative(isNativeRecord(ready) && ready.version === 1, "worker-ready-clock");
    this.workerReadyNs = nanoseconds((ready as Record<string, unknown>).workerReadyNs);
  }
  public packet(): string { return JSON.stringify({ nativeClock: { version: 1, nonce: this.nonce } }) + "\n"; }
  public sent(at: bigint): void { requireNative(this.sentNs === undefined && at >= this.readyReceiptNs, "worker-clock-send"); this.sentNs = at; }

  /** For offset O=Host-Worker: Hsend-Wrecv <= O <= Hrecv-Wsend. Intersect with ready emission preceding receipt. */
  public complete(reply: unknown, receivedNs: bigint, pid: number | undefined): NativeReadyClockBounds {
    requireNative(isNativeRecord(reply) && reply.version === 1 && reply.nonce === this.nonce && reply.workerPid === pid && this.sentNs !== undefined, "worker-clock-reply");
    const received = nanoseconds((reply as Record<string, unknown>).receivedNs), sent = nanoseconds((reply as Record<string, unknown>).sentNs);
    requireNative(this.workerReadyNs <= received && received <= sent && this.sentNs! <= receivedNs, "worker-clock-order");
    const earliest = this.workerReadyNs + this.sentNs! - received;
    const latestUncapped = this.workerReadyNs + receivedNs - sent;
    const latest = latestUncapped < this.readyReceiptNs ? latestUncapped : this.readyReceiptNs;
    requireNative(earliest >= 0n && earliest <= latest && latest <= receivedNs, "worker-clock-bounds");
    return { basis: "monotonic-exchange-v1", earliestHostNs: earliest.toString(), latestHostNs: latest.toString(), uncertaintyMs: Number(latest - earliest) / 1e6 };
  }
}

/** Read one Host endpoint for both bounds; no source, answer, worker-supplied duration or wall clock enters this measurement. */
export function measureNativeReadyDuration(observation: { sourceFreeReadyReceiptNs?: string; readyClock?: NativeReadyClockBounds } | undefined): NativeReadyDuration {
  const end = process.hrtime.bigint();
  return {
    ...(observation?.sourceFreeReadyReceiptNs === undefined ? {} : { hostReadyReceiptMs: Number(end - BigInt(observation.sourceFreeReadyReceiptNs)) / 1e6 }),
    ...(observation?.readyClock === undefined ? {} : { workerReadyMs: {
      lowerBound: Number(end - BigInt(observation.readyClock.latestHostNs)) / 1e6,
      upperBound: Number(end - BigInt(observation.readyClock.earliestHostNs)) / 1e6,
      uncertaintyMs: observation.readyClock.uncertaintyMs
    } })
  };
}
