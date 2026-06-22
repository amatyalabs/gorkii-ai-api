// Safety color language — red is NOT decorative (see CLAUDE.md).
// Red = high-risk / approval required. Everything else is neutral dark grey.
//
// `primary` (orange, approximating Claude's UI accent) is the generic CTA
// color for Login/Send by explicit request — it has overridden green as
// the default "primary action" color from CLAUDE.md. `safe` (green) is
// kept defined and reserved for actual safety/approval states (e.g. the
// future Approve button), since that meaning is still load-bearing there.
export const colors = {
  base: '#1E1F22', // deepest background
  surface: '#2B2D31', // cards, input fields
  elevated: '#313338', // elevated surface (e.g. user message bubble)
  textPrimary: '#F2F3F5',
  textSecondary: '#B5BAC1',
  safe: '#3BA55D', // reserved for true safety/approved states
  risk: '#ED4245', // high-risk / approval-required accent
  primary: '#D97757', // generic CTA accent (Login, Send)
};

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 };

export const radius = { sm: 8, md: 12, lg: 16 };

export const fonts = {
  regular: 'IBMPlexSans_400Regular',
  medium: 'IBMPlexSans_500Medium',
  semibold: 'IBMPlexSans_600SemiBold',
  bold: 'IBMPlexSans_700Bold',
};
