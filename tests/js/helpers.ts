// Shared fakes for the Node tests: a host model in the shape anywidget hands to render(), with the values kept
// for assertions, and a fetch stub that records requests.
import type { WidgetModel } from "../../src/anywidget_graph/ui/types.ts";

/** A host model with the values kept for assertions (get reads them, set writes them). */
export function fakeModel(values: Record<string, any> = {}): WidgetModel & { values: Record<string, any> } {
  return {
    get: (k: string) => values[k],
    set: (k: string, v: any) => { values[k] = v; },
    on: () => {},
    save_changes: () => {},
    values,
  };
}

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: any;
}

/** Install a fetch stub that records requests and answers with `answer(url, body)`. */
export function stubFetch(answer: (url: string, body: any) => { ok: boolean; status: number; json: () => Promise<any>; text: () => Promise<string> }) {
  const requests: RecordedRequest[] = [];
  globalThis.fetch = (async (url: any, init: any = {}) => {
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ url: String(url), method: init.method || "GET", headers: init.headers || {}, body });
    return answer(String(url), body);
  }) as typeof fetch;
  return requests;
}
