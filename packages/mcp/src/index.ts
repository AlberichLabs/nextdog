export type { EventQuery, SidecarClientOptions } from './client';
export {
  DEFAULT_SIDECAR_URL,
  SidecarClient,
  SidecarUnavailableError,
} from './client';
export type { FilterToken } from './filter-query';
export { groupFilterTokens, parseFilterTokens } from './filter-query';
export { matchesQuery } from './matcher';
export {
  isSensitiveAttribute,
  redactAttributes,
  redactEvents,
  SENSITIVE_HEADERS,
} from './redact';
export { createMcpServer } from './server';
export type {
  CorrelatedLog,
  ErrorSpanSummary,
  GetTraceResult,
  ListRecentTracesArgs,
  SearchLogsArgs,
  SpanTreeNode,
  TraceSummary,
} from './tools';
export {
  buildSpanTree,
  getErrors,
  getTrace,
  listRecentTraces,
  searchLogs,
} from './tools';
export type { LogEvent, SidecarEvent, SpanEvent } from './types';
