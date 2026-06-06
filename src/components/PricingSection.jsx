import { useState, useEffect } from 'react';

const tiers = [
  {
    label: 'One-time',
    title: 'Site Build',
    cashPrice: '$2,000',
    cryptoPrice: '1 ETH',
    cryptoEth: 1,
    unit: 'flat',
    items: [
      'Up to 5 pages',
      'Mobile-first design',
      'Contact form included',
      '2 rounds of revisions',
      'Deployed and handed off',
    ],
  },
  {
    label: 'Monthly',
    title: 'Managed Presence',
    cashPrice: '$400',
    cryptoPrice: '0.2 ETH',
    cryptoEth: 0.2,
    unit: 'per month',
    items: [
      'Google Business Profile',
      'Google Ads management',
      'Monthly performance report',
      'Site updates included',
      'Ad spend billed separately by Google',
    ],
  },
  {
    label: 'Hourly',
    title: 'IT Support',
    cashPrice: '$85',
    cryptoPrice: '0.03 ETH',
    cryptoEth: 0.03,
    unit: 'per hour',
    items: [
      'Networking & devices',
      'Software setup & troubleshooting',
      'On-site or remote',
      'Billed in 1hr minimums',
    ],
  },
];

function DepositButton() {
  const { address, isConnected } = useAccount();
  const { open: openWallet }     = useAppKit();
  const { data: txHash, writeContract, isPending, error: txError, reset } = useWriteContract();
  const { isSuccess: txConfirmed } = useWaitForTransactionReceipt({ hash: txHash });

  if (txConfirmed) {
    return (
      <div className="mt-6 pt-6 border-t border-slate-100">
        <p className="text-xs font-black uppercase tracking-widest text-amber-500">Deposit Confirmed</p>
        <p className="text-slate-400 text-xs mt-1">You're in the queue. I'll reach out within one business day.</p>
      </div>
    );
  }

  return (
    <div className="mt-6 pt-6 border-t border-slate-100 space-y-3">
      <p className="text-xs uppercase tracking-widest font-bold text-slate-400">Secure Your Spot</p>
      <p className="text-slate-500 text-xs leading-relaxed">
        0.1 ETH refundable deposit. Applied to your balance if we move forward - returned in full if we don't.
      </p>

      {!isConnected ? (
        <button
          onClick={() => openWallet()}
          className="w-full border border-amber-400 text-amber-500 hover:bg-amber-50 font-black uppercase tracking-widest text-xs px-4 py-3 transition-colors"
        >
          Connect Wallet
        </button>
      ) : (
        <div className="space-y-2">
          <p className="text-xs font-mono text-slate-400 truncate">{address}</p>
          {txError && <p className="text-red-400 text-xs">Transaction failed - try again.</p>}
          <button
            onClick={() => writeContract({ address: CLIENT_LEDGER, abi: LEDGER_ABI, functionName: 'submitInquiry', value: INQUIRY_DEPOSIT })}
            disabled={isPending || !!txHash}
            className="w-full bg-amber-400 hover:bg-amber-300 text-slate-900 font-black uppercase tracking-widest text-xs px-4 py-3 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isPending             ? 'Confirm in Wallet...' :
             txHash && !txConfirmed ? 'Confirming...'        :
             'Submit Deposit'}
          </button>
        </div>
      )}
    </div>
  );
}

function PricingSectionInner() {
  const [mode, setMode]   = useState('cash');
  const [ethUsd, setEthUsd] = useState(null);

  useEffect(() => {
    fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd')
      .then(r => r.json())
      .then(d => setEthUsd(d.ethereum.usd))
      .catch(() => {});
  }, []);

  return (
    <>
      <div className="flex border border-slate-200 mb-8">
        {['cash', 'crypto'].map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`flex-1 py-3 text-xs font-black uppercase tracking-widest transition-colors ${
              mode === m ? 'bg-amber-400 text-slate-900' : 'bg-white text-slate-400 hover:text-slate-600'
            }`}
          >
            {m === 'cash' ? 'Cash' : 'Crypto'}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {tiers.map((tier) => (
          <div key={tier.title} className="border border-slate-200 p-8 flex flex-col">
            <span className="text-xs uppercase tracking-widest font-bold text-amber-500 mb-4 block">
              {tier.label}
            </span>
            <h3 className="text-lg font-black uppercase tracking-tight text-slate-900 mb-1">
              {tier.title}
            </h3>
            <div className="mb-6">
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-black text-slate-900 transition-all">
                  {mode === 'cash' ? tier.cashPrice : tier.cryptoPrice}
                </span>
                <span className="text-slate-400 text-sm">{tier.unit}</span>
              </div>
              {mode === 'crypto' && ethUsd && (
                <p className="text-slate-400 text-xs mt-1">
                  ≈ ${(tier.cryptoEth * ethUsd).toLocaleString('en-US', { maximumFractionDigits: 0 })} USD
                </p>
              )}
            </div>
            <ul className="space-y-2">
              {tier.items.map((item) => (
                <li key={item} className="text-slate-500 text-sm flex items-start gap-2">
                  <span className="text-amber-400 font-bold mt-0.5">+</span>
                  {item}
                </li>
              ))}
            </ul>

            {mode === 'crypto' && tier.title === 'Site Build' && (
              <div className="mt-6 pt-6 border-t border-slate-100 space-y-3">
                <p className="text-xs uppercase tracking-widest font-bold text-slate-400">Secure Your Spot</p>
                <p className="text-slate-500 text-xs leading-relaxed">
                  0.1 ETH refundable deposit. Applied to your balance if we move forward — returned in full if we don't.
                </p>
                <a
                  href="/client"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full text-center bg-amber-400 hover:bg-amber-300 text-slate-900 font-black uppercase tracking-widest text-xs px-4 py-3 transition-colors"
                >
                  Submit Deposit
                </a>
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

export default function PricingSection() {
  return <PricingSectionInner />;
}
