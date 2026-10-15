import {
  ApolloClient,
  InMemoryCache,
  HttpLink,
} from "@apollo/client";

const GQL_URL = import.meta.env.VITE_GQL_URL
  ?? `http://${window.location.hostname}:9000/typiql/graphql`;

export function getAppId() {
  let id = localStorage.getItem("monocoque_app_id");
  if (!id) {
    id = getDeviceId();
    localStorage.setItem("monocoque_app_id", id);
  }
  return id;
}

function getDeviceId() {
  if (window.crypto && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Apollo 4.2's multipart reader ends with `reader.cancel()` in a `finally`
// and never handles that promise. Tearing a subscription down aborts its
// body, so the cancel rejects and surfaces as an unhandled "AbortError:
// BodyStreamBuffer was aborted" — every time the live-updates hub reconnects
// with a different demand (opening a dashboard, the raw telemetry page, the
// live recording chart) or a subscription unmounts. Ending an aborted body
// cleanly instead lets Apollo wind down quietly: it has already unsubscribed,
// so nothing is waiting on the result. Any other stream error (the backend
// going away) still errors, which is what the hub's reconnect relies on.
function endQuietlyOnAbort(response: Response): Response {
  const body = response.body;
  if (!body || !/^multipart\/mixed/i.test(response.headers.get("content-type") ?? "")) {
    return response;
  }
  const reader = body.getReader();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (e) {
        if ((e as Error)?.name === "AbortError") controller.close();
        else controller.error(e);
      }
    },
    cancel(reason) {
      return reader.cancel(reason).catch(() => {});
    },
  });
  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

export const apolloClient = new ApolloClient({
  link: new HttpLink({
    uri: GQL_URL,
    fetch: (input, init) => fetch(input, init).then(endQuietlyOnAbort),
  }),
  cache: new InMemoryCache(),
});
