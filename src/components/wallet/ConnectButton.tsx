"use client";

import * as React from "react";
import Link from "next/link";
import { Menu } from "@base-ui/react/menu";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import {
  ChevronDownIcon,
  CopyIcon,
  LogOutIcon,
  UserIcon,
  WalletIcon,
  Loader2Icon,
  ArrowLeftRightIcon,
  PlusIcon,
  RepeatIcon,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PointsChip } from "@/components/common/PointsChip";
import { useSession } from "@/hooks/useSession";
import { accountPointsLines, truncateAddress } from "@/hooks/session-helpers";

const menuPopupClass =
  "z-50 min-w-48 rounded-xl bg-popover p-1 text-sm text-popover-foreground shadow-lg ring-1 ring-foreground/10 outline-none transition-[opacity,transform] duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0";

/** The header chip's label: the balance is spendable points, never money. */
const POINTS_CHIP_LABEL = "Points balance, points only, no cash value";

const menuItemClass =
  "flex h-10 cursor-default items-center gap-2 rounded-lg px-3 text-sm outline-none select-none data-highlighted:bg-muted data-highlighted:text-foreground data-disabled:opacity-50 sm:h-8 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground";

/**
 * Wallet entry point for the header.
 *   not connected            -> "Connect wallet" (opens the wallet-adapter modal)
 *   connected, no auth       -> "Sign in" (SIWS) + a small menu to switch/disconnect
 *   signed in                -> truncated address (plus the points balance from xl) with the points
 *                               summary, Profile / Copy / Change wallet / Sign out
 *   signed in, other wallet  -> amber address with "Add this wallet" (links it to the account)
 *                               and "Switch account" (signs in to the account that owns it)
 *
 * Session state comes from the shared <SessionProvider> (useSession reads the context), so
 * this button, every SignInBanner and the page data all move together on sign-in/out.
 */
export function ConnectButton({ className, size = "lg" }: { className?: string; size?: "sm" | "default" | "lg" }) {
  const { connected, connecting, publicKey, disconnect } = useWallet();
  const { setVisible } = useWalletModal();
  const { session, user, loading, signingIn, walletMismatch, signIn, signOut } = useSession();

  // Wallet state only exists on the client; render the neutral state until mounted
  // so server and first client render agree.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const address = publicKey?.toBase58() ?? null;
  const signedIn = Boolean(session && address && session.address === address);

  const openModal = React.useCallback(() => setVisible(true), [setVisible]);

  const copyAddress = React.useCallback(async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      toast.success("Address copied");
    } catch {
      toast.error("Could not copy address");
    }
  }, [address]);

  const changeWallet = React.useCallback(async () => {
    try {
      await disconnect();
    } catch {
      // ignore; the modal lets the user pick anyway
    }
    setVisible(true);
  }, [disconnect, setVisible]);

  if (!mounted || (!connected && !connecting)) {
    return (
      <Button size={size} className={cn("font-semibold", className)} onClick={openModal} disabled={!mounted}>
        <WalletIcon data-icon="inline-start" />
        Connect<span className="-ml-0.5 hidden sm:inline">wallet</span>
      </Button>
    );
  }

  if (connecting || (connected && loading)) {
    return (
      <Button size={size} variant="outline" className={className} disabled>
        <Loader2Icon className="animate-spin" data-icon="inline-start" />
        {connecting ? "Connecting" : "Checking session"}
      </Button>
    );
  }

  if (walletMismatch && session) {
    return (
      <Menu.Root modal={false}>
        <Menu.Trigger
          render={<Button size={size} variant="outline" className={cn("font-mono", className)} aria-label="Wallet not on this account" />}
        >
          {signingIn ? (
            <Loader2Icon className="animate-spin" data-icon="inline-start" />
          ) : (
            <span className="size-2 rounded-full bg-amber-400 shadow-[0_0_8px_theme(colors.amber.400)]" aria-hidden />
          )}
          {truncateAddress(address ?? "")}
          <ChevronDownIcon data-icon="inline-end" className="text-muted-foreground" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner side="bottom" align="end" sideOffset={8} className="z-50 outline-none">
            <Menu.Popup className={cn(menuPopupClass, "max-w-72")}>
              <div className="flex flex-col gap-1 px-3 py-2 text-xs text-muted-foreground">
                <div>
                  Signed in as <span className="font-mono text-foreground">{truncateAddress(session.address)}</span>
                </div>
                <div>
                  Connected wallet <span className="font-mono text-foreground">{truncateAddress(address ?? "")}</span> is not on
                  this account yet.
                </div>
              </div>
              <Menu.Separator className="my-1 h-px bg-border" />
              <Menu.Item className={menuItemClass} disabled={signingIn} onClick={() => void signIn()}>
                <PlusIcon /> Add this wallet
              </Menu.Item>
              <Menu.Item className={menuItemClass} disabled={signingIn} onClick={() => void signIn({ switch: true })}>
                <RepeatIcon /> Switch account
              </Menu.Item>
              <Menu.Separator className="my-1 h-px bg-border" />
              <Menu.Item className={menuItemClass} onClick={() => void copyAddress()}>
                <CopyIcon /> Copy address
              </Menu.Item>
              <Menu.Item className={menuItemClass} onClick={() => void changeWallet()}>
                <ArrowLeftRightIcon /> Change wallet
              </Menu.Item>
              <Menu.Separator className="my-1 h-px bg-border" />
              <Menu.Item className={cn(menuItemClass, "text-destructive data-highlighted:text-destructive [&_svg]:text-destructive")} onClick={() => void signOut()}>
                <LogOutIcon /> Sign out
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    );
  }

  if (!signedIn) {
    return (
      <div className={cn("inline-flex items-center gap-1", className)}>
        <Button size={size} className="font-semibold" onClick={() => void signIn()} disabled={signingIn}>
          {signingIn ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : <WalletIcon data-icon="inline-start" />}
          {signingIn ? "Signing" : "Sign in"}
        </Button>
        <Menu.Root modal={false}>
          <Menu.Trigger
            render={<Button size={size === "lg" ? "icon-lg" : size === "sm" ? "icon-sm" : "icon"} variant="outline" aria-label="Wallet options" />}
          >
            <ChevronDownIcon />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner side="bottom" align="end" sideOffset={8} className="z-50 outline-none">
              <Menu.Popup className={menuPopupClass}>
                <div className="px-3 py-2 text-xs text-muted-foreground">
                  Connected as <span className="font-mono text-foreground">{truncateAddress(address ?? "")}</span>
                </div>
                <Menu.Separator className="my-1 h-px bg-border" />
                <Menu.Item className={menuItemClass} onClick={() => void copyAddress()}>
                  <CopyIcon /> Copy address
                </Menu.Item>
                <Menu.Item className={menuItemClass} onClick={() => void changeWallet()}>
                  <ArrowLeftRightIcon /> Change wallet
                </Menu.Item>
                <Menu.Item className={menuItemClass} onClick={() => void disconnect().catch(() => undefined)}>
                  <LogOutIcon /> Disconnect
                </Menu.Item>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      </div>
    );
  }

  const points = user?.points ?? null;
  const balance = points && Number.isFinite(points.balance) ? points.balance : null;
  const pointsLines = accountPointsLines(points);
  // The chip sits inside the trigger, so the trigger's own label carries what the chip says.
  const triggerLabel = balance === null ? "Account menu" : `Account menu. ${pointsLines[0]}, points only, no cash value`;

  return (
    <Menu.Root modal={false}>
      <Menu.Trigger
        render={<Button size={size} variant="outline" className={cn("font-mono", className)} aria-label={triggerLabel} />}
      >
        <span className="size-2 rounded-full bg-emerald-400 shadow-[0_0_8px_theme(colors.emerald.400)]" aria-hidden />
        {truncateAddress(address ?? "")}
        {/* xl and up only: below that the trigger keeps its measured width, and the menu shows the balance. */}
        {typeof balance === "number" ? (
          <span className="hidden xl:inline-flex" title={POINTS_CHIP_LABEL}>
            <PointsChip points={balance} className="font-sans" />
          </span>
        ) : null}
        <ChevronDownIcon data-icon="inline-end" className="text-muted-foreground" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={8} className="z-50 outline-none">
          <Menu.Popup className={cn(menuPopupClass, "max-w-[min(18rem,calc(100vw-2rem))]")}>
            <div className="px-3 py-2">
              <div className="text-xs text-muted-foreground">Signed in</div>
              <div className="font-mono text-sm break-all">{truncateAddress(address ?? "", 8, 8)}</div>
              {/* Every width, 375px included: the balance first (foreground), then Season points and rank. */}
              <div className="mt-2 flex flex-col gap-0.5 border-t border-white/[0.06] pt-2 text-xs tabular-nums">
                {pointsLines.map((line, i) => (
                  <p key={line} className={i === 0 && pointsLines.length > 1 ? "font-medium text-foreground" : "text-muted-foreground"}>
                    {line}
                  </p>
                ))}
              </div>
            </div>
            <Menu.Separator className="my-1 h-px bg-border" />
            <Menu.LinkItem className={menuItemClass} render={<Link href="/profile" />}>
              <UserIcon /> Profile
            </Menu.LinkItem>
            <Menu.Item className={menuItemClass} onClick={() => void copyAddress()}>
              <CopyIcon /> Copy address
            </Menu.Item>
            <Menu.Item className={menuItemClass} onClick={() => void changeWallet()}>
              <ArrowLeftRightIcon /> Change wallet
            </Menu.Item>
            <Menu.Separator className="my-1 h-px bg-border" />
            <Menu.Item className={cn(menuItemClass, "text-destructive data-highlighted:text-destructive [&_svg]:text-destructive")} onClick={() => void signOut()}>
              <LogOutIcon /> Sign out
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

export default ConnectButton;
