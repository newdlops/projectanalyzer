/** Framework reading fixture: source order differs from React scheduling. */
import React, { useState as state, useEffect as effect, useMemo } from "react";

/** Shows a filterable inbox and subscribes while its account is active. */
export const Inbox = ({ accountId, subscribe, openMessage }) => {
  const [query, setQuery] = state("");
  const count = useMemo(() => query.length, [query]);
  effect(() => {
    const disconnect = subscribe(accountId);
    return () => disconnect();
  }, [accountId]);
  if (!accountId) return <p>Choose an account</p>;
  return <section>
    <input value={query} onChange={(event) => setQuery(event.target.value)} />
    <button onClick={openMessage}>Open {count} messages</button>
    <button onClick={(openMessage())}>Inspect eager invocation</button>
  </section>;
};
