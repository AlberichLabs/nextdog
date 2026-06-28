interface LogoProps {
  size?: number;
}

export function Logo({ size = 20 }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      role="img"
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>nextdog</title>
      {/* Head — rounded square, wider than tall */}
      <rect
        x="10"
        y="20"
        width="44"
        height="38"
        rx="16"
        fill="#f0efed"
        stroke="#333"
        stroke-width="1.5"
      />

      {/* Ears — connected to head corners */}
      <path
        d="M14 22L18 4L26 20"
        fill="#f0efed"
        stroke="#333"
        stroke-width="1.5"
        stroke-linejoin="round"
      />
      <path
        d="M50 22L46 4L38 20"
        fill="#f0efed"
        stroke="#333"
        stroke-width="1.5"
        stroke-linejoin="round"
      />
      {/* Inner ear pink */}
      <path d="M17 20L18 8L25 19" fill="#e8b4b8" />
      <path d="M47 20L46 8L39 19" fill="#e8b4b8" />

      {/* Snout area */}
      <ellipse cx="32" cy="44" rx="9" ry="7" fill="#e8e6e3" />

      {/* Eyes */}
      <ellipse cx="24" cy="36" rx="3" ry="3.5" fill="#222" />
      <ellipse cx="40" cy="36" rx="3" ry="3.5" fill="#222" />
      <circle cx="25.2" cy="34.8" r="1" fill="white" />
      <circle cx="41.2" cy="34.8" r="1" fill="white" />

      {/* Nose */}
      <ellipse cx="32" cy="42" rx="2.5" ry="1.8" fill="#333" />

      {/* Mouth */}
      <path
        d="M29 45.5C30.5 47 33.5 47 35 45.5"
        stroke="#333"
        stroke-width="1.2"
        stroke-linecap="round"
        fill="none"
      />

      {/* Collar */}
      <path
        d="M14 54C20 58 26 60 32 60C38 60 44 58 50 54"
        stroke="#c0392b"
        stroke-width="2.5"
        stroke-linecap="round"
        fill="none"
      />
    </svg>
  );
}

export const logoSvgString = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
  <rect x="10" y="20" width="44" height="38" rx="16" fill="#f0efed" stroke="#333" stroke-width="1.5"/>
  <path d="M14 22L18 4L26 20" fill="#f0efed" stroke="#333" stroke-width="1.5" stroke-linejoin="round"/>
  <path d="M50 22L46 4L38 20" fill="#f0efed" stroke="#333" stroke-width="1.5" stroke-linejoin="round"/>
  <path d="M17 20L18 8L25 19" fill="#e8b4b8"/>
  <path d="M47 20L46 8L39 19" fill="#e8b4b8"/>
  <ellipse cx="32" cy="44" rx="9" ry="7" fill="#e8e6e3"/>
  <ellipse cx="24" cy="36" rx="3" ry="3.5" fill="#222"/>
  <ellipse cx="40" cy="36" rx="3" ry="3.5" fill="#222"/>
  <circle cx="25.2" cy="34.8" r="1" fill="white"/>
  <circle cx="41.2" cy="34.8" r="1" fill="white"/>
  <ellipse cx="32" cy="42" rx="2.5" ry="1.8" fill="#333"/>
  <path d="M29 45.5C30.5 47 33.5 47 35 45.5" stroke="#333" stroke-width="1.2" stroke-linecap="round" fill="none"/>
  <path d="M14 54C20 58 26 60 32 60C38 60 44 58 50 54" stroke="#c0392b" stroke-width="2.5" stroke-linecap="round" fill="none"/>
</svg>`;
