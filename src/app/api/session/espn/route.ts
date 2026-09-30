/** /api/session/espn: see ./handler.ts. */
import { createEspnSessionHandlers } from "./handler";

export const runtime = "nodejs";

const handlers = createEspnSessionHandlers();

export const GET = handlers.GET;
export const POST = handlers.POST;
export const DELETE = handlers.DELETE;
