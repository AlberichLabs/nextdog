import { Component, type ComponentChildren } from 'preact';
import { css } from 'styled-system/css';
import { pillStyle } from '../styles/shared.js';
import {
  deriveErrorState,
  type ErrorBoundaryState,
  errorMessage,
  resetState,
} from './error-boundary-logic.js';

interface ErrorBoundaryProps {
  children: ComponentChildren;
}

const containerStyle = css({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100%',
  width: '100%',
  gap: '4',
  padding: '8',
  textAlign: 'center',
});

const headlineStyle = css({
  fontSize: 'xl',
  color: 'fg.bright',
  fontWeight: 600,
});

const messageStyle = css({
  fontSize: 'sm',
  color: 'fg.dim',
  fontFamily: 'mono',
  maxWidth: '600px',
  overflowWrap: 'anywhere',
});

/**
 * Preact error boundary (issue #44).
 *
 * Backstop for the BigInt/timing hardening: if any future render throw escapes
 * the boundary's data guards, the user gets a recoverable in-app error state
 * instead of a blank white screen, and "Dismiss" remounts the subtree (e.g.
 * after exiting an imported file). All decision logic lives in the pure
 * error-boundary-logic.ts module so this wrapper stays trivial and testable via
 * typecheck + build; the only stateful behaviour is "catch -> show fallback ->
 * reset".
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = resetState();

  componentDidCatch(error: unknown) {
    this.setState(deriveErrorState(error));
  }

  handleReset = () => {
    this.setState(resetState());
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className={containerStyle} role="alert">
        <div className={css({ fontSize: '48px', lineHeight: '1' })}>🐾</div>
        <div className={headlineStyle}>Something went wrong rendering this view</div>
        <div className={messageStyle}>{errorMessage(this.state)}</div>
        <button type="button" className={pillStyle} onClick={this.handleReset}>
          Dismiss and retry
        </button>
      </div>
    );
  }
}
