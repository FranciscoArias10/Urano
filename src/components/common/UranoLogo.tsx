import React from 'react';

interface UranoLogoProps {
  className?: string;
  size?: number;
}

export const UranoLogo: React.FC<UranoLogoProps> = ({ className = '', size = 24 }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <defs>
        <linearGradient id="uranoFacetTop" x1="50" y1="8" x2="32" y2="42" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#ff8c42" />
          <stop offset="100%" stopColor="#ea580c" />
        </linearGradient>
        <linearGradient id="uranoFacetRight" x1="50" y1="8" x2="78" y2="38" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#fba160" />
          <stop offset="100%" stopColor="#d9480f" />
        </linearGradient>
        <linearGradient id="uranoFacetCenter" x1="32" y1="42" x2="68" y2="62" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#ffd166" />
          <stop offset="50%" stopColor="#f97316" />
          <stop offset="100%" stopColor="#c2410c" />
        </linearGradient>
        <linearGradient id="uranoFacetLeft" x1="16" y1="48" x2="42" y2="78" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#ea580c" />
          <stop offset="100%" stopColor="#9a3412" />
        </linearGradient>
        <linearGradient id="uranoFacetBottomRight" x1="78" y1="38" x2="52" y2="92" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#d9480f" />
          <stop offset="100%" stopColor="#7c2d12" />
        </linearGradient>
        <linearGradient id="uranoFacetBottom" x1="42" y1="78" x2="52" y2="92" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#9a3412" />
          <stop offset="100%" stopColor="#431407" />
        </linearGradient>
      </defs>

      {/* Uranium Core Glow */}
      <circle cx="50" cy="50" r="28" fill="#f97316" opacity="0.22" />

      {/* Faceted Crystal */}
      <g>
        <polygon points="50,8 24,34 35,46 50,38" fill="url(#uranoFacetTop)" stroke="#ffb27d" strokeWidth="0.8" strokeLinejoin="round" />
        <polygon points="50,8 50,38 72,42 80,26" fill="url(#uranoFacetRight)" stroke="#ffc49b" strokeWidth="0.8" strokeLinejoin="round" />
        <polygon points="50,38 35,46 44,66 65,60 72,42" fill="url(#uranoFacetCenter)" stroke="#ffe49e" strokeWidth="0.8" strokeLinejoin="round" />
        <polygon points="24,34 14,56 30,70 35,46" fill="url(#uranoFacetLeft)" stroke="#f97316" strokeWidth="0.8" strokeLinejoin="round" />
        <polygon points="80,26 72,42 86,60 88,44" fill="#c2410c" stroke="#f97316" strokeWidth="0.8" strokeLinejoin="round" />
        <polygon points="72,42 65,60 52,92 86,60" fill="url(#uranoFacetBottomRight)" stroke="#ea580c" strokeWidth="0.8" strokeLinejoin="round" />
        <polygon points="35,46 30,70 52,92 44,66" fill="#9a3412" stroke="#ea580c" strokeWidth="0.8" strokeLinejoin="round" />
        <polygon points="44,66 52,92 65,60" fill="url(#uranoFacetBottom)" stroke="#ea580c" strokeWidth="0.8" strokeLinejoin="round" />
        <polygon points="50,42 42,48 48,58 56,52" fill="#fff7ed" opacity="0.65" />
      </g>
    </svg>
  );
};
