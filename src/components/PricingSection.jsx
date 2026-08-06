import { useState, useEffect } from 'react';

const tiers = [
  {
    label: 'One-time',
    title: 'Site Build',
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

function PricingSectionInner() {
  const [mode, setMode]   = useState('crypto');
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
        {['crypto', 'trade'].map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`flex-1 py-3 text-xs font-black uppercase tracking-widest transition-colors ${
              mode === m ? 'bg-amber-400 text-slate-900' : 'bg-white text-slate-400 hover:text-slate-600'
            }`}
          >
            {m === 'crypto' ? 'Crypto' : 'Trade / Barter'}
          </button>
        ))}
      </div>

      {mode === 'trade' && (
        <div className="mb-8 border border-amber-200 bg-amber-50 px-6 py-5">
          <p className="text-sm font-black uppercase tracking-widest text-amber-700 mb-1">Trade instead of pay</p>
          <p className="text-slate-500 text-sm leading-relaxed">
            I built Homestead, a barter exchange, because I don't think everything needs to run through dollars.
            If you've got goods, equipment, land work, or labor you'd rather trade than pay cash for, tell me what
            you have and what you need - we'll work out fair terms directly.
          </p>
        </div>
      )}

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
              {mode !== 'trade' && (
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-black text-slate-900 transition-all">
                    {tier.cryptoPrice}
                  </span>
                  <span className="text-slate-400 text-sm">{tier.unit}</span>
                </div>
              )}
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
          </div>
        ))}
      </div>
    </>
  );
}

export default function PricingSection() {
  return <PricingSectionInner />;
}
