import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
export const NETWORK = process.env.MIDNIGHT_NETWORK ?? "preview";
setNetworkId(NETWORK);
export const CONFIG = NETWORK === "undeployed" ? {
  indexerHttpUrl: "http://127.0.0.1:8088/api/v4/graphql", indexerWsUrl: "ws://127.0.0.1:8088/api/v4/graphql/ws",
  node: "http://127.0.0.1:9944", proofServer: process.env.PROOF_SERVER ?? "http://127.0.0.1:6300",
} : {
  indexerHttpUrl: `https://indexer.${NETWORK}.midnight.network/api/v4/graphql`, indexerWsUrl: `wss://indexer.${NETWORK}.midnight.network/api/v4/graphql/ws`,
  node: `https://rpc.${NETWORK}.midnight.network`, proofServer: process.env.PROOF_SERVER ?? "http://127.0.0.1:6300",
};
