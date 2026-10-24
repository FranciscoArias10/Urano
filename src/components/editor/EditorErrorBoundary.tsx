import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, BookOpen } from 'lucide-react';
import { useT } from '../../stores/localeStore';

interface Props {
  children: ReactNode;
  noteName?: string;
  onOpenReadingMode?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

interface FallbackProps {
  noteName?: string;
  error: Error | null;
  onRetry: () => void;
  onOpenReadingMode?: () => void;
}

/** Error UI lives in a function component so `useT()` can re-render it on language change. */
const EditorErrorFallback = ({ noteName, error, onRetry, onOpenReadingMode }: FallbackProps) => {
  const t = useT();
  return (
    <div className="flex-1 h-full flex flex-col items-center justify-center p-8 bg-[#181818] text-stone-200 select-none">
      <div className="max-w-lg w-full bg-[#1e1e1e] border border-orange-500/40 rounded-xl p-6 shadow-2xl flex flex-col gap-4">
        <div className="flex items-center gap-3 text-orange-500">
          <div className="p-2 bg-orange-500/10 rounded-lg border border-orange-500/20">
            <AlertTriangle size={24} />
          </div>
          <div>
            <h3 className="font-semibold text-white text-base">{t('errorBoundary.title')}</h3>
            <p className="text-xs text-stone-400">{noteName || t('errorBoundary.document')}</p>
          </div>
        </div>

        <p className="text-xs text-stone-300 leading-relaxed">{t('errorBoundary.description')}</p>

        {error && (
          <div className="bg-[#141414] border border-stone-800 rounded-lg p-3 text-[11px] font-mono text-red-400 max-h-36 overflow-auto select-text">
            <p className="font-bold">{error.message}</p>
            {error.stack && (
              <p className="text-stone-500 mt-1 whitespace-pre-wrap text-[10px]">{error.stack}</p>
            )}
          </div>
        )}

        <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-stone-800">
          {onOpenReadingMode && (
            <button
              onClick={onOpenReadingMode}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-200 text-xs font-medium transition-colors"
            >
              <BookOpen size={13} />
              <span>{t('errorBoundary.openReadingMode')}</span>
            </button>
          )}

          <button
            onClick={onRetry}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-500 text-white text-xs font-medium transition-colors shadow-sm"
          >
            <RefreshCw size={13} />
            <span>{t('common.retry')}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export class EditorErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[Urano EditorErrorBoundary] Error capturado en el editor:', error, errorInfo);
    this.setState({ errorInfo });
    try {
      localStorage.setItem(
        'urano_last_editor_error',
        JSON.stringify({
          note: this.props.noteName,
          message: error.message,
          stack: error.stack,
          time: new Date().toISOString(),
        })
      );
    } catch {}
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <EditorErrorFallback
          noteName={this.props.noteName}
          error={this.state.error}
          onRetry={this.handleRetry}
          onOpenReadingMode={this.props.onOpenReadingMode}
        />
      );
    }

    return this.props.children;
  }
}
