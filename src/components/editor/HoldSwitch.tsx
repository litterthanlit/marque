import { cn } from '../../lib/utils.ts'
import { play, setMuted, useMuted } from '../../lib/sound.ts'

/**
 * The hold switch. Held, it mutes every sound and shows its orange, as a
 * recorder's hold locks its keys. M does the same from the keyboard.
 */
export function HoldSwitch({ className }: { className?: string }) {
  const held = useMuted()
  return (
    <button
      type="button"
      role="switch"
      aria-checked={held}
      aria-label="Hold: mute sounds"
      title="Hold: mute sounds (M)"
      onClick={() => {
        setMuted(!held)
        // Let go, it says so with its own click; held, it is already silent.
        if (held) play('toggle')
      }}
      className={cn('group/hold flex shrink-0 items-center gap-2 rounded-sm px-1 py-0.5 outline-offset-2', className)}
    >
      <span aria-hidden="true" className="engraved">
        Hold
      </span>
      <span aria-hidden="true" className="relative h-[11px] w-[34px] overflow-hidden rounded-full bg-black/10 shadow-(--device-recess) dark:bg-black/40">
        <span className="absolute inset-y-0 left-0 w-1/2 bg-(--device-hold) opacity-0 shadow-[inset_0_1px_2px_rgb(0_0_0/0.25)] transition-opacity duration-(--duration-exit) group-aria-checked/hold:opacity-100 group-aria-checked/hold:duration-(--duration-enter)" />
        <span className="absolute inset-y-[1.5px] left-[1.5px] w-[15px] rounded-full [background:var(--device-key-face)] shadow-[0_0_0_0.5px_rgb(0_0_0/0.25),0_1px_1px_rgb(0_0_0/0.2),inset_0_1px_0_rgb(255_255_255/0.8)] transition-transform duration-(--duration-enter) ease-spring group-aria-checked/hold:translate-x-[16px] dark:shadow-[0_0_0_0.5px_rgb(0_0_0/0.8),0_1px_1px_rgb(0_0_0/0.5),inset_0_1px_0_rgb(255_255_255/0.12)]" />
      </span>
    </button>
  )
}
