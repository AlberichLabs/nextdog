export type { EventQuery, SidecarClientOptions } from './client.js';
export {
  DEFAULT_SIDECAR_URL,
  SidecarClient,
  SidecarUnavailableError,
} from './client.js';
export type { FilterToken } from './filter-query.js';
export { groupFilterTokens, parseFilterTokens } from './filter-query.js';
export { matchesQuery } from './matcher.js';
export { createMcpServer } from './server.js';
export type {
  CorrelatedLog,
  ErrorSpanSummary,
  GetTraceResult,
  ListRecentTracesArgs,
  SearchLogsArgs,
  SpanTreeNode,
  TraceSummary,
} from './tools.js';
export {
  buildSpanTree,
  getErrors,
  getTrace,
  listRecentTraces,
  searchLogs,
} from './tools.js';
export type { LogEvent, SidecarEvent, SpanEvent } from './types.js';
