import MarketingHeader from "@/components/layout/MarketingHeader";
import UtilityBar from "@/components/layout/UtilityBar";
import Footer from "@/components/layout/Footer";

const trustItems = [
  "Terms clear",
  "Funds protected",
  "Evidence recorded",
  "Settlement visible",
  "Mobile ready",
];

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <UtilityBar />
      <MarketingHeader />
      <div className="trust-strip">
        <div className="mx-auto grid min-h-11 max-w-[1440px] grid-cols-2 gap-3 px-4 py-2 text-[12px] text-muted md:grid-cols-5 md:px-6">
          {trustItems.map((item) => (
            <span key={item} className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-gold" aria-hidden="true" />
              {item}
            </span>
          ))}
        </div>
      </div>
      <main className="reclaim-shell">{children}</main>
      <Footer />
    </>
  );
}
