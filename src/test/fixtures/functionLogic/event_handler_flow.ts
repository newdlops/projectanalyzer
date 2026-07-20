/** TypeScript Function Logic fixture for detached event-handler registrations. */

type EventTargetLike = {
  addEventListener(name: string, handler: (value: unknown) => void): void;
};

type EventEmitterLike = {
  on(name: string, handler: (value: unknown) => void): void;
  once(name: string, handler: (value: unknown) => void): void;
};

type SubscriptionLike = {
  subscribe(handler: (value: unknown) => void): void;
};

type SocketLike = {
  onmessage?: (value: unknown) => void;
};

export function handleClick(value: unknown): void {
  consume(value);
}

export function handleData(value: unknown): void {
  consume(value);
}

export function handleClose(value: unknown): void {
  consume(value);
}

export function handleNotification(value: unknown): void {
  consume(value);
}

export function handleMessage(value: unknown): void {
  consume(value);
}

export function afterSetup(): void {
  consume("ready");
}

export function setupEventHandlers(
  button: EventTargetLike,
  emitter: EventEmitterLike,
  notifications: SubscriptionLike,
  socket: SocketLike
): void {
  button.addEventListener("click", handleClick);
  emitter.on("data", handleData);
  emitter.once("close", handleClose);
  notifications.subscribe(handleNotification);
  socket.onmessage = handleMessage;
  afterSetup();
}

declare function consume(value: unknown): void;
