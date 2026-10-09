import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

/**
 * Broadcast buttons (docs/DESIGN.md "Buttons"). The variant names are the shadcn ones so every
 * caller keeps working:
 *   default     the gold primary with the slanted cut. ONE per view: it shares the screen's gold
 *               with the week track's "now" marker and nothing else.
 *   secondary   the cream solid ("Make a prediction"): a strong action that is not the primary.
 *   outline     quiet: a dark fill and a 1px cream rule (the header's Connect wallet).
 *   ghost       quieter: muted text, a faint fill on hover.
 *   link        a text link on a 1px rule.
 * The gold fill and its cut live on ::before, so the solid focus ring (a box shadow on the button
 * itself) is never clipped by the cut.
 */
const buttonVariants = cva(
  "group/button relative isolate inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-semibold whitespace-nowrap transition-colors outline-none select-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-background active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 motion-reduce:transition-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // Gold, dark ink, the slanted bottom-right cut. Disabled reads as a grey well with muted text
        // (gold at half opacity would read as a second, weaker gold).
        default:
          "cut-corner rounded-none before:bg-primary text-primary-foreground before:absolute before:-inset-px before:-z-10 before:transition-colors hover:before:bg-[var(--signal-hover)] motion-reduce:before:transition-none disabled:text-muted-foreground disabled:opacity-100 disabled:before:bg-ink-4",
        // Quiet: dark fill, 1px cream rule.
        outline:
          "border-rule-2 bg-ink-3 text-foreground hover:border-[rgb(243_240_232/0.3)] hover:bg-ink-4 aria-expanded:bg-ink-4",
        // Cream solid, ink text.
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[#e6e2d8] aria-expanded:bg-[#e6e2d8] disabled:bg-ink-4 disabled:text-muted-foreground disabled:opacity-100",
        ghost:
          "text-muted-foreground hover:bg-white/[0.05] hover:text-foreground aria-expanded:bg-white/[0.05] aria-expanded:text-foreground",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 dark:bg-destructive/20 dark:hover:bg-destructive/30",
        link: "rounded-none text-foreground bg-[linear-gradient(var(--rule-2),var(--rule-2))] bg-[length:100%_1px] bg-bottom bg-no-repeat hover:bg-[linear-gradient(var(--foreground),var(--foreground))]",
      },
      size: {
        default:
          "h-9 gap-1.5 px-3.5 [--cut:7px] has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs [--cut:5px] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1 rounded-[min(var(--radius-md),12px)] px-3 text-[0.8125rem] [--cut:6px] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-10 gap-2 px-4 text-[0.9375rem] [--cut:8px] has-data-[icon=inline-end]:pr-3.5 has-data-[icon=inline-start]:pl-3.5",
        // The hero size (the mockup's 54px Connect wallet). Usually the landing's one gold action.
        xl: "h-[3.375rem] gap-2.5 px-7 text-[1.0625rem] [--cut:11px] has-data-[icon=inline-end]:pr-6 has-data-[icon=inline-start]:pl-6",
        icon: "size-9 [--cut:6px]",
        "icon-xs":
          "size-6 rounded-[min(var(--radius-md),10px)] [--cut:4px] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-8 rounded-[min(var(--radius-md),12px)] [--cut:5px] in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-10 [--cut:7px]",
      },
    },
    compoundVariants: [
      // A text link sits on the baseline of the copy around it: no box height, no side padding.
      { variant: "link", class: "h-auto px-0 pb-[3px]" },
    ],
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
