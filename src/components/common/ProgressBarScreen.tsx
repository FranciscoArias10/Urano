import React from 'react';

export interface ProgressBarScreenProps {
  message?: string;
  isFadingOut?: boolean;
}

/**
 * Obsidian 1:1 Startup Loading Progress Bar Screen
 * Evidence: REA extraction of /usr/lib/obsidian/app.asar/app.js & app.css
 */
export const ProgressBarScreen: React.FC<ProgressBarScreenProps> = ({
  message,
  isFadingOut = false,
}) => {
  return (
    <div
      className={`progress-bar-container${isFadingOut ? ' is-fading-out' : ''}`}
      role="progressbar"
      aria-label={message || 'Cargando...'}
    >
      <div className="progress-bar">
        {message && <div className="progress-bar-message u-center-text">{message}</div>}
        <div className="progress-bar-indicator">
          <div className="progress-bar-line" />
          <div className="progress-bar-subline mod-increase" />
          <div className="progress-bar-subline mod-decrease" />
        </div>
        <div className="progress-bar-context" />
      </div>
    </div>
  );
};
