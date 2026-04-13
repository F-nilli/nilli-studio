import { Track, UserRole } from './types'

export const MEMBER_COLORS: Record<string, string> = {
  eph: '#f7931a',
  abdo: '#60a5fa',
  nguyen: '#a78bfa',
  donya: '#f472b6',
  zeeshan: '#34d399',
  ali: '#fb923c',
  phil: '#38bdf8',
  francis: '#fbbf24',
}

export const TRACK_COLORS: Record<Track, string> = {
  'Long-form': '#f7931a',
  'Trailer': '#60a5fa',
  'Thumbnails': '#34d399',
  'Clips & Shorts': '#a78bfa',
  'Review': '#fb923c',
  'Publishing': '#38bdf8',
}

export const CLIENT_LABELS: Record<string, string> = {
  brandon_gentile: 'Brandon Gentile',
  bitcoin_edge: 'Bitcoin Edge',
  peruvian_bull: 'Peruvian Bull',
  walker_america: 'Walker America',
  youre_the_voice: "You're The Voice",
}

export const TEAM_MEMBERS = [
  { name: 'Francis', email: 'francis@nillistudio.com', role: 'admin' as UserRole, color: '#fbbf24' },
  { name: 'Ali', email: 'ali@nillistudio.com', role: 'member' as UserRole, color: '#fb923c' },
  { name: 'Eph', email: 'eph@nillistudio.com', role: 'member' as UserRole, color: '#f7931a' },
  { name: 'Abdo', email: 'abdo@nillistudio.com', role: 'member' as UserRole, color: '#60a5fa' },
  { name: 'Nguyen', email: 'nguyen@nillistudio.com', role: 'member' as UserRole, color: '#a78bfa' },
  { name: 'Donya', email: 'donya@nillistudio.com', role: 'member' as UserRole, color: '#f472b6' },
  { name: 'Zeeshan', email: 'zeeshan@nillistudio.com', role: 'member' as UserRole, color: '#34d399' },
  { name: 'Phil', email: 'phil@nillistudio.com', role: 'member' as UserRole, color: '#38bdf8' },
]
