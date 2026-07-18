import MarketingHeader from "@/components/layout/MarketingHeader";
import UtilityBar from "@/components/layout/UtilityBar";
import Footer from "@/components/layout/Footer";

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <UtilityBar />
      <MarketingHeader />
      <main>{children}</main>
      <Footer />
    </>
  );
}
