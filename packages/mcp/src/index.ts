export type {
  EventQuery,
  ReplayPayload,
  ReplayPreparedResult,
  ReplayResult,
  ReplaySendResult,
  SidecarClientOptions,
} from './client';
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
  stripSensitiveHeaders,
} from './redact';
export { createMcpServer } from './server';
export type {
  AggregateArgs,
  AggregateResult,
  AssertArgs,
  AssertExpect,
  AssertResult,
  CorrelatedLog,
  ErrorSpanSummary,
  EventsSinceArgs,
  EventsSinceResult,
  GetTraceResult,
  ListRecentTracesArgs,
  ReplayRequestArgs,
  SearchLogsArgs,
  SpanTreeNode,
  TraceSummary,
  WaitForEventArgs,
  WaitForEventResult,
} from './tools';
export {
  aggregate,
  assertTelemetry,
  buildSpanTree,
  eventsSince,
  getErrors,
  getTrace,
  listRecentTraces,
  replayRequest,
  searchLogs,
  waitForEvent,
} from './tools';
export type { LogEvent, SidecarEvent, SpanEvent } from './types';
