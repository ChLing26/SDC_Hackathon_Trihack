export function StationeryDecor() {
  return (
    <div className="stationery-decor" aria-hidden="true">
      <svg
        className="stationery-doodle stationery-clips"
        viewBox="0 0 120 150"
        fill="none"
        focusable="false"
      >
        <path
          d="M44 17 88 69a14 14 0 0 1-22 18L26 38a10 10 0 0 1 16-13l36 42a6 6 0 0 1-9 8L37 37"
          stroke="hsl(160 31% 48%)"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="m75 9 25 65a14 14 0 0 1-26 10L53 34a10 10 0 0 1 19-7l19 49a6 6 0 0 1-11 4L61 35"
          stroke="hsl(348 45% 66%)"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>

      <svg
        className="stationery-doodle stationery-ruler"
        viewBox="0 0 190 160"
        fill="none"
        focusable="false"
      >
        <path
          d="M14 145 74 18l98 127H14Z"
          fill="hsl(348 45% 66% / .12)"
          stroke="hsl(348 45% 66% / .66)"
          strokeWidth="5"
          strokeLinejoin="round"
        />
        <path
          d="m29 135 49-101m-33 106 6-12m7 15 7-14m8 16 6-13m9 15 7-14m9 16 6-13m9 15 7-14m9 16 6-13m8 14 8-16m-91-91 11 8m-15 2 10 8m-14 2 10 8"
          stroke="hsl(164 24% 30% / .72)"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>

      <svg
        className="stationery-doodle stationery-pencils"
        viewBox="0 0 180 270"
        fill="none"
        focusable="false"
      >
        <g transform="rotate(18 57 135)">
          <path d="m43 30 27 1-2 185-27-1L43 30Z" fill="hsl(278 35% 75%)" />
          <path d="m42 30 28 1-1 18-28-1 1-18Z" fill="hsl(348 45% 66%)" />
          <path d="m43 215 25 1-13 31-12-32Z" fill="hsl(35 42% 76%)" />
          <path d="m49 230 6 16 7-15" fill="hsl(164 24% 27%)" />
          <path d="m43 69 27 1" stroke="hsl(42 67% 99% / .72)" strokeWidth="7" />
        </g>
        <g transform="rotate(18 120 145)">
          <path d="m107 43 27 1-2 180-27-1 2-180Z" fill="hsl(202 47% 68%)" />
          <path d="m107 43 27 1-1 18-27-1 1-18Z" fill="hsl(194 38% 89%)" />
          <path d="m105 224 25 1-13 31-12-32Z" fill="hsl(35 42% 76%)" />
          <path d="m111 239 6 16 7-15" fill="hsl(164 24% 27%)" />
          <path d="m106 85 27 1" stroke="hsl(42 67% 99% / .72)" strokeWidth="7" />
        </g>
      </svg>
    </div>
  );
}
