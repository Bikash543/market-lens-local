import handler from "vinext/server/fetch-handler";
import {initializeLocalStore} from "../lib/local-store";
import { runWithConnectorBinding } from "../lib/connector-context";
import type { ConnectorBinding } from "../lib/connector-contract.mjs";

const worker = {
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext<{ CONNECTORS?: ConnectorBinding }>) {
    const url=new URL(request.url);
    if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname))return new Response('Local access only',{status:403});
    const origin=request.headers.get('Origin');
    if(origin&&origin!==url.origin)return new Response('Cross-origin requests are not allowed',{status:403});
    if(url.pathname.startsWith('/api/'))await initializeLocalStore();
    let binding = ctx.props?.CONNECTORS;
    // Local preview emulates the same request-scoped capability. This branch and
    // the auxiliary service binding are absent from production builds.
    if (import.meta.env.DEV && !binding && env.CONNECTORS) {
      const preview = env.CONNECTORS;
      const expiresAt = Date.now() + 60_000;
      binding = {
        async getContext() {
          if (Date.now() >= expiresAt) return { status: "request_context_expired" };
          return preview.getContext?.() ?? { status: "binding_unavailable" };
        },
        async invoke(connectorId, actionName, args) {
          if (Date.now() >= expiresAt) {
            return { status: "request_context_expired", message: "This request has expired. Please try again." };
          }
          return preview.invoke(connectorId, actionName, args);
        },
      };
    }
    const response=await runWithConnectorBinding(binding, () => handler.fetch(request, env, ctx));
    const secured=new Response(response.body,response);
    secured.headers.set('Content-Security-Policy',"frame-ancestors 'self'");
    secured.headers.set('X-Content-Type-Options','nosniff');
    return secured;
  },
};

export default worker;
