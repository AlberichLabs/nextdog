export { createMcpServer } from './server.js';
export {
  SidecarClient,
  SidecarUnavailableError,
  DEFAULT_SIDECAR_URL,
} from './client.js';
export type { EventQuery, SidecarClientOptions } from './client.js';
export {
  listRecentTraces,
  getTrace,
  searchLogs,
  getErrors,
  buildSpanTree,
} from './tools.js';
export type {
  TraceSummary,
  SpanTreeNode,
  GetTraceResult,
  CorrelatedLog,
  SearchLogsArgs,
  ListRecentTracesArgs,
  ErrorSpanSummary,
} from './tools.js';
export { matchesQuery } from './matcher.js';
export { groupFilterTokens, parseFilterTokens } from './filter-query.js';
export type { FilterToken } from './filter-query.js';
export type { SidecarEvent, SpanEvent, LogEvent } from './types.js';
