import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  failed: boolean;
}

export default class PreviewErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // The preview remains isolated; file processing and search can continue.
  }

  render(): ReactNode {
    if (this.state.failed) {
      return <p className="preview-pane__status preview-pane__status--error">Failed to load this preview.</p>;
    }
    return this.props.children;
  }
}
