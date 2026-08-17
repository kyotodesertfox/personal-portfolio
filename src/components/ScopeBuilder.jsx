import { useState, useEffect, useRef } from 'react';
import { usePublicClient, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseAbiItem, parseEther, formatEther } from 'viem';

const LEDGER = '0xdEf57F2cA8a7b1403efCDD05e63b93a207080955';

const LEDGER_ABI = [
  { name: 'proposeLineItem', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'projectId', type: 'uint256' }, { name: 'description', type: 'string' }, { name: 'ethAmount', type: 'uint256' }],
    outputs: [],
  },
  { name: 'requestScopeItem', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'inquiryId', type: 'uint256' }, { name: 'description', type: 'string' }, { name: 'ethAmount', type: 'uint256' }],
    outputs: [],
  },
  { name: 'cancelScopeItem', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'inquiryId', type: 'uint256' }, { name: 'itemId', type: 'uint256' }],
    outputs: [],
  },
];

const LINE_ITEM_EVENT   = parseAbiItem('event LineItemProposed(uint256 indexed projectId, uint256 indexed itemId, string description, uint256 ethAmount)');
const SCOPE_REQ_EVENT    = parseAbiItem('event ScopeItemRequested(uint256 indexed inquiryId, uint256 indexed itemId, string description, uint256 ethAmount)');
const SCOPE_CANCEL_EVENT = parseAbiItem('event ScopeItemCancelled(uint256 indexed inquiryId, uint256 indexed itemId)');

const SERVICES = [
  { id: 'site-build',    label: 'Site Build',          detail: 'Up to 5 pages, mobile-first',     eth: '1'    },
  { id: 'it-support',   label: 'IT Support',            detail: 'Remote or on-site, per hour',     eth: '0.03' },
  { id: 'seo',          label: 'SEO Setup',             detail: 'On-page optimisation + sitemap',  eth: '0.15' },
  { id: 'domain-email', label: 'Domain & Email',        detail: 'Domain reg + business email',     eth: '0.05' },
  { id: 'maintenance',  label: 'Monthly Maintenance',   detail: 'Updates, backups, uptime',        eth: '0.1'  },
  { id: 'ecommerce',    label: 'E-Commerce',            detail: 'Store setup + payment gateway',   eth: '0.5'  },
  { id: 'analytics',    label: 'Analytics',             detail: 'GA4 + conversion tracking',       eth: '0.08' },
];

function ServiceCard({ service, onDragStart }) {
  return (
    <div
      draggable
      onDragStart={e => { e.dataTransfer.setData('serviceId', service.id); onDragStart?.(service); }}
      className="border border-slate-200 bg-white p-3 cursor-grab active:cursor-grabbing hover:border-amber-400 hover:shadow-sm transition-all select-none"
    >
      <p className="text-xs font-black uppercase tracking-tight text-slate-900">{service.label}</p>
      <p className="text-[10px] text-slate-400 mt-0.5">{service.detail}</p>
      <p className="text-xs font-bold text-amber-500 mt-1">{service.eth} ETH</p>
    </div>
  );
}

function BinItem({ item, index, onRemove, onDragStart, onDragEnter, onDragEnd, isDragOver }) {
  return (
    <div
      draggable
      onDragStart={e => { e.dataTransfer.setData('binIndex', index); onDragStart(index); }}
      onDragEnter={() => onDragEnter(index)}
      onDragEnd={onDragEnd}
      onDragOver={e => e.preventDefault()}
      className={`flex items-center justify-between bg-white border px-3 py-2 cursor-grab active:cursor-grabbing transition-all ${
        isDragOver ? 'border-amber-400 shadow-sm' : 'border-slate-200'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="text-slate-300 text-xs select-none">⠿</span>
        <div>
          <p className="text-xs font-bold text-slate-900">{item.label}</p>
          {item.custom && <p className="text-[10px] text-slate-400">{item.detail}</p>}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs font-bold text-amber-500">{item.eth} ETH</span>
        <button onClick={() => onRemove(item.uid)} className="text-slate-300 hover:text-red-400 transition-colors text-sm font-bold">✕</button>
      </div>
    </div>
  );
}

export default function ScopeBuilder({ inquiryId, projectId, accepted, isAdmin }) {
  const publicClient = usePublicClient();
  const [bin, setBin]             = useState([]);
  const [isDragOver, setDragOver] = useState(false);
  const [dragIdx, setDragIdx]     = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);
  const [proposed, setProposed]         = useState([]);
  const [scopeRequests, setScopeRequests] = useState([]);
  const [submitting, setSubmitting]     = useState(false);
  const [submitIdx, setSubmitIdx]       = useState(0);

  // Admin custom item form
  const [customLabel, setCustomLabel] = useState('');
  const [customDetail, setCustomDetail] = useState('');
  const [customEth, setCustomEth]     = useState('');

  const { writeContract, data: txHash, isPending, reset } = useWriteContract();
  const { isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  const fetchProposed = async () => {
    if (!publicClient || projectId == null) return;
    try {
      const logs = await publicClient.getLogs({
        address: LEDGER, event: LINE_ITEM_EVENT,
        args: { projectId: BigInt(projectId) },
        fromBlock: 0n, toBlock: 'latest',
      });
      setProposed(logs.map(l => ({
        itemId: Number(l.args.itemId), description: l.args.description, eth: formatEther(l.args.ethAmount),
      })));
    } catch (e) { console.error(e); }
  };

  const fetchScopeRequests = async () => {
    if (!publicClient || inquiryId == null || accepted) return;
    try {
      const [requested, cancelled] = await Promise.all([
        publicClient.getLogs({ address: LEDGER, event: SCOPE_REQ_EVENT,    args: { inquiryId: BigInt(inquiryId) }, fromBlock: 0n, toBlock: 'latest' }),
        publicClient.getLogs({ address: LEDGER, event: SCOPE_CANCEL_EVENT, args: { inquiryId: BigInt(inquiryId) }, fromBlock: 0n, toBlock: 'latest' }),
      ]);
      const cancelledIds = new Set(cancelled.map(l => Number(l.args.itemId)));
      setScopeRequests(requested
        .filter(l => !cancelledIds.has(Number(l.args.itemId)))
        .map(l => ({ itemId: Number(l.args.itemId), description: l.args.description, eth: formatEther(l.args.ethAmount) }))
      );
    } catch (e) { console.error(e); }
  };

  useEffect(() => {
    fetchProposed();
    if (projectId == null) return;
    const id = setInterval(fetchProposed, 5000);
    return () => clearInterval(id);
  }, [projectId]);

  useEffect(() => {
    fetchScopeRequests();
    if (inquiryId == null || accepted) return;
    const id = setInterval(fetchScopeRequests, 5000);
    return () => clearInterval(id);
  }, [inquiryId, accepted]);

  useEffect(() => {
    if (!isSuccess || !submitting) return;
    reset();
    const next = submitIdx + 1;
    if (next < bin.length) {
      setSubmitIdx(next);
      submitItem(bin[next]);
    } else {
      setBin([]);
      setSubmitting(false);
      setSubmitIdx(0);
      if (accepted) fetchProposed(); else fetchScopeRequests();
    }
  }, [isSuccess]);

  const submitItem = (item) => {
    const desc = item.label + (item.detail ? ` — ${item.detail}` : '');
    if (accepted) {
      writeContract({ address: LEDGER, abi: LEDGER_ABI, functionName: 'proposeLineItem',
        args: [BigInt(projectId), desc, parseEther(item.eth)] });
    } else {
      writeContract({ address: LEDGER, abi: LEDGER_ABI, functionName: 'requestScopeItem',
        args: [BigInt(inquiryId), desc, parseEther(item.eth)] });
    }
  };

  const handleSubmitBin = () => {
    if (!bin.length) return;
    if (accepted && projectId == null) return;
    if (!accepted && inquiryId == null) return;
    setSubmitting(true);
    setSubmitIdx(0);
    submitItem(bin[0]);
  };

  const handleBinDragEnd = () => {
    if (dragIdx !== null && dragOverIdx !== null && dragIdx !== dragOverIdx) {
      setBin(prev => {
        const next = [...prev];
        const [moved] = next.splice(dragIdx, 1);
        next.splice(dragOverIdx, 0, moved);
        return next;
      });
    }
    setDragIdx(null);
    setDragOverIdx(null);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.getData('binIndex') !== '') return; // reorder handled by BinItem
    const id = e.dataTransfer.getData('serviceId');
    const svc = SERVICES.find(s => s.id === id);
    if (!svc) return;
    setBin(prev => [...prev, { ...svc, uid: `${svc.id}-${Date.now()}` }]);
  };

  const addCustom = () => {
    if (!customLabel.trim() || !customEth) return;
    setBin(prev => [...prev, {
      uid: `custom-${Date.now()}`,
      label: customLabel.trim(),
      detail: customDetail.trim(),
      eth: customEth,
      custom: true,
    }]);
    setCustomLabel(''); setCustomDetail(''); setCustomEth('');
  };

  const removeFromBin = (uid) => setBin(prev => prev.filter(i => i.uid !== uid));

  const availableServices = SERVICES.filter(s =>
    !bin.some(item => item.id === s.id) &&
    !scopeRequests.some(r => r.description.startsWith(s.label))
  );

  const canSubmit = bin.length > 0 && (
    accepted ? projectId != null : (!isAdmin && inquiryId != null)
  );
  const binTotal = bin.reduce((sum, i) => sum + parseFloat(i.eth || 0), 0);

  return (
    <div className="border-b border-slate-100 px-6 py-5">
      <p className="text-xs font-black uppercase tracking-widest text-slate-400 mb-4">Project Buildout</p>

      <div className="flex gap-4">
        {/* Bin */}
        <div className="w-1/2 flex flex-col">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Your Bin</p>
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={`flex-1 min-h-32 border-2 border-dashed p-2 space-y-2 transition-colors ${
              isDragOver ? 'border-amber-400 bg-amber-50' : 'border-slate-200 bg-slate-50'
            }`}
          >
            {bin.length === 0 && (
              <p className="text-[10px] text-slate-400 text-center pt-6">Drag services here</p>
            )}
            {bin.map((item, i) => (
              <BinItem
                key={item.uid}
                item={item}
                index={i}
                onRemove={removeFromBin}
                onDragStart={setDragIdx}
                onDragEnter={setDragOverIdx}
                onDragEnd={handleBinDragEnd}
                isDragOver={dragOverIdx === i && dragIdx !== i}
              />
            ))}
          </div>

          {bin.length > 0 && (
            <div className="mt-2 flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500">{binTotal.toFixed(3)} ETH total</span>
              {isAdmin && !accepted
                ? <span className="text-xs font-bold uppercase tracking-widest text-slate-400">Accept inquiry to propose items</span>
                : <button
                    onClick={handleSubmitBin}
                    disabled={!canSubmit || isPending || submitting}
                    className="bg-amber-400 hover:bg-amber-300 text-slate-900 font-black uppercase tracking-widest text-xs px-4 py-2 transition-colors disabled:opacity-40"
                  >
                    {submitting ? `Submitting ${submitIdx + 1}/${bin.length}...` : accepted ? 'Propose Items' : 'Submit to Build Out'}
                  </button>
              }
            </div>
          )}
        </div>

        {/* Service Menu */}
        <div className="w-1/2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Services</p>
          <div className="grid grid-cols-2 gap-2">
            {availableServices.map(s => <ServiceCard key={s.id} service={s} />)}
          </div>

          {isAdmin && accepted && (
            <div className="mt-3 border border-dashed border-slate-300 p-3 space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Custom Item</p>
              <input value={customLabel} onChange={e => setCustomLabel(e.target.value)} placeholder="Label" className="w-full border border-slate-200 px-2 py-1.5 text-xs focus:outline-none focus:border-amber-400" />
              <input value={customDetail} onChange={e => setCustomDetail(e.target.value)} placeholder="Description (optional)" className="w-full border border-slate-200 px-2 py-1.5 text-xs focus:outline-none focus:border-amber-400" />
              <input value={customEth} onChange={e => setCustomEth(e.target.value)} placeholder="ETH amount" type="number" step="0.01" className="w-full border border-slate-200 px-2 py-1.5 text-xs focus:outline-none focus:border-amber-400" />
              <button onClick={addCustom} disabled={!customLabel.trim() || !customEth} className="w-full bg-slate-900 hover:bg-slate-700 text-white font-black uppercase tracking-widest text-xs py-2 transition-colors disabled:opacity-30">
                Add to Bin
              </button>
            </div>
          )}
        </div>
      </div>

      {/* On-chain items */}
      {!accepted && scopeRequests.length > 0 && (
        <div className="mt-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Submitted Tasks</p>
          <div className="space-y-1">
            {scopeRequests.map(r => (
              <div key={r.itemId} className="flex items-center justify-between bg-white border border-slate-200 px-3 py-2">
                <p className="text-xs text-slate-700">{r.description}</p>
                <div className="flex items-center gap-3 shrink-0 ml-3">
                  <span className="text-xs font-bold text-amber-500">{r.eth} ETH</span>
                  {!isAdmin && (
                    <button
                      onClick={() => writeContract({ address: LEDGER, abi: LEDGER_ABI, functionName: 'cancelScopeItem', args: [BigInt(inquiryId), BigInt(r.itemId)] })}
                      disabled={isPending}
                      className="text-slate-300 hover:text-red-400 transition-colors text-sm font-bold disabled:opacity-40"
                    >✕</button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs font-bold text-slate-500 mt-2 text-right">
            {scopeRequests.reduce((sum, r) => sum + parseFloat(r.eth || 0), 0).toFixed(3)} ETH total
          </p>
        </div>
      )}
      {accepted && proposed.length > 0 && (
        <div className="mt-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Proposed Line Items</p>
          <div className="space-y-1">
            {proposed.map(p => (
              <div key={p.itemId} className="flex items-center justify-between bg-white border border-slate-200 px-3 py-2">
                <p className="text-xs text-slate-700">{p.description}</p>
                <span className="text-xs font-bold text-amber-500 shrink-0 ml-3">{p.eth} ETH</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
