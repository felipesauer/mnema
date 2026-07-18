import type { ReactElement } from 'react';

/**
 * Inline stroke-SVG icons for the dashboard rail (no emoji).
 * Each is a 24×24 lucide-style path set; the rail's CSS supplies stroke,
 * width, linecap via `.nav-i .ic svg`, so these only carry geometry.
 */
type Icon = () => ReactElement;

export const IconOverview: Icon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <rect x="3" y="3" width="7" height="9" />
    <rect x="14" y="3" width="7" height="5" />
    <rect x="14" y="12" width="7" height="9" />
    <rect x="3" y="16" width="7" height="5" />
  </svg>
);

export const IconNeeds: Icon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M22 12h-6l-2 3h-4l-2-3H2" />
    <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
  </svg>
);

export const IconBoard: Icon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M9 3v18M15 3v18" />
  </svg>
);

export const IconEpics: Icon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
  </svg>
);

export const IconGraph: Icon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="5" cy="6" r="2.5" />
    <circle cx="19" cy="6" r="2.5" />
    <circle cx="12" cy="18" r="2.5" />
    <path d="M7 7 10.5 16M17 7 13.5 16M7.5 6h9" />
  </svg>
);

export const IconMetrics: Icon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M3 3v18h18" />
    <path d="m19 9-5 5-4-4-3 3" />
  </svg>
);

export const IconActivity: Icon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M3 3v18h18" />
    <rect x="7" y="11" width="3" height="6" />
    <rect x="12" y="7" width="3" height="10" />
    <rect x="17" y="13" width="3" height="4" />
  </svg>
);

export const IconAudit: Icon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M9 17H7A5 5 0 0 1 7 7h2" />
    <path d="M15 7h2a5 5 0 0 1 0 10h-2" />
    <path d="M8 12h8" />
  </svg>
);

export const IconDrift: Icon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <path d="M12 9v4M12 17h.01" />
  </svg>
);

export const IconDecisions: Icon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6M9 13h6M9 17h4" />
  </svg>
);

export const IconSkills: Icon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="m12 3 2.35 5.26L20 9l-4 4 1 6-5-3-5 3 1-6-4-4 5.65-.74z" />
  </svg>
);

export const IconAgents: Icon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <rect x="4" y="8" width="16" height="12" rx="2" />
    <path d="M12 8V4M9 4h6" />
    <circle cx="9" cy="14" r="1" />
    <circle cx="15" cy="14" r="1" />
  </svg>
);

export const IconCheck: Icon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

export const IconSearch: Icon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
  </svg>
);

export const IconTheme: Icon = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
    <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z" />
  </svg>
);
