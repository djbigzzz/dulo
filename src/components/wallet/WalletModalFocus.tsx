"use client";

import * as React from "react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";

/** Where focus lands when the wallet modal opens: the first wallet, else "More options", else Close. */
const FIRST_FOCUS = [
  '.wallet-adapter-modal-list .wallet-adapter-button:not([tabindex="-1"])',
  ".wallet-adapter-modal-list-more",
  ".wallet-adapter-modal-button-close",
];

/**
 * Focus management for the wallet-adapter modal (role=dialog, aria-modal), which never moves focus
 * itself: on open, focus goes into the dialog (so Tab walks the modal, whose own handler wraps it),
 * and the icon-only close button gets an accessible name; on close, focus returns to whatever opened
 * it (Connect, Change wallet, a sign-in intent) while that element is still on the page. One place
 * for every opener, so ConnectButton and useSignInIntent need no focus code of their own.
 */
export function WalletModalFocus() {
  const { visible } = useWalletModal();
  const opener = React.useRef<HTMLElement | null>(null);
  const wasVisible = React.useRef(false);

  React.useEffect(() => {
    if (visible && !wasVisible.current) {
      wasVisible.current = true;
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      let tries = 0;
      let id = 0;
      // The modal mounts into a portal after this commit: look for it on the next tick (and a few after).
      const focusIn = () => {
        const modal = document.querySelector<HTMLElement>(".wallet-adapter-modal");
        if (!modal) {
          if (++tries < 5) id = window.setTimeout(focusIn, 30);
          return;
        }
        const close = modal.querySelector<HTMLElement>(".wallet-adapter-modal-button-close");
        if (close && !close.hasAttribute("aria-label")) close.setAttribute("aria-label", "Close");
        for (const selector of FIRST_FOCUS) {
          const el = modal.querySelector<HTMLElement>(selector);
          if (el) {
            el.focus();
            return;
          }
        }
      };
      id = window.setTimeout(focusIn, 0);
      return () => window.clearTimeout(id);
    }
    if (!visible && wasVisible.current) {
      wasVisible.current = false;
      const el = opener.current;
      opener.current = null;
      // After a wallet is picked the trigger may have turned into "Connecting" or unmounted: only a
      // live element gets focus back.
      if (el && el.isConnected) el.focus({ preventScroll: true });
    }
  }, [visible]);

  return null;
}

export default WalletModalFocus;
