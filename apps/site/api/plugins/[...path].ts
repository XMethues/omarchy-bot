import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handlePluginCloudRequest } from "../../server/plugins.ts";

export default async function handler(request: VercelRequest, response: VercelResponse): Promise<void> {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }
  const url = new URL(request.url ?? "/", `https://${request.headers.host ?? "localhost"}`);
  const method = request.method ?? "GET";
  const body = method === "GET" || method === "HEAD" ? undefined
    : typeof request.body === "string" ? request.body : JSON.stringify(request.body ?? {});
  const result = await handlePluginCloudRequest(new Request(url, { method, headers, ...(body === undefined ? {} : { body }) }));
  response.status(result.status);
  result.headers.forEach((value, key) => response.setHeader(key, value));
  response.end(Buffer.from(await result.arrayBuffer()));
}
