const LEVELS = [
  { id: "cpv-rgb-low", offset: 0.0025 },
  { id: "cpv-rgb-mid", offset: 0.0045 },
  { id: "cpv-rgb-high", offset: 0.0072 },
];

export function RgbFilterDefs() {
  return (
    <svg
      aria-hidden="true"
      width="0"
      height="0"
      style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}
    >
      <defs>
        {LEVELS.map((level) => (
          <filter
            key={level.id}
            id={level.id}
            x="-10%"
            y="-10%"
            width="120%"
            height="120%"
            primitiveUnits="objectBoundingBox"
            colorInterpolationFilters="sRGB"
          >
            <feColorMatrix
              in="SourceGraphic"
              type="matrix"
              values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
              result="red"
            />
            <feOffset in="red" dx={level.offset} dy="0" result="redOffset" />
            <feColorMatrix
              in="SourceGraphic"
              type="matrix"
              values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"
              result="green"
            />
            <feColorMatrix
              in="SourceGraphic"
              type="matrix"
              values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"
              result="blue"
            />
            <feOffset in="blue" dx={-level.offset} dy="0" result="blueOffset" />
            <feBlend in="redOffset" in2="green" mode="screen" result="redGreen" />
            <feBlend in="redGreen" in2="blueOffset" mode="screen" />
          </filter>
        ))}
      </defs>
    </svg>
  );
}