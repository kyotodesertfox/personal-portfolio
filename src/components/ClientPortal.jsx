import { useState, useEffect } from 'react';
import { useAccount, useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt, useDisconnect } from 'wagmi';
import { useAppKit } from '@reown/appkit/react';
import { formatEther, parseEther } from 'viem';
import { WalletProvider } from './WalletProvider.jsx';
import ChatPanel from './ChatPanel.jsx';
import ScopeBuilder from './ScopeBuilder.jsx';

const LEDGER = '0xdEf57F2cA8a7b1403efCDD05e63b93a207080955';
const OWNER  = '0x9939296688D715b7D9Fc17Cf1966f2e366C1Fa6a';

const ABI = [
  { name: 'nextInquiryId', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'getInquiry', type: 'function', stateMutability: 'view',
    inputs:  [{ name: 'inquiryId', type: 'uint256' }],
    outputs: [
      { name: 'client',         type: 'address' },
      { name: 'depositAmount',  type: 'uint256' },
      { name: 'accepted',       type: 'bool'    },
      { name: 'declined',       type: 'bool'    },
      { name: 'projectId',      type: 'uint256' },
      { name: 'readyForReview', type: 'bool'    },
    ],
  },
  { name: 'markReadyForReview', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'inquiryId', type: 'uint256' }], outputs: [],
  },
  { name: 'withdrawInquiry', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'inquiryId', type: 'uint256' }], outputs: [],
  },
  { name: 'submitInquiry', type: 'function', stateMutability: 'payable', inputs: [], outputs: [] },
  { name: 'inquiryDeposit', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
];

function NewDepositButton({ refetch }) {
  const { writeContract, isPending, data: txHash, reset } = useWriteContract();
  const { isSuccess } = useWaitForTransactionReceipt({ hash: txHash });
  const { data: depositAmount } = useReadContract({ address: LEDGER, abi: ABI, functionName: 'inquiryDeposit' });

  useEffect(() => { if (isSuccess) { refetch(); reset(); } }, [isSuccess]);

  return (
    <button
      onClick={() => writeContract({ address: LEDGER, abi: ABI, functionName: 'submitInquiry', value: depositAmount ?? parseEther('0.1') })}
      disabled={isPending}
      className="bg-amber-400 hover:bg-amber-300 text-slate-900 font-black uppercase tracking-widest text-xs px-4 py-2 transition-colors disabled:opacity-40"
    >
      {isPending ? 'Confirming...' : 'New Deposit'}
    </button>
  );
}

function WithdrawButton({ id, refetch, onClose }) {
  const { writeContract, isPending, data: txHash, reset } = useWriteContract();
  const { isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  useEffect(() => { if (isSuccess) { refetch(); reset(); onClose(); } }, [isSuccess]);

  return (
    <button
      onClick={() => writeContract({ address: LEDGER, abi: ABI, functionName: 'withdrawInquiry', args: [BigInt(id)] })}
      disabled={isPending}
      className="border border-red-300 text-red-400 hover:bg-red-50 font-bold uppercase tracking-widest text-xs px-4 py-2 transition-colors disabled:opacity-40"
    >
      {isPending ? 'Confirming...' : 'Withdraw Deposit'}
    </button>
  );
}

function SubmitForReviewButton({ id, refetch }) {
  const [confirming, setConfirming] = useState(false);
  const { writeContract, isPending, data: txHash, reset } = useWriteContract();
  const { isSuccess } = useWaitForTransactionReceipt({ hash: txHash });
  useEffect(() => { if (isSuccess) { refetch(); reset(); setConfirming(false); } }, [isSuccess]);

  return (
    <>
      <button
        onClick={() => setConfirming(true)}
        className="bg-slate-900 hover:bg-slate-700 text-white font-black uppercase tracking-widest text-xs px-4 py-2 transition-colors"
      >
        Submit for Review
      </button>

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-slate-900/60" onClick={() => setConfirming(false)} />
          <div className="relative bg-white shadow-2xl p-8 max-w-sm w-full mx-4">
            <p className="text-sm font-black uppercase tracking-tight text-slate-900 mb-3">Are you sure?</p>
            <p className="text-xs text-slate-500 leading-relaxed mb-6">
              Once you submit for review your deposit can no longer be withdrawn. Make sure your build out is complete before continuing.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => writeContract({ address: LEDGER, abi: ABI, functionName: 'markReadyForReview', args: [BigInt(id)] })}
                disabled={isPending}
                className="flex-1 bg-slate-900 hover:bg-slate-700 text-white font-black uppercase tracking-widest text-xs py-3 transition-colors disabled:opacity-40"
              >
                {isPending ? 'Confirming...' : 'Confirm Submit'}
              </button>
              <button
                onClick={() => setConfirming(false)}
                className="flex-1 border border-slate-200 text-slate-500 hover:text-slate-900 font-bold uppercase tracking-widest text-xs py-3 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function InquiryPopout({ inquiry, address, refetch, onClose }) {
  const { id, result } = inquiry;
  const [, deposit, accepted, declined, projectId, readyForReview] = result;
  const status = accepted ? 'accepted' : declined ? 'declined' : 'pending';

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-slate-900/60" onClick={onClose} />
      <div className="relative w-full sm:max-w-6xl bg-white shadow-2xl flex flex-col max-h-[90vh] sm:rounded-none">
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

        <ScopeBuilder inquiryId={id} projectId={accepted ? Number(projectId) : null} accepted={accepted} isAdmin={false} />

        <div className="px-6 py-2 border-b border-slate-100 shrink-0 flex items-center justify-center gap-4">
          <p className="text-lg font-black text-slate-900">{formatEther(deposit)} ETH</p>
          <p className="text-slate-400 text-xs">
            {status === 'pending'  && 'Deposit held — awaiting review'}
            {status === 'accepted' && `Project #${projectId.toString()} opened — deposit applied`}
            {status === 'declined' && 'Deposit returned to your wallet'}
          </p>
          {status === 'pending' && !readyForReview && <WithdrawButton id={id} refetch={refetch} onClose={onClose} />}
          {status === 'pending' && (
            readyForReview
              ? <span className="text-xs font-bold uppercase tracking-widest text-green-600">Submitted for Review</span>
              : <SubmitForReviewButton id={id} refetch={refetch} />
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <ChatPanel myAddress={address} otherAddress={OWNER} otherLabel="Support" />
        </div>
      </div>
    </div>
  );
}

function ClientInner() {
  const { address, isConnected } = useAccount();
  const { open: openWallet }     = useAppKit();
  const { disconnect }           = useDisconnect();
  const [selectedId, setSelectedId] = useState(null);

  const { data: nextId, refetch: refetchCount } = useReadContract({
    address: LEDGER, abi: ABI, functionName: 'nextInquiryId',
    query: { enabled: isConnected },
  });

  const count = Number(nextId ?? 0n);

  const { data: allInquiries, refetch: refetchInquiries } = useReadContracts({
    contracts: Array.from({ length: count }, (_, i) => ({
      address: LEDGER, abi: ABI, functionName: 'getInquiry', args: [BigInt(i)],
    })),
    query: { enabled: isConnected && count > 0 },
  });

  const refetch = () => { refetchCount(); refetchInquiries(); };

  const myInquiries = allInquiries
    ?.map((r, i) => ({ id: i, ...r }))
    .filter(r => r?.status === 'success' && r.result[0]?.toLowerCase() === address?.toLowerCase())
    ?? [];

  if (!isConnected) return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center">
      <div className="text-center space-y-4">
        <p className="text-xs uppercase tracking-[0.25em] font-bold text-slate-400">Client Portal</p>
        <button onClick={() => openWallet()} className="bg-amber-400 hover:bg-amber-300 text-slate-900 font-black uppercase tracking-widest text-sm px-8 py-4 transition-colors">
          Connect Wallet
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-slate-900 px-6 py-5">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <h1 className="text-white font-black uppercase tracking-tighter text-xl">Client Portal</h1>
          <div className="flex items-center gap-4">
            <p className="text-amber-400 font-mono text-xs">{address?.slice(0,6)}...{address?.slice(-4)}</p>
            <button onClick={() => disconnect()} className="text-xs font-bold uppercase tracking-widest text-slate-400 hover:text-red-400 transition-colors">Disconnect</button>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-black uppercase tracking-tight text-slate-900">Your Inquiries</h2>
          <NewDepositButton refetch={refetch} />
        </div>

        {myInquiries.length === 0 ? (
          <div className="border border-slate-200 bg-white p-8 text-center">
            <p className="text-slate-400 text-sm">No inquiries found for this wallet.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {myInquiries.map((inquiry) => {
              const [, deposit, accepted, declined,, readyForReview] = inquiry.result;
              const status = accepted ? 'accepted' : declined ? 'declined' : 'pending';

              return (
                <div
                  key={inquiry.id}
                  onClick={() => setSelectedId(inquiry.id)}
                  className="border border-slate-200 bg-white p-6 cursor-pointer hover:border-amber-400 hover:shadow-sm transition-all"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-3 mb-1">
                        <span className="text-xs font-bold uppercase tracking-widest text-slate-400">Inquiry #{inquiry.id}</span>
                        <span className={`text-xs font-bold uppercase tracking-widest ${
                          status === 'pending'  ? 'text-amber-500' :
                          status === 'accepted' ? 'text-green-600' : 'text-red-400'
                        }`}>{status}</span>
                        {status === 'pending' && readyForReview && <span className="text-xs font-bold uppercase tracking-widest text-green-500">Submitted for Review</span>}
                      </div>
                      <p className="text-2xl font-black text-slate-900">{formatEther(deposit)} ETH</p>
                    </div>
                    <span className="text-slate-300 text-lg">›</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {selectedId != null && (() => {
        const live = myInquiries.find(r => r.id === selectedId);
        return live ? (
          <InquiryPopout
            inquiry={live}
            address={address}
            refetch={refetch}
            onClose={() => setSelectedId(null)}
          />
        ) : null;
      })()}
    </div>
  );
}

export default function ClientPortal() {
  return <WalletProvider><ClientInner /></WalletProvider>;
}
