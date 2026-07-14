import { useRef } from 'react';
import Svg, { Defs, LinearGradient as SvgGradient, Stop, Circle, Rect } from 'react-native-svg';
import { colors } from '../constants/theme';

// Each BrandMark needs its own gradient id — react-native-svg keys gradient
// defs by id, so reusing one across instances can collide.
let gradSeq = 0;

// Circle + cross brand mark, drawn in SVG so the disc can carry a subtle
// orange gradient. Shared by the login gate and the chat screen so every
// logo in the app is identical; all measurements derive from `size`.
export default function BrandMark({ size = 96, barColor = colors.textPrimary }) {
  const gradId = useRef(`brandGrad${gradSeq++}`).current;
  const c = size / 2;
  const bar = Math.max(3, size * 0.088); // thicker cross
  const barLen = size * 0.4;
  const r = bar / 2;
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Defs>
        <SvgGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#D97757" />
          <Stop offset="0.62" stopColor="#D97757" />
          <Stop offset="1" stopColor="#EAB39B" />
        </SvgGradient>
      </Defs>
      <Circle cx={c} cy={c} r={c} fill={`url(#${gradId})`} />
      {/* vertical bar */}
      <Rect x={c - bar / 2} y={c - barLen / 2} width={bar} height={barLen} rx={r} fill={barColor} />
      {/* horizontal bar */}
      <Rect x={c - barLen / 2} y={c - bar / 2} width={barLen} height={bar} rx={r} fill={barColor} />
    </Svg>
  );
}
