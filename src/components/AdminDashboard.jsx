import { useState, useEffect } from 'react';
import { useAccount, useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt, useSignMessage } from 'wagmi';
import { useAppKit } from '@reown/appkit/react';
import { formatEther, parseEther, keccak256 } from 'viem';
import nacl from 'tweetnacl';
import { WalletProvider } from './WalletProvider.jsx';
import ChatPanel from './ChatPanel.jsx';
import ScopeBuilder from './ScopeBuilder.jsx';

const LEDGER = '0xdEf57F2cA8a7b1403efCDD05e63b93a207080955';
const RELAY  = '0xc662fe2D2b887CE6647e81D971efd1d26B71e854';
const OWNER  = '0x9939296688D715b7D9Fc17Cf1966f2e366C1Fa6a';

const RELAY_ABI = [
  { name: 'registerKey', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: '_x25519Key', type: 'bytes32' }, { name: '_kyberKey', type: 'bytes' }], outputs: [] },
  { name: 'x25519Key', type: 'function', stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }], outputs: [{ type: 'bytes32' }] },
];

const KEY_SIGN_MSG = 'HomesteadRelay key registration v1';

const ABI = [
  { name: 'nextInquiryId',  type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'getInquiry', type: 'function', stateMutability: 'view',
    inputs:  [{ name: 'inquiryId', type: 'uint256' }],
    outputs: [
      { name: 'client',          type: 'address' },
      { name: 'depositAmount',   type: 'uint256' },
      { name: 'accepted',        type: 'bool'    },
      { name: 'declined',        type: 'bool'    },
      { name: 'projectId',       type: 'uint256' },
      { name: 'readyForReview',  type: 'bool'    },
    ],
  },
  { name: 'acceptInquiry', type: 'function', stateMutability: 'nonpayable',
    inputs: [
      { name: 'inquiryId',    type: 'uint256' },
      { name: 'description',  type: 'string'  },
      { name: 'financed',     type: 'bool'    },
      { name: 'discountBps',  type: 'uint256' },
      { name: 'discountFlat', type: 'uint256' },
    ], outputs: [],
  },
  { name: 'declineInquiry', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'inquiryId', type: 'uint256' }], outputs: [],
  },
];

function InquiryCard({ id, data, refetch }) {
  const [client, deposit, accepted, declined, projectId, readyForReview] = data;
  const [accepting,     setAccepting]     = useState(false);
  const [desc,          setDesc]          = useState('');
  const [discountPct,   setDiscountPct]   = useState('');
  const [discountFlat,  setDiscountFlat]  = useState('');

  const { writeContract, isPending, data: txHash, reset } = useWriteContract();
  const { isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  useEffect(() => {
    if (isSuccess) { refetch(); reset(); setAccepting(false); setDesc(''); setDiscountPct(''); setDiscountFlat(''); }
  }, [isSuccess]);

  const status = accepted ? 'accepted' : declined ? 'declined' : 'pending';

  return (
    <div className="border border-slate-200 bg-white p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-xs font-bold uppercase tracking-widest text-slate-400">#{id}</span>
            <span className={`text-xs font-bold uppercase tracking-widest ${
              status === 'pending'  ? 'text-amber-500' :
              status === 'accepted' ? 'text-green-600' : 'text-red-400'
            }`}>{status}</span>
            {accepted && <span className="text-xs text-slate-400 font-mono">Project #{projectId.toString()}</span>}
            {!accepted && !declined && readyForReview && <span className="text-xs font-bold uppercase tracking-widest text-green-500">Ready for Review</span>}
          </div>
          <p className="font-mono text-sm text-slate-700 truncate">{client}</p>
          <p className="text-slate-400 text-xs mt-1">{formatEther(deposit)} ETH deposit</p>
        </div>

        {status === 'pending' && !accepting && (
          <div className="flex gap-2 shrink-0">
            <button
              onClick={() => setAccepting(true)}
              className="bg-amber-400 hover:bg-amber-300 text-slate-900 font-black uppercase tracking-widest text-xs px-4 py-2 transition-colors"
            >
              Accept
            </button>
            <button
              onClick={() => writeContract({ address: LEDGER, abi: ABI, functionName: 'declineInquiry', args: [BigInt(id)] })}
              disabled={isPending}
              className="border border-red-300 text-red-400 hover:bg-red-50 font-bold uppercase tracking-widest text-xs px-4 py-2 transition-colors disabled:opacity-40"
            >
              {isPending ? '...' : 'Decline'}
            </button>
          </div>
        )}
      </div>

      {status === 'pending' && accepting && (
        <div className="mt-4 pt-4 border-t border-slate-100 space-y-3">
          <textarea
            className="w-full border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 focus:outline-none focus:border-amber-400 resize-none"
            rows={3}
            placeholder="Project description..."
            value={desc}
            onChange={e => setDesc(e.target.value)}
          />
          <div className="flex gap-3">
            <div className="flex-1">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Discount %</p>
              <input
                type="number" min="0" max="100" step="0.1"
                value={discountPct} onChange={e => setDiscountPct(e.target.value)}
                placeholder="0"
                className="w-full border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:border-amber-400"
              />
            </div>
            <div className="flex-1">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Flat Discount (ETH)</p>
              <input
                type="number" min="0" step="0.001"
                value={discountFlat} onChange={e => setDiscountFlat(e.target.value)}
                placeholder="0.00"
                className="w-full border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:border-amber-400"
              />
            </div>
          </div>
          <div className="flex gap-2 items-center">
            <button
              onClick={() => writeContract({
                address: LEDGER, abi: ABI, functionName: 'acceptInquiry',
                args: [
                  BigInt(id),
                  desc,
                  false,
                  BigInt(Math.round((parseFloat(discountPct) || 0) * 100)),
                  parseEther(discountFlat || '0'),
                ],
              })}
              disabled={!desc.trim() || isPending}
              className="bg-slate-900 hover:bg-slate-700 text-white font-black uppercase tracking-widest text-xs px-6 py-3 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {isPending ? 'Confirming...' : 'Confirm Accept'}
            </button>
            <button
              onClick={() => { setAccepting(false); setDesc(''); setDiscountPct(''); setDiscountFlat(''); }}
              className="text-xs font-bold uppercase tracking-widest text-slate-400 hover:text-slate-700 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

    </div>
  );
}

function RegisterKeyPanel() {
  const { address } = useAccount();
  const { signMessage, isPending: isSigning } = useSignMessage();
  const { writeContract, isPending: isTxPending, data: txHash, reset } = useWriteContract();
  const { isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  const { data: existingKey, refetch: refetchKey } = useReadContract({
    address: RELAY, abi: RELAY_ABI, functionName: 'x25519Key', args: [address],
    query: { enabled: !!address },
  });

  useEffect(() => { if (isSuccess) { refetchKey(); reset(); } }, [isSuccess]);

  const isRegistered = existingKey && existingKey !== '0x0000000000000000000000000000000000000000000000000000000000000000';

  const handleRegister = () => {
    signMessage(
      { message: KEY_SIGN_MSG },
      {
        onSuccess: (sig) => {
          const seed = keccak256(sig);
          const privKey = Uint8Array.from(Buffer.from(seed.slice(2), 'hex'));
          const keyPair = nacl.box.keyPair.fromSecretKey(privKey);
          const pubKeyHex = '0x' + Buffer.from(keyPair.publicKey).toString('hex');
          writeContract({ address: RELAY, abi: RELAY_ABI, functionName: 'registerKey', args: [pubKeyHex, '0x'] });
        },
      }
    );
  };

  return (
    <div className="border border-slate-200 bg-white p-6 mb-8">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">Relay Encryption Key</p>
          {isRegistered
            ? <p className="font-mono text-xs text-green-600">{existingKey?.slice(0,10)}...{existingKey?.slice(-8)} registered</p>
            : <p className="text-xs text-slate-500">No key registered — clients cannot send encrypted messages.</p>
          }
        </div>
        <button
          onClick={handleRegister}
          disabled={isSigning || isTxPending}
          className="bg-slate-900 hover:bg-slate-700 text-white font-black uppercase tracking-widest text-xs px-4 py-2 transition-colors disabled:opacity-40"
        >
          {isSigning ? 'Sign in wallet...' : isTxPending ? 'Confirming...' : isRegistered ? 'Rotate Key' : 'Register Key'}
        </button>
      </div>
    </div>
  );
}

function InquiryPopout({ id, data, refetch, onClose }) {
  const [client, deposit, accepted, declined, projectId, readyForReview] = data;
  const status = accepted ? 'accepted' : declined ? 'declined' : 'pending';

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-slate-900/60" onClick={onClose} />
      <div className="relative w-full sm:max-w-6xl bg-white shadow-2xl flex flex-col max-h-[90vh]">
        <div className="bg-slate-900 px-6 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-white font-black uppercase tracking-tight">Inquiry #{id}</span>
            <span className={`text-xs font-bold uppercase tracking-widest ${
              status === 'pending'  ? 'text-amber-400' :
              status === 'accepted' ? 'text-green-400' : 'text-red-400'
            }`}>{status}</span>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-lg font-bold transition-colors">✕</button>
        </div>

        <ScopeBuilder inquiryId={id} projectId={accepted ? Number(projectId) : null} accepted={accepted} isAdmin />

        <div className="px-6 py-2 border-b border-slate-100 shrink-0 flex items-center justify-center gap-4">
          <p className="text-lg font-black text-slate-900 shrink-0">{formatEther(deposit)} ETH</p>
          <p className="font-mono text-xs text-slate-400 truncate">{client}</p>
          {accepted && <p className="text-xs font-bold text-green-600 shrink-0">Project #{projectId.toString()}</p>}
        </div>

        <div className="px-6 py-4 border-b border-slate-100 shrink-0">
          <InquiryCard id={id} data={data} refetch={() => { refetch(); onClose(); }} />
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <ChatPanel myAddress={OWNER} otherAddress={client} isAdmin />
        </div>
      </div>
    </div>
  );
}

function AdminInner() {
  const { address, isConnected } = useAccount();
  const { open: openWallet }     = useAppKit();
  const isOwner = isConnected && address?.toLowerCase() === OWNER.toLowerCase();
  const [selected, setSelected] = useState(null);
  const [open, setOpen] = useState({ ready: true, pending: true, accepted: true, declined: false });
  const toggleOpen = key => setOpen(v => ({ ...v, [key]: !v[key] }));

  const { data: nextId, refetch: refetchCount } = useReadContract({
    address: LEDGER, abi: ABI, functionName: 'nextInquiryId',
    query: { enabled: isOwner },
  });

  const count = Number(nextId ?? 0n);

  const { data: inquiries, refetch: refetchInquiries } = useReadContracts({
    contracts: Array.from({ length: count }, (_, i) => ({
      address: LEDGER, abi: ABI, functionName: 'getInquiry', args: [BigInt(i)],
    })),
    query: { enabled: isOwner && count > 0 },
  });

  const refetch = () => { refetchCount(); refetchInquiries(); };

  if (!isConnected) return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center">
      <div className="text-center space-y-4">
        <p className="text-xs uppercase tracking-[0.25em] font-bold text-slate-400">Admin Access</p>
        <button onClick={() => openWallet()} className="bg-amber-400 hover:bg-amber-300 text-slate-900 font-black uppercase tracking-widest text-sm px-8 py-4 transition-colors">
          Connect Wallet
        </button>
      </div>
    </div>
  );

  if (!isOwner) return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center">
      <p className="text-red-400 font-mono text-sm">Not authorized.</p>
    </div>
  );

  const pending  = inquiries?.filter(r => r?.status === 'success' && !r.result[2] && !r.result[3]).length ?? 0;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-slate-900 px-6 py-5">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <h1 className="text-white font-black uppercase tracking-tighter text-xl">Admin</h1>
          <p className="text-amber-400 font-mono text-xs">{address?.slice(0,6)}...{address?.slice(-4)}</p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-10">
        <RegisterKeyPanel />

        <div className="flex items-baseline gap-3 mb-6">
          <h2 className="text-lg font-black uppercase tracking-tight text-slate-900">Inquiries</h2>
          {count > 0 && <span className="text-sm font-bold text-slate-400">{count} total</span>}
          {pending > 0 && <span className="text-xs font-bold uppercase tracking-widest text-amber-500">{pending} pending</span>}
        </div>

        {count === 0 ? (
          <p className="text-slate-400 text-sm">No inquiries yet.</p>
        ) : (() => {
          const ok = r => r?.status === 'success';
          const idxOf = r => inquiries.indexOf(r);

          const groups = {
            ready:    inquiries?.filter(r => ok(r) && !r.result[2] && !r.result[3] &&  r.result[5]) ?? [],
            pending:  inquiries?.filter(r => ok(r) && !r.result[2] && !r.result[3] && !r.result[5]) ?? [],
            accepted: inquiries?.filter(r => ok(r) &&  r.result[2])                                 ?? [],
            declined: inquiries?.filter(r => ok(r) && !r.result[2] &&  r.result[3])                 ?? [],
          };

          const labels = {
            ready:    'Ready for Review',
            pending:  'Pending',
            accepted: 'Accepted',
            declined: 'Declined',
          };

          const Section = ({ groupKey, dim }) => {
            const items = groups[groupKey];
            if (!items.length) return null;
            return (
              <div className="mt-8 first:mt-0">
                <button
                  onClick={() => toggleOpen(groupKey)}
                  className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-400 hover:text-slate-600 transition-colors mb-4"
                >
                  <span>{open[groupKey] ? '▾' : '▸'}</span>
                  <span>{labels[groupKey]} ({items.length})</span>
                </button>
                {open[groupKey] && (
                  <div className={`space-y-4 ${dim ? 'opacity-50' : ''}`}>
                    {items.map(result => (
                      <div
                        key={idxOf(result)}
                        onClick={() => setSelected({ id: idxOf(result), data: result.result })}
                        className={`cursor-pointer transition-all ${dim ? 'hover:opacity-75' : 'hover:border-amber-400 hover:shadow-sm'}`}
                      >
                        <InquiryCard id={idxOf(result)} data={result.result} refetch={refetch} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          };

          return (
            <>
              <Section groupKey="ready" />
              <Section groupKey="pending" />
              <Section groupKey="accepted" />
              <Section groupKey="declined" dim />
            </>
          );
        })()}
      </div>

      {selected && (
        <InquiryPopout
          id={selected.id}
          data={selected.data}
          refetch={refetch}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

export default function AdminDashboard() {
  return <WalletProvider><AdminInner /></WalletProvider>;
}
