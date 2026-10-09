"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

/**
 * Toasts in the Broadcast palette: an ink-3 panel on a 1px cream rule, Archivo, lightly rounded.
 * Green and red only on the success and error icons (they mean "it worked" / "it did not").
 */
const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: (
          <CircleCheckIcon className="size-4 text-yes" />
        ),
        info: (
          <InfoIcon className="size-4 text-muted-foreground" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4 text-foreground" />
        ),
        error: (
          <OctagonXIcon className="size-4 text-no" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin motion-reduce:animate-none" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--rule-2)",
          "--border-radius": "var(--radius)",
          // Sonner's own stylesheet sets a system-ui stack on [data-sonner-toaster]; the inline style wins.
          fontFamily: "var(--font-sans)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
          description: "text-muted-foreground!",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
