import * as Icons from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

interface ProjectIconShape {
  name: string
  icon_type: 'lucide' | 'emoji' | 'image' | null
  icon_value: string | null
  color: string | null
}

interface ProjectIconProps {
  project: ProjectIconShape
  /** 정사각 변 길이(px). 기본 28 */
  size?: number
  className?: string
}

const DEFAULT_COLOR = '#6366f1'

/** 'flask-conical' | 'home' → 'FlaskConical' | 'Home' (lucide-react export 키) */
function toPascal(value: string): string {
  return value.replace(/(^\w|-\w)/g, (s) => s.replace('-', '').toUpperCase())
}

/**
 * 프로젝트 아이콘. icon_type에 따라 image/emoji/lucide를 렌더하고,
 * 미설정 시 색 박스 + 이름 첫 글자로 폴백한다.
 */
export default function ProjectIcon({ project, size = 28, className = '' }: ProjectIconProps) {
  const { name, icon_type, icon_value, color } = project
  const dim = { width: size, height: size }
  const radius = Math.max(6, Math.round(size * 0.28))
  const boxStyle = { ...dim, borderRadius: radius }

  if (icon_type === 'image' && icon_value) {
    return (
      <span
        role="img"
        aria-label={name}
        className={`inline-block shrink-0 bg-cover bg-center ${className}`}
        style={{
          ...boxStyle,
          backgroundImage: `url(${icon_value})`,
        }}
      />
    )
  }

  if (icon_type === 'emoji' && icon_value) {
    return (
      <span
        className={`inline-flex items-center justify-center shrink-0 ${className}`}
        style={{ ...boxStyle, backgroundColor: `${color ?? DEFAULT_COLOR}22`, fontSize: size * 0.6 }}
        aria-label={name}
      >
        {icon_value}
      </span>
    )
  }

  if (icon_type === 'lucide' && icon_value) {
    const key = toPascal(icon_value) as keyof typeof Icons
    const Cmp = (Icons[key] as LucideIcon | undefined) ?? Icons.Folder
    return (
      <span
        className={`inline-flex items-center justify-center shrink-0 text-white ${className}`}
        style={{ ...boxStyle, backgroundColor: color ?? DEFAULT_COLOR }}
        aria-label={name}
      >
        <Cmp style={{ width: size * 0.58, height: size * 0.58 }} />
      </span>
    )
  }

  // 폴백: 색 박스 + 이름 첫 글자
  const initial = [...(name ?? '')][0] ?? '?'
  return (
    <span
      className={`inline-flex items-center justify-center shrink-0 font-semibold text-white ${className}`}
      style={{ ...boxStyle, backgroundColor: color ?? DEFAULT_COLOR, fontSize: size * 0.46 }}
      aria-label={name}
    >
      {initial}
    </span>
  )
}
