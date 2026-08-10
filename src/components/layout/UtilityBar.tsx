export default function UtilityBar() {
  return (
    <div className="bg-utility text-[12px] font-[family-name:var(--font-georama)] text-page/72">
      <div className="mx-auto flex h-8 max-w-[1440px] items-center justify-between gap-4 px-4 md:px-6">
        <span className="flex items-center gap-2 font-[family-name:var(--font-ibm-plex-mono)] tabular-nums text-page/86">
          <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />
          Celo Sepolia
        </span>
        <span className="hidden sm:inline">
          USDC terms, evidence and receipts kept in one shared room
        </span>
        <span className="font-[family-name:var(--font-ibm-plex-mono)] tabular-nums text-gold-on-dark">
          support ready
        </span>
      </div>
    </div>
  );
}
