import { createContext, useContext } from "react";

/** Site-level UI actions shared by the landing page and the workspace. */
export type SiteUi = { openWelcome: () => void };

export const SiteUiCtx = createContext<SiteUi>({ openWelcome: () => {} });

export function useSiteUi() {
  return useContext(SiteUiCtx);
}
