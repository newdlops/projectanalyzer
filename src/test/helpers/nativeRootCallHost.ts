/** Actual root Host plus one swappable per-action CPU worker; raw call expectations are built independently of the new Host/root decoders. */
import { createNativeFunctionNarrativeProvider, type NativeFunctionNarrativeRunReceipt } from "../../llm/nativeNarrativeProvider";
import type { NativeNarrativeEvent } from "../../llm/nativeNarratives";
import { unpackNativeInputMessages, unpackNativeSourceJson } from "../../llm/nativeNarrativeCodec";
import { getFunctionCallFixedInputs, type FunctionCallReading } from "../../shared/functionCallNarratives";
import type { FunctionNarrativeProvider } from "../../application/functionNarratives";
import { ModelTaskManager } from "../../shared/modelTasks";
import { createWholeNarrativeRootHost } from "./wholeNarrativeRootHost";
import type { withCompleteNativeNarrativeWorker } from "./completeNativeNarrativeWorker";

type Fixture = Parameters<Parameters<typeof withCompleteNativeNarrativeWorker>[0]>[0];
type Mode = Parameters<Fixture["options"]>[0];
type Input = { pid: number; kind: "call" | "root"; source: any };

/** Constructor and static publish are inert; source/response journals belong only to these explicit CPU test owners. */
export async function createNativeRootCallHost(fixture: Fixture, options: { mode?: Mode; manager?: ModelTaskManager; callCount?: number;
  onEvent?(event: NativeNarrativeEvent, host: Awaited<ReturnType<typeof createWholeNarrativeRootHost>>): void } = {}) {
  const manager = options.manager ?? new ModelTaskManager(), events: NativeNarrativeEvent[] = [], inputs: Input[] = [], expected = new Map<number, FunctionCallReading[]>(), receipts: NativeFunctionNarrativeRunReceipt[] = [];
  let host!: Awaited<ReturnType<typeof createWholeNarrativeRootHost>>, current!: FunctionNarrativeProvider, latest: Input | undefined;
  const make = (mode: Mode) => createNativeFunctionNarrativeProvider({ manager, worker: { ...fixture.options(mode),
    onEvent(event) { events.push(event); if (event.event === "ready") host.events.push("native-ready"); options.onEvent?.(event, host); },
    journal(event) {
      const line = JSON.parse(event.raw), pid = event.pid!;
      if (event.direction === "input") {
        const payload = line.requests[0].payload, kind = payload.schema.anyOf ? "root" : "call", content = unpackNativeInputMessages(payload.messages)[1].content;
        const marker = kind === "root" ? "SOURCE JSON:\n" : "SOURCE DATA:\n", data = JSON.parse(content.slice(content.lastIndexOf(marker) + marker.length));
        latest = { pid, kind, source: kind === "root" ? (unpackNativeSourceJson(data) as any)["SOURCE DATA:"] : data }; inputs.push(latest);
      } else if (line.replies && latest?.kind === "call") {
        const raw = JSON.parse(line.replies[0].content), targets = latest.source.callTask.targets, rows = expected.get(pid) ?? []; expected.set(pid, rows);
        for (const [index, call] of (raw.calls ?? []).entries()) rows.push({ callId: targets[index].callId, role: call.role,
          inputs: call.inputs ?? getFunctionCallFixedInputs(targets[index], "en")!, output: call.output, effects: call.effects, reason: call.reason });
      }
    } }, onRunComplete(receipt) { receipts.push(receipt); host.events.push("provider-released"); } });
  current = make(options.mode);
  const provider: FunctionNarrativeProvider = { managesDeadlines: true, prepare: (...args) => current.prepare!(...args), withRun: (...args) => current.withRun!(...args),
    generate: (...args) => current.generate(...args), generateCompleteRoot: (...args) => current.generateCompleteRoot!(...args), generateCompleteCall: (...args) => current.generateCompleteCall!(...args) };
  host = await createWholeNarrativeRootHost({ provider, callCount: options.callCount ?? 12 });
  return { ...host, hostEvents: host.events, manager, events, inputs, expected, receipts, setMode(mode: Mode) { current = make(mode); },
    async close() { host.delivery.clearScenarioInputs(); await manager.dispose(); } };
}
