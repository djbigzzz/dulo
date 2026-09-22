/** Compliance copy shared by every surface that links to a buy or lists Partner marks. Client-safe, no React. */

/** Plain-language line shown next to every buy link (Mirror plan, "Get an xStock in Jupiter") and in the footer. */
export const COMPLIANCE_LINE = "Not investment advice. xStocks are not available to U.S. persons or in restricted jurisdictions.";

/** Shown wherever Partner logos are listed: a logo on Dulo is not an endorsement. */
export const PARTNER_MARKS_NOTICE = "Partner marks belong to their owners; inclusion does not imply endorsement.";

/**
 * Shown next to COMPLIANCE_LINE wherever a PreStocks pre-IPO token is on screen: holdings on
 * /check, the PreStocks Partner page, and a quests board that lists a pre-IPO quest.
 */
export const PRE_IPO_COMPLIANCE_LINE =
  "Not investment advice. Pre-IPO tokens give economic exposure only, with no ownership or voting rights, carry a 1% fee on every transfer, and are not available in the U.S. or to U.S. persons. The companies named do not issue or endorse them.";

/**
 * Token-2022 risk sentence for any surface that leads out to a swap of a pre-IPO token (today:
 * the PreStocks Partner page's outbound links; a copy-a-portfolio plan is xStocks-only).
 */
export const PRE_IPO_TOKEN_2022_NOTE =
  "Pre-IPO tokens are Token-2022 mints on which the issuer holds freeze, pause and permanent-delegate authority and a transfer hook: the issuer can freeze or move a balance without the holder's signature, and every transfer pays a 1% fee. Any swap is yours to make from your own wallet.";
