// Rivy's avatar: Rivero's symbol (the filled shape and its two outlines) with
// eyes and a smile. Decorative: the button around it carries the name.
const SHAPE = 'M9 10C7.5 10 7 11.5 7.6 13C9.4 18 9.4 30 7.6 35C7 36.5 7.5 38 9 38C20 37 28 30 30 24C28 18 20 11 9 10Z';

export function RivyAvatar({ size = 32 }: { size?: number }) {
  return (
    <svg className="rivy-avatar" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      {/* The outlines move on hover (CSS on the group keeps each offset). */}
      <g className="rivy-avatar-echo two">
        <path d={SHAPE} transform="translate(10 0)" />
      </g>
      <g className="rivy-avatar-echo one">
        <path d={SHAPE} transform="translate(5 0)" />
      </g>
      <path className="rivy-avatar-face" d={SHAPE} />
      <circle className="rivy-avatar-eye" cx="14" cy="20.5" r="1.7" />
      <circle className="rivy-avatar-eye" cx="20" cy="20.5" r="1.7" />
      <path className="rivy-avatar-smile" d="M12.6 26.2Q17 30.2 21.4 26.2" />
    </svg>
  );
}
