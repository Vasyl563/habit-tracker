import type { Contract } from "@habit-tracker/types";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";

/**
 * The typed API client (L5/L8): `ContractRouterClient<Contract>` gives every
 * procedure its input/output types straight from the shared contract — the
 * same Zod schemas the server validates with. No hand-written DTOs, no
 * copy-paste, from Drizzle row to JSX.
 */
const link = new RPCLink({
  url: `${window.location.origin}/rpc`,
  fetch: (request, init) => globalThis.fetch(request, { ...init, credentials: "include" })
});

export const client: ContractRouterClient<Contract> = createORPCClient(link);

/** TanStack Query helpers: `orpc.habits.list.queryOptions({ input })` etc. */
export const orpc = createTanstackQueryUtils(client);
