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
export type { DeriveFacetsOptions, Facet, FacetValue } from './facets';
export { deriveFacets } from './facets';
export type { FilterToken } from './filter-query';
export { groupFilterTokens, parseFilterTokens } from './filter-query';
export { matchesQuery } from './matcher';
export type { StackFrame } from './stack-frames';
export { parseStackFrames } from './stack-frames';
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
  BeginRunArgs,
  BeginRunResult,
  CorrelatedLog,
  DescribeTelemetryResult,
  ErrorSpanSummary,
  EventsSinceArgs,
  EventsSinceResult,
  GetRunArgs,
  GetRunResult,
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
  beginRun,
  buildSpanTree,
  describeTelemetry,
  eventsSince,
  getErrors,
  getRun,
  getTrace,
  listRecentTraces,
  replayRequest,
  RUN_ATTR,
  RUN_HEADER,
  searchLogs,
  waitForEvent,
} from './tools';
export type { LogEvent, SidecarEvent, SpanEvent } from './types';
