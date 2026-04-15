import { useMemo } from 'react';
import { toSvg } from 'jdenticon';

interface IdenticonProps {
  value: string;   // fingerprint or any unique string
  size?: number;
  className?: string;
}

/**
 * Identicon — 핑거프린트 기반 고유 아바타 이미지
 * 인증서에 logotype 확장 필드가 없을 때 기본 아바타로 사용
 */
export function Identicon({ value, size = 80, className }: IdenticonProps) {
  const svg = useMemo(() => toSvg(value, size, {
    padding: 0.08,
    backColor: '#00000000',
    saturation: { color: 0.6 },
    lightness: { color: [0.35, 0.65], grayscale: [0.35, 0.65] },
  }), [value, size]);

  return (
    <div
      className={className}
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
