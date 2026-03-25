'use client'

import { getInitials } from '@/lib/utils'
import { User, Star, Zap, Heart, Shield, Mountain, Moon, Sun, Gem, Cat } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export const PRESET_ICONS: { name: string; Icon: LucideIcon }[] = [
  { name: 'User', Icon: User },
  { name: 'Cat', Icon: Cat },
  { name: 'Star', Icon: Star },
  { name: 'Zap', Icon: Zap },
  { name: 'Heart', Icon: Heart },
  { name: 'Shield', Icon: Shield },
  { name: 'Mountain', Icon: Mountain },
  { name: 'Moon', Icon: Moon },
  { name: 'Sun', Icon: Sun },
  { name: 'Gem', Icon: Gem },
]

const PRESET_MAP: Record<string, LucideIcon> = Object.fromEntries(
  PRESET_ICONS.map(({ name, Icon }) => [name, Icon])
)

interface AvatarProps {
  name: string
  color: string
  size?: 'sm' | 'md' | 'lg'
  avatarUrl?: string | null
}

const sizeClasses = {
  sm: 'w-6 h-6 text-xs',
  md: 'w-8 h-8 text-sm',
  lg: 'w-10 h-10 text-base',
}

const iconSizeClasses = {
  sm: 'w-3 h-3',
  md: 'w-4 h-4',
  lg: 'w-5 h-5',
}

export function Avatar({ name, color, size = 'md', avatarUrl }: AvatarProps) {
  // Custom uploaded photo
  if (avatarUrl && !avatarUrl.startsWith('preset:')) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        className={`${sizeClasses[size]} rounded-full object-cover shrink-0 bg-[#333]`}
        title={name}
      />
    )
  }

  // Preset lucide icon
  if (avatarUrl?.startsWith('preset:')) {
    const iconName = avatarUrl.split(':')[1]
    const Icon = PRESET_MAP[iconName]
    if (Icon) {
      return (
        <div
          className={`${sizeClasses[size]} rounded-full flex items-center justify-center shrink-0`}
          style={{ backgroundColor: color }}
          title={name}
        >
          <Icon className={`${iconSizeClasses[size]} text-white`} strokeWidth={2} />
        </div>
      )
    }
  }

  // Default: initials
  return (
    <div
      className={`${sizeClasses[size]} rounded-full flex items-center justify-center font-semibold text-white shrink-0`}
      style={{ backgroundColor: color }}
      title={name}
    >
      {getInitials(name)}
    </div>
  )
}
