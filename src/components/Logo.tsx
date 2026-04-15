/**
 * PKIZIP Logo — 부엉이 로고
 *
 * 사용:
 *   1. public/logo-owl.png 에 원본 이미지 저장 (수정/리사이즈 없이 그대로)
 *   2. 컴포넌트가 size prop에 맞춰 자동 크롭/스케일링
 */
interface LogoProps {
  size?: number;
  className?: string;
  /** 'cover' (기본): 영역 채움, 'contain': 원본 비율 유지 */
  fit?: 'cover' | 'contain';
}

const USE_IMAGE_FILE = true;

export function Logo({ size = 24, className, fit = 'cover' }: LogoProps) {
  if (USE_IMAGE_FILE) {
    return (
      <div
        className={className}
        style={{
          width: size,
          height: size,
          overflow: 'hidden',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <img
          src="/logo-owl.png"
          alt="PKIZIP"
          style={{
            width: '100%',
            height: '100%',
            objectFit: fit,
            display: 'block',
          }}
          onError={(e) => {
            // 이미지 없으면 텍스트 폴백
            const t = e.currentTarget;
            t.style.display = 'none';
            const parent = t.parentElement;
            if (parent && !parent.querySelector('.logo-fallback')) {
              const span = document.createElement('span');
              span.className = 'logo-fallback';
              span.textContent = 'P';
              span.style.cssText = `font-weight:800;font-size:${size * 0.5}px;color:white;`;
              parent.appendChild(span);
            }
          }}
        />
      </div>
    );
  }

  // SVG 폴백 (단순 부엉이)
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} xmlns="http://www.w3.org/2000/svg">
      <path d="M12 3.5 C7.5 3.5 4.5 6.5 4.5 10 L4.5 16 C4.5 19 7.5 21 12 21 C16.5 21 19.5 19 19.5 16 L19.5 10 C19.5 6.5 16.5 3.5 12 3.5 Z" fill="currentColor" opacity="0.95" />
      <circle cx="9" cy="9.5" r="2.3" fill="white" />
      <circle cx="15" cy="9.5" r="2.3" fill="white" />
      <circle cx="9" cy="9.5" r="1.2" fill="#18181b" />
      <circle cx="15" cy="9.5" r="1.2" fill="#18181b" />
      <path d="M12 11.5 L11 13 L13 13 Z" fill="#F59E0B" />
    </svg>
  );
}
