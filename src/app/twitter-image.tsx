import OpenGraphImage from "./opengraph-image";

// Same card as og:image (summary_large_image). Literal config exports rather than a re-export,
// so Next reads alt/size/contentType from this file directly.
export const alt = "Dulo: The entertainment layer for xStocks.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function TwitterImage() {
  return OpenGraphImage();
}
