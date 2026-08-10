import ProductHeader from "@/components/layout/ProductHeader";
import UtilityBar from "@/components/layout/UtilityBar";
import Footer from "@/components/layout/Footer";

export default function ProductLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const trustItems = [
    "Terms clear",
    "Funds protected",
    "Evidence recorded",
    "Settlement visible",
    "Wallet ready",
  ];

  return (
    <div className="product-app min-h-screen bg-page text-ink">
      <UtilityBar />
      <ProductHeader />
      <div className="trust-strip product-trust-strip">
        <div className="mx-auto grid min-h-10 max-w-[1440px] grid-cols-2 items-center gap-x-4 gap-y-2 px-4 py-2 text-[12px] text-muted md:grid-cols-5 md:px-6">
          {trustItems.map((item) => (
            <span
              key={item}
              className="flex items-center gap-2 font-[family-name:var(--font-ibm-plex-mono)] tabular-nums"
            >
              <span
                className="h-1.5 w-1.5 rounded-full bg-gold"
                aria-hidden="true"
              />
              {item}
            </span>
          ))}
        </div>
      </div>
      <main className="reclaim-shell min-h-[calc(100vh-4rem)]">{children}</main>
      <Footer />
    </div>
  );
}
