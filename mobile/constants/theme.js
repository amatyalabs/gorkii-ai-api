// Safety color language — green/red are NOT decorative (see CLAUDE.md).
// Green = safe / primary action. Red = high-risk / approval required.
// Everything else is neutral dark grey.
export const colors = {
  base: '#1E1F22', // deepest background
  surface: '#2B2D31', // cards, input fields
  elevated: '#313338', // elevated surface (e.g. user message bubble)
  textPrimary: '#F2F3F5',
  textSecondary: '#B5BAC1',
  safe: '#3BA55D', // safe / primary action accent
  risk: '#ED4245', // high-risk / approval-required accent

  // Send-button accent only — approximation of Claude's UI orange.
  // Outside the green/red safety language by explicit request; everywhere
  // else still follows "one accent at a time, neutral grey otherwise."
  sendAccent: '#D97757',
};

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 };

export const radius = { sm: 8, md: 12, lg: 16 };
