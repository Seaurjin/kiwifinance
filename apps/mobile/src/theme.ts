/**
 * Tokens, shared with the web app's CSS variables so a figure looks the same
 * on both. Two full sets rather than a computed inversion: dark mode is
 * chosen, not derived.
 */

import { Platform, useColorScheme } from 'react-native';

export interface Theme {
  paper: string;
  surface: string;
  ink: string;
  ink2: string;
  muted: string;
  rule: string;
  ruleStrong: string;
  accent: string;
  accentSoft: string;
  risk: string;
  caution: string;
  onAccent: string;
}

const light: Theme = {
  paper: '#F6F8F4',
  surface: '#FFFFFF',
  ink: '#161E19',
  ink2: '#3D4A42',
  muted: '#6D7A71',
  rule: '#DCE3DA',
  ruleStrong: '#B9C4B7',
  accent: '#2F6B4F',
  accentSoft: '#E2EDE4',
  risk: '#A9413A',
  caution: '#946117',
  onAccent: '#F6F8F4',
};

const dark: Theme = {
  paper: '#10140F',
  surface: '#181E19',
  ink: '#E9EFE6',
  ink2: '#BDC8BC',
  muted: '#8E9B8F',
  rule: '#2A322B',
  ruleStrong: '#3E4A40',
  accent: '#77C494',
  accentSoft: '#1E2C23',
  risk: '#E4867C',
  caution: '#D8A94E',
  onAccent: '#10140F',
};

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}

/** Tabular figures, so amounts in a column line up. */
export const mono = Platform.select({
  ios: 'Menlo',
  default: 'monospace',
});

export const type = {
  eyebrow: { fontSize: 11, letterSpacing: 1.6, fontFamily: mono },
  title: { fontSize: 28, fontWeight: '700' as const, letterSpacing: -0.3 },
  section: { fontSize: 12, letterSpacing: 1.4, fontFamily: mono, fontWeight: '600' as const },
  body: { fontSize: 15 },
  meta: { fontSize: 12.5 },
  amount: { fontSize: 15, fontFamily: mono },
  hero: { fontSize: 24, fontWeight: '700' as const, fontFamily: mono },
};
