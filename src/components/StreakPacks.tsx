import { PACK_SIZE, type Streak } from "@/lib/photos";

/**
 * The streak drawn as a strip of an instant-film pack: filled squares for
 * days already shot, hollow for what's left in the current pack. Today's
 * square is reagent blue once posted, or a hollow reagent outline while
 * it's still waiting to be shot. Quiet by design — structure, not decoration.
 */
export function StreakPacks({ streak }: { streak: Streak }) {
  // `current` doesn't count today until it's posted, so when today is still
  // open we add one more slot for it.
  const totalSlots = streak.postedToday ? streak.current : streak.current + 1;
  const position = ((totalSlots - 1) % PACK_SIZE) + 1;
  const packNumber = Math.floor((totalSlots - 1) / PACK_SIZE) + 1;

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex gap-1.5" aria-hidden="true">
        {Array.from({ length: PACK_SIZE }, (_, i) => {
          const n = i + 1;
          let squareClass = "border border-hairline";
          if (n < position) {
            squareClass = "bg-ink";
          } else if (n === position) {
            squareClass = streak.postedToday
              ? "bg-reagent"
              : "border border-reagent";
          }
          return (
            <span key={n} className={`h-2.5 w-2.5 shrink-0 ${squareClass}`} />
          );
        })}
      </div>
      <p className="label-mono">
        {position} of {PACK_SIZE} · pack {packNumber}
      </p>
    </div>
  );
}
