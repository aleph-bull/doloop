/**
 * A clock's digits, each in its own box. With a timer font of their own (`data-timer-font` on
 * <html>) every box is one figure wide, so a font whose 1 is narrower than its 0 doesn't make
 * the clock shuffle sideways every second. Inter's figures are one width already: there the
 * boxes are plain text.
 */
export function ClockDigits({ digits }: { digits: string }) {
  return (
    <>
      {[...digits].map((c, i) =>
        c >= '0' && c <= '9' ? (
          <span key={i} className="clock-digit">
            {c}
          </span>
        ) : (
          c
        ),
      )}
    </>
  );
}
