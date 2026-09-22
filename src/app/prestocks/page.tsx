import { PreStocksView } from "@/components/prestocks/PreStocksView";

/** Server shell; every read happens on the client through /api/v1 like the other game pages. */
export default function PreStocksPage() {
  return <PreStocksView />;
}
