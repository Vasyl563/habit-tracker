// Shared between apps/api and apps/web: Zod schemas, DTO types, and the oRPC
// contract. Deliberately *no* database imports here — DTOs are the API's
// promise; entities are the DB's storage. Different things (L8).

export type { Contract } from "./contract.js";
export { contract } from "./contract.js";
export * from "./schemas/index.js";
